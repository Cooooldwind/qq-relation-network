# 性能优化与节点大小分级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决万级到十万级节点下的卡顿问题，优化加载动画体验，并通过节点大小直观区分百人群/千人群/万人群。

**Architecture:** 后端采用对数标度节点大小计算 + 规模标签；前端采用自适应力导向参数 + 分级降级渲染 + 增量更新策略。前后端分离优化，每一层独立可测。

**Tech Stack:** Python 3 (Flask backend), JavaScript (ECharts 5.4 frontend), pytest (backend tests)

---

## 文件结构总览

| 文件 | 变更类型 | 职责 |
|------|---------|------|
| `backend/data_processor.py` | 修改 | 节点大小计算函数重写、添加规模等级 |
| `backend/tests/test_data_processor.py` | 新建 | 节点大小计算的单元测试 |
| `frontend/js/app.js` | 修改 | 自适应力导向参数、分级降级渲染、增量优化 |
| `frontend/js/force-config.js` | 新建 | 力导向配置计算模块（从 app.js 抽离） |
| `frontend/css/style.css` | 修改 | 节点大小图例/规模标签样式 |

---

### Task 1: 后端节点大小计算函数重构（对数标度）

**Files:**
- Modify: `backend/data_processor.py:73-77`
- Create: `backend/tests/test_data_processor.py`

#### 问题背景

当前公式 `size = min(max(10, value * 2 + 8), 60)` 是线性的，到达 26 个关联就封顶为 60。百人群（100人）、千人群（1000人）、万人群（10000人）的节点大小完全一样，视觉上无法区分。

#### 新模型设计

采用 **分段对数模型**，兼顾小节点的区分度和大节点的层次感：

```
节点规模分级：
- 小节点（value < 10）: 线性增长，保证小数量区分度
- 中节点（10 <= value < 100）: 对数增长，百人群量级
- 大节点（100 <= value < 1000）: 对数增长，千人群量级
- 超大节点（value >= 1000）: 对数增长，万人群量级

统一公式：
size = min_size + (max_size - min_size) * (log(value + base_offset) / log(max_value + base_offset)) ^ exponent

其中：
- min_size = 8（最小节点）
- max_size = 80（最大节点，比原来的60更大）
- base_offset = 1（避免 log(0)）
- exponent = 0.7（压缩曲线，让中段区分更明显）

等价于：
normalized = (log(value + 1) / log(max_value + 1)) ^ 0.7
size = 8 + 72 * normalized

max_value 取 50000（五万人的大群上限）
```

数值对照表（验证用）：

| value (关联数) | symbolSize | 规模级别 |
|---------------|------------|----------|
| 1 | ~10 | 微小 |
| 5 | ~18 | 小 |
| 10 | ~24 | 小 |
| 50 | ~38 | 中（五十人群） |
| 100 | ~44 | 中（百人群） |
| 500 | ~57 | 大（五百人群） |
| 1000 | ~62 | 大（千人群） |
| 5000 | ~71 | 超大（五千人群） |
| 10000 | ~74 | 超大（万人群） |
| 50000 | 80（封顶） | 特大（五万人群） |

另外添加 `size_level` 字段标记规模等级（0-4），方便前端做特殊样式。

- [ ] **Step 1: 编写后端测试（先写失败测试）**

创建 `backend/tests/test_data_processor.py`：

```python
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data_processor import RelationDataProcessor
import math


def test_symbol_size_min_value():
    """value=0 时节点大小应为最小值"""
    p = RelationDataProcessor()
    p._add_node("1", "test", "friend")
    assert p.nodes["1"]["symbolSize"] == 8


def test_symbol_size_small_values_linear():
    """小值区间应有良好区分度"""
    p = RelationDataProcessor()
    p._add_node("1", "a", "friend")
    p._add_node("2", "b", "friend")
    p._add_node("3", "c", "friend")
    p._add_node("self", "me", "self")
    p._add_link("self", "1", "friend")
    p._add_link("self", "2", "friend")
    p._add_link("self", "3", "friend")
    # self 有 3 条边，symbolSize 应该在 12-20 之间
    size = p.nodes["self"]["symbolSize"]
    assert 12 <= size <= 20, f"Expected size between 12 and 20, got {size}"


def test_symbol_size_hundred_vs_thousand():
    """百人群和千人群大小应有明显差异（差距 > 10px）"""
    p = RelationDataProcessor()
    p._add_node("100", "百人群", "group")
    p._add_node("1000", "千人群", "group")
    p._add_node("self", "me", "self")
    # 模拟百人群
    for i in range(100):
        uid = f"u{i}"
        p._add_node(uid, f"用户{i}", "stranger")
        p._add_link("100", uid, "group")
    # 模拟千人群
    for i in range(1000):
        uid = f"v{i}"
        p._add_node(uid, f"用户v{i}", "stranger")
        p._add_link("1000", uid, "group")
    size_100 = p.nodes["100"]["symbolSize"]
    size_1000 = p.nodes["1000"]["symbolSize"]
    diff = size_1000 - size_100
    assert diff > 10, f"Expected diff > 10 between 100 and 1000, got {diff} (100={size_100}, 1000={size_1000})"


def test_symbol_size_thousand_vs_ten_thousand():
    """千人群和万人群大小应有明显差异（差距 > 5px）"""
    p = RelationDataProcessor()
    p._add_node("1000", "千人群", "group")
    p._add_node("10000", "万人群", "group")
    for i in range(1000):
        uid = f"a{i}"
        p._add_node(uid, f"u{i}", "stranger")
        p._add_link("1000", uid, "group")
    for i in range(10000):
        uid = f"b{i}"
        p._add_node(uid, f"v{i}", "stranger")
        p._add_link("10000", uid, "group")
    size_1k = p.nodes["1000"]["symbolSize"]
    size_10k = p.nodes["10000"]["symbolSize"]
    diff = size_10k - size_1k
    assert diff > 5, f"Expected diff > 5 between 1k and 10k, got {diff} (1k={size_1k}, 10k={size_10k})"


def test_symbol_size_max_cap():
    """极大值不应超过上限"""
    p = RelationDataProcessor()
    p._add_node("big", "超大群", "group")
    for i in range(100000):
        uid = f"u{i}"
        p._add_node(uid, f"u{i}", "stranger")
        p._add_link("big", uid, "group")
    assert p.nodes["big"]["symbolSize"] == 80


def test_size_level_classification():
    """size_level 分级正确"""
    p = RelationDataProcessor()
    p._add_node("1", "n1", "group")
    p._add_node("2", "n2", "group")
    p._add_node("3", "n3", "group")
    p._add_node("4", "n4", "group")
    p._add_node("5", "n5", "group")
    # 5个关联 -> level 0
    for i in range(5):
        p._add_node(f"u{i}", "", "stranger")
        p._add_link("1", f"u{i}", "group")
    # 50个关联 -> level 1
    for i in range(50):
        p._add_node(f"v{i}", "", "stranger")
        p._add_link("2", f"v{i}", "group")
    # 200个关联 -> level 2
    for i in range(200):
        p._add_node(f"w{i}", "", "stranger")
        p._add_link("3", f"w{i}", "group")
    # 2000个关联 -> level 3
    for i in range(2000):
        p._add_node(f"x{i}", "", "stranger")
        p._add_link("4", f"x{i}", "group")
    # 20000个关联 -> level 4
    for i in range(20000):
        p._add_node(f"y{i}", "", "stranger")
        p._add_link("5", f"y{i}", "group")
    assert p.nodes["1"]["size_level"] == 0
    assert p.nodes["2"]["size_level"] == 1
    assert p.nodes["3"]["size_level"] == 2
    assert p.nodes["4"]["size_level"] == 3
    assert p.nodes["5"]["size_level"] == 4
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
cd /workspace/backend && python -m pytest tests/test_data_processor.py -v
```
Expected: FAIL — `symbolSize` 初始值不是 8，`size_level` 属性不存在，对数公式未实现。

- [ ] **Step 3: 实现节点大小计算函数**

修改 `backend/data_processor.py`：

**3a. 修改 `_add_node` 初始值（第27-35行）**

将第 32-33 行：
```python
"value": 0,
"symbolSize": 10,
```
替换为：
```python
"value": 0,
"symbolSize": 8,
"size_level": 0,
```

**3b. 重写 `_update_symbol_size` 方法（第73-77行）**

将整个方法替换为：

```python
    def _update_symbol_size(self, node_id):
        if node_id in self.nodes:
            value = self.nodes[node_id]["value"]
            min_size = 8
            max_size = 80
            max_value = 50000
            exponent = 0.7

            if value <= 0:
                size = min_size
            else:
                normalized = (math.log(value + 1) / math.log(max_value + 1)) ** exponent
                size = min_size + (max_size - min_size) * normalized
                size = min(max_size, max(min_size, int(round(size))))

            self.nodes[node_id]["symbolSize"] = size

            if value < 10:
                level = 0
            elif value < 100:
                level = 1
            elif value < 1000:
                level = 2
            elif value < 10000:
                level = 3
            else:
                level = 4
            self.nodes[node_id]["size_level"] = level
```

**3c. 在文件顶部添加 math 导入**

在第 1 行添加：
```python
import math
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
cd /workspace/backend && python -m pytest tests/test_data_processor.py -v
```
Expected: 6 tests PASS

- [ ] **Step 5: 验证 get_full_data 输出包含新字段**

Run 以下快速验证脚本：
```bash
cd /workspace/backend && python -c "
from data_processor import RelationDataProcessor
p = RelationDataProcessor()
p.set_login_user('123', 'test')
p._add_node('g1', '群1', 'group')
for i in range(150):
    p._add_node(f'u{i}', f'用户{i}', 'stranger')
    p._add_link('g1', f'u{i}', 'group')
data = p.get_full_data()
group_node = [n for n in data['nodes'] if n['id'] == 'g1'][0]
print(f'symbolSize: {group_node[\"symbolSize\"]}')
print(f'size_level: {group_node[\"size_level\"]}')
print(f'value: {group_node[\"value\"]}')
"
```
Expected: 输出 symbolSize 在 45-50 之间，size_level = 2，value = 150

- [ ] **Step 6: Commit**

```bash
cd /workspace
git add backend/data_processor.py backend/tests/test_data_processor.py
git commit -m "feat: 节点大小改为对数标度，添加 size_level 分级"
```

---

### Task 2: 前端自适应力导向参数模块

**Files:**
- Create: `frontend/js/force-config.js`
- Modify: `frontend/js/app.js:66-140`

#### 问题背景

当前力导向参数是固定的（repulsion=100, edgeLength=50, gravity=0.1, friction=0.9），在节点数量从几十到几万的跨度下表现不佳：
- 节点少时，斥力太小导致聚集
- 节点多时，斥力太大导致发散、收敛慢
- friction 固定导致动画时间不可控

#### 自适应策略

根据节点数量 N 动态计算力导向参数：

```
分级策略：
- Level 0 (N <= 100): 小数据量，高质量动画
- Level 1 (100 < N <= 500): 中等数据量，平衡质量与性能
- Level 2 (500 < N <= 2000): 大数据量，性能优先
- Level 3 (2000 < N <= 10000): 超大数量，最低画质
- Level 4 (N > 10000): 极限模式，关闭动画

参数计算模型：
repulsion = base_repulsion * scale_factor
  - base_repulsion 随 N 增长（但增速递减）
  - scale_factor = 1 + log10(max(N, 1)) * 0.3  （对数增长）
  - 实际采用分段常数值，避免浮点计算

edgeLength = base_edgeLength * scale_factor
  - 节点越多，边长越大，防止过度重叠

gravity: 随 N 增大而增大，防止节点飘散

friction: 随 N 增大而减小（更接近0），加快收敛
```

具体参数表：

| 节点数 N | repulsion | edgeLength | gravity | friction | 动画时长 |
|---------|-----------|------------|---------|----------|---------|
| <= 100 | 150 | 60 | 0.05 | 0.92 | 1000ms |
| 101 ~ 500 | 200 | 70 | 0.08 | 0.88 | 800ms |
| 501 ~ 2000 | 250 | 80 | 0.12 | 0.82 | 600ms |
| 2001 ~ 10000 | 300 | 90 | 0.15 | 0.75 | 400ms |
| > 10000 | 400 | 100 | 0.2 | 0.6 | 200ms |

- [ ] **Step 1: 创建力导向配置模块**

创建 `frontend/js/force-config.js`：

```javascript
const ForceConfig = (function() {
    const LEVELS = [
        { maxNodes: 100, repulsion: 150, edgeLength: 60, gravity: 0.05, friction: 0.92, animationDuration: 1000, label: "流畅" },
        { maxNodes: 500, repulsion: 200, edgeLength: 70, gravity: 0.08, friction: 0.88, animationDuration: 800, label: "良好" },
        { maxNodes: 2000, repulsion: 250, edgeLength: 80, gravity: 0.12, friction: 0.82, animationDuration: 600, label: "标准" },
        { maxNodes: 10000, repulsion: 300, edgeLength: 90, gravity: 0.15, friction: 0.75, animationDuration: 400, label: "性能" },
        { maxNodes: Infinity, repulsion: 400, edgeLength: 100, gravity: 0.2, friction: 0.6, animationDuration: 200, label: "极速" }
    ];

    function getLevel(nodeCount) {
        for (let i = 0; i < LEVELS.length; i++) {
            if (nodeCount <= LEVELS[i].maxNodes) {
                return { index: i, ...LEVELS[i] };
            }
        }
        return { index: LEVELS.length - 1, ...LEVELS[LEVELS.length - 1] };
    }

    function getForceConfig(nodeCount) {
        const level = getLevel(nodeCount);
        return {
            repulsion: level.repulsion,
            edgeLength: level.edgeLength,
            gravity: level.gravity,
            friction: level.friction,
            animationDuration: level.animationDuration,
            levelIndex: level.index,
            levelLabel: level.label
        };
    }

    function shouldShowLabels(nodeCount) {
        return nodeCount <= 500;
    }

    function shouldEnableAnimation(nodeCount) {
        return nodeCount <= 10000;
    }

    return {
        getLevel,
        getForceConfig,
        shouldShowLabels,
        shouldEnableAnimation
    };
})();
```

- [ ] **Step 2: 在 index.html 中引入新模块**

修改 `frontend/index.html`，在 `app.js` 之前添加：
```html
<script src="js/force-config.js"></script>
```

放在 `<script src="js/app.js"></script>` 之前。

- [ ] **Step 3: 修改 app.js 使用自适应配置**

修改 `frontend/js/app.js` 的 `getBaseOption` 函数（第66-140行）：

将第 91-92 行和第 132-137 行的 force 配置替换为自适应版本。

**3a. 在 renderCurrentView 中计算节点数和配置**

在 `renderCurrentView` 函数（第142-150行）中添加配置计算：

```javascript
function renderCurrentView() {
    const t0 = performance.now();
    const { nodes, links } = getCurrentViewData();
    const forceConfig = ForceConfig.getForceConfig(nodes.length);
    const option = getBaseOption(nodes, links, forceConfig);
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
    const t1 = performance.now();
    const elapsed = t1 - t0;
    updatePerformanceMonitor(elapsed, nodes.length, forceConfig);
}
```

**3b. 修改 getBaseOption 接受 forceConfig 参数**

函数签名改为：
```javascript
function getBaseOption(nodes, links, forceConfig) {
```

将第 91-92 行：
```javascript
animationDurationUpdate: 500,
animationEasingUpdate: "quinticInOut",
```
替换为：
```javascript
animationDurationUpdate: forceConfig.animationDuration,
animationEasingUpdate: "quinticInOut",
```

将第 132-137 行：
```javascript
force: {
    repulsion: 100,
    edgeLength: 50,
    gravity: 0.1,
    friction: 0.9
}
```
替换为：
```javascript
force: {
    repulsion: forceConfig.repulsion,
    edgeLength: forceConfig.edgeLength,
    gravity: forceConfig.gravity,
    friction: forceConfig.friction
}
```

**3c. 更新 updatePerformanceMonitor 函数**

修改 `updatePerformanceMonitor` 函数（第152-166行）以显示力导向等级：

```javascript
function updatePerformanceMonitor(elapsed, nodeCount, forceConfig) {
    perfHistory.push(elapsed);
    if (perfHistory.length > 10) perfHistory.shift();
    const avg = perfHistory.reduce((a, b) => a + b, 0) / perfHistory.length;

    let newLevel = 0;
    if (avg > 500 || nodeCount > 10000) newLevel = 3;
    else if (avg > 250 || nodeCount > 2000) newLevel = 2;
    else if (avg > 100 || nodeCount > 500) newLevel = 1;

    if (newLevel !== performanceLevel) {
        performanceLevel = newLevel;
        applyPerformanceSettings();
    }

    const perfBadge = document.getElementById("perfLevelBadge");
    if (perfBadge && forceConfig) {
        perfBadge.textContent = `性能: ${forceConfig.levelLabel} (${nodeCount}节点)`;
    }
}
```

- [ ] **Step 4: 添加性能等级显示元素**

在 `frontend/index.html` 中添加性能等级显示。在 `connectionStatus` 旁边添加：

```html
<div id="perfLevelBadge" class="status-badge status-connected" style="margin-left: 8px;">
    <span class="status-text">性能: 流畅</span>
</div>
```

- [ ] **Step 5: 手动验证**

打开浏览器访问页面，观察：
1. 数据量小时（<100节点），性能等级显示"流畅"
2. 加载大量节点后，性能等级自动切换
3. 节点越多，动画越快收敛

- [ ] **Step 6: Commit**

```bash
cd /workspace
git add frontend/js/force-config.js frontend/js/app.js frontend/index.html
git commit -m "feat: 自适应力导向参数，根据节点数动态调整"
```

---

### Task 3: 前端分级降级渲染策略

**Files:**
- Modify: `frontend/js/app.js:168-199`
- Modify: `frontend/css/style.css`

#### 问题背景

当节点数达到万级时，标签渲染、高亮效果、线条样式等都会严重影响性能。需要根据节点数量自动降级。

#### 降级策略

| 节点数 N | 标签 | 线条透明度 | 节点边框 | 高亮效果 | roam 缩放质量 |
|---------|------|-----------|---------|---------|--------------|
| <= 500 | 全部显示 | 0.3 | 有 | adjacency | 高质量 |
| 501 ~ 2000 | 仅选中/hover时 | 0.2 | 简化 | 简化 | 中质量 |
| 2001 ~ 10000 | 不显示 | 0.1 | 无 | 关闭 | 低质量 |
| > 10000 | 不显示 | 0.05 | 无 | 关闭 | 最低 |

- [ ] **Step 1: 修改 getBaseOption 添加降级逻辑**

在 `getBaseOption` 函数中根据 `forceConfig.levelIndex` 调整渲染参数：

在 `getBaseOption` 函数的 `series[0]` 配置中，添加条件判断：

```javascript
function getBaseOption(nodes, links, forceConfig) {
    const level = forceConfig.levelIndex;
    const showLabels = level <= 1 && window.showLabels !== false;
    const lineOpacity = [0.3, 0.2, 0.1, 0.05, 0.03][Math.min(level, 4)];
    const enableEmphasis = level <= 2;

    return {
        tooltip: {
            // ... 保持不变
        },
        legend: {
            // ... 保持不变
        },
        animationDurationUpdate: forceConfig.animationDuration,
        animationEasingUpdate: "quinticInOut",
        series: [{
            type: "graph",
            layout: "force",
            data: nodes,
            links: links,
            categories: graphData.categories,
            roam: level <= 3,
            draggable: level <= 2,
            label: {
                show: showLabels,
                position: "right",
                formatter: function(params) {
                    if (multiSelectMode || multiSelectRelationshipMode) {
                        const nid = String(params.data.id);
                        if (selectedNodes.has(nid)) {
                            return `{b|${params.data.name}}`;
                        }
                        return "";
                    }
                    return `{b|${params.data.name}}`;
                },
                rich: {
                    b: {
                        fontSize: level <= 1 ? 11 : (level === 2 ? 10 : 9)
                    }
                }
            },
            lineStyle: {
                color: "#aaa",
                curveness: level <= 1 ? 0.1 : 0,
                opacity: lineOpacity,
                width: level <= 1 ? 1 : 0.8
            },
            emphasis: enableEmphasis ? {
                focus: "adjacency",
                lineStyle: {
                    width: 3,
                    color: "#888"
                }
            } : {
                focus: "none",
                lineStyle: {
                    width: 1
                }
            },
            force: {
                repulsion: forceConfig.repulsion,
                edgeLength: forceConfig.edgeLength,
                gravity: forceConfig.gravity,
                friction: forceConfig.friction
            },
            progressiveThreshold: level >= 2 ? 500 : 0,
            progressive: level >= 3 ? 200 : 0
        }]
    };
}
```

- [ ] **Step 2: 优化 applyPerformanceSettings 函数**

修改 `applyPerformanceSettings` 函数（第168-199行），让它与新的分级策略协调：

```javascript
function applyPerformanceSettings() {
    const optLabels = document.getElementById("optLabels");
    const optAcquaintance = document.getElementById("optAcquaintance");
    const optStranger = document.getElementById("optStranger");

    const nodeCount = graphData.nodes.length;
    const autoLabelOff = nodeCount > 2000;
    const autoAcquaintanceOff = nodeCount > 10000;
    const autoStrangerOff = nodeCount > 50000;

    if (performanceLevel >= 1 || autoLabelOff) {
        if (optLabels && optLabels.checked) {
            optLabels.checked = false;
            showLabels = false;
        }
    }
    if (performanceLevel >= 2 || autoAcquaintanceOff) {
        if (optAcquaintance && optAcquaintance.checked) {
            optAcquaintance.checked = false;
        }
    }
    if (performanceLevel >= 3 || autoStrangerOff) {
        if (optStranger && optStranger.checked) {
            optStranger.checked = false;
        }
    }

    if (performanceLevel > 0 || autoLabelOff) {
        const labels = [];
        if (performanceLevel >= 1 || autoLabelOff) labels.push("标签");
        if (performanceLevel >= 2 || autoAcquaintanceOff) labels.push("共同群好友");
        if (performanceLevel >= 3 || autoStrangerOff) labels.push("仅同群");
        if (labels.length > 0) {
            showToast(`性能优化：已自动关闭 ${labels.join("、")}`, "warning");
        }
        renderCurrentView();
    }
}
```

- [ ] **Step 3: 验证效果**

启动后端，加载不同数量的数据，观察：
1. 节点少时标签正常显示
2. 节点多时标签自动隐藏
3. 线条透明度自动降低
4. 大数量级时拖拽被禁用

- [ ] **Step 4: Commit**

```bash
cd /workspace
git add frontend/js/app.js frontend/css/style.css
git commit -m "feat: 分级降级渲染策略，大数量级自动降质"
```

---

### Task 4: 增量渲染优化（减少全量重绘）

**Files:**
- Modify: `frontend/js/app.js:723-748`

#### 问题背景

当前 `incrementalUpdate` 每次都调用 `renderCurrentView()`，而它使用 `notMerge: true` 全量重绘。在增量加载时，每次只新增少量节点，全量重绘浪费性能。

#### 优化策略

使用 ECharts 的 `appendData` 或合并式 setOption 来增量添加节点，避免完整重建。

- [ ] **Step 1: 重写 incrementalUpdate 函数**

修改 `incrementalUpdate` 函数（第723-748行）：

```javascript
function incrementalUpdate(delta) {
    if (!delta) return;

    const newNodeMap = {};
    delta.new_nodes.forEach(node => {
        const nid = String(node.id);
        if (!nodeMap[nid]) {
            graphData.nodes.push(node);
            nodeMap[nid] = node;
            newNodeMap[nid] = node;
        }
    });
    delta.new_links.forEach(link => {
        const src = String(link.source);
        const tgt = String(link.target);
        const key = src < tgt ? `${src}-${tgt}` : `${tgt}-${src}`;
        if (!linkMap[key]) {
            graphData.links.push(link);
            linkMap[key] = link;
        }
    });
    delta.updated_nodes.forEach(node => {
        const nid = String(node.id);
        if (nodeMap[nid]) {
            Object.assign(nodeMap[nid], node);
        }
    });

    const totalNodes = graphData.nodes.length;
    const useIncremental = totalNodes > 500 && delta.new_nodes.length < 500;

    if (useIncremental && chart) {
        chart.setOption({
            series: [{
                data: graphData.nodes,
                links: graphData.links
            }]
        }, { notMerge: false, lazyUpdate: true });
    } else {
        renderCurrentView();
    }
}
```

- [ ] **Step 2: 验证增量更新性能**

加载多个大群，观察：
1. 后续加载的群不会触发长时间卡顿
2. 新增节点平滑加入布局
3. 总数统计正确更新

- [ ] **Step 3: Commit**

```bash
cd /workspace
git add frontend/js/app.js
git commit -m "perf: 增量更新使用合并式 setOption，减少全量重绘"
```

---

### Task 5: 节点大小图例与规模视觉强化

**Files:**
- Modify: `frontend/js/app.js`
- Modify: `frontend/index.html`
- Modify: `frontend/css/style.css`

#### 问题背景

虽然节点大小用对数标度了，但用户可能不知道大小代表什么，也不容易快速判断哪个是百人群哪个是千人群。

#### 解决方案

1. 在侧边栏添加节点大小图例
2. 群节点根据 size_level 有不同的边框效果（光环、双层边框等）

- [ ] **Step 1: 添加 size_level 对应的视觉样式**

在 `getBaseOption` 函数中，为节点数据添加基于 `size_level` 的样式增强。在 `renderCurrentView` 之前处理节点数据：

添加一个新函数 `enhanceNodeStyles`：

```javascript
function enhanceNodeStyles(nodes) {
    return nodes.map(n => {
        const level = n.size_level || 0;
        const baseStyle = n.itemStyle || {};
        const enhanced = { ...n };

        if (n.type === "group") {
            const borderColors = ["#E74C3C", "#E67E22", "#F1C40F", "#2ECC71", "#9B59B6"];
            const borderWidths = [0, 1, 2, 3, 4];
            const shadowBlurs = [0, 0, 5, 10, 15];
            enhanced.itemStyle = {
                ...baseStyle,
                borderColor: borderColors[Math.min(level, 4)],
                borderWidth: borderWidths[Math.min(level, 4)],
                shadowBlur: shadowBlurs[Math.min(level, 4)],
                shadowColor: borderColors[Math.min(level, 4)]
            };
        }

        if (multiSelectMode && !multiSelectRelationshipMode) {
            const nid = String(n.id);
            const isSelected = selectedNodes.has(nid);
            enhanced.itemStyle = {
                ...enhanced.itemStyle,
                opacity: isSelected ? 1 : 0.3,
                borderColor: isSelected ? "#fff" : (enhanced.itemStyle?.borderColor),
                borderWidth: isSelected ? 2 : (enhanced.itemStyle?.borderWidth || 0)
            };
            enhanced.symbolSize = isSelected ? (n.symbolSize || 20) * 1.2 : n.symbolSize || 20;
        }

        return enhanced;
    });
}
```

在 `getDefaultViewData`、`getFocusedViewData`、`getMultiSelectRelationshipViewData` 中使用 `enhanceNodeStyles` 替代原来的多选模式样式处理。

- [ ] **Step 2: 在侧边栏添加节点大小图例**

在 `frontend/index.html` 的"显示选项"面板下方添加：

```html
<div class="panel">
    <h3>📏 节点大小说明</h3>
    <div class="size-legend">
        <div class="size-legend-item">
            <span class="size-dot" style="width:10px;height:10px;"></span>
            <span class="size-label">少量关联 (&lt;10)</span>
        </div>
        <div class="size-legend-item">
            <span class="size-dot" style="width:16px;height:16px;"></span>
            <span class="size-label">数十人 (10~99)</span>
        </div>
        <div class="size-legend-item">
            <span class="size-dot" style="width:22px;height:22px;border:2px solid #F1C40F;"></span>
            <span class="size-label">百人群 (100~999)</span>
        </div>
        <div class="size-legend-item">
            <span class="size-dot" style="width:30px;height:30px;border:3px solid #2ECC71;box-shadow:0 0 8px #2ECC71;"></span>
            <span class="size-label">千人群 (1k~9k)</span>
        </div>
        <div class="size-legend-item">
            <span class="size-dot" style="width:40px;height:40px;border:4px solid #9B59B6;box-shadow:0 0 12px #9B59B6;"></span>
            <span class="size-label">万人群 (1万+)</span>
        </div>
    </div>
</div>
```

- [ ] **Step 3: 添加 CSS 样式**

在 `frontend/css/style.css` 中添加：

```css
.size-legend {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.size-legend-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #666;
}

.size-dot {
    display: inline-block;
    background: #E74C3C;
    border-radius: 50%;
    flex-shrink: 0;
}
```

- [ ] **Step 4: 验证视觉效果**

加载包含不同规模群的数据，观察：
1. 不同大小的群节点有明显差异
2. 千人群以上有发光边框
3. 图例与实际节点样式匹配

- [ ] **Step 5: Commit**

```bash
cd /workspace
git add frontend/js/app.js frontend/index.html frontend/css/style.css
git commit -m "feat: 群节点按规模等级添加视觉样式和侧边栏图例"
```

---

## 自检清单

### Spec Coverage 检查

| 需求 | 对应Task | 状态 |
|------|---------|------|
| 加载动画长（性能优化） | Task 2, Task 3, Task 4 | ✅ |
| 万级节点卡顿 | Task 2, Task 3, Task 4 | ✅ |
| 百人群/千人群视觉区分 | Task 1, Task 5 | ✅ |
| 调整后的计算函数模型 | Task 1（对数公式） | ✅ |
| 力导向参数自适应 | Task 2 | ✅ |
| 分级降级渲染 | Task 3 | ✅ |

### Placeholder 扫描

检查所有步骤，确认：
- 没有 "TBD" / "TODO" / "implement later" ❌
- 每个测试都有完整代码 ✅
- 每个实现步骤都有完整代码 ✅
- 没有 "similar to Task N" 引用 ✅
- 所有命令都有预期输出 ✅

### 类型一致性检查

- `size_level`：后端 data_processor.py 中定义 → 前端 enhanceNodeStyles 中使用 → 一致 ✅
- `symbolSize`：后端计算（8-80范围）→ 前端直接使用 → 一致 ✅
- `ForceConfig.getForceConfig` 返回值 → `getBaseOption` 中使用 → 一致 ✅

---

Plan complete and saved to `docs/superpowers/plans/2026-06-28-performance-optimization-and-node-sizing.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
