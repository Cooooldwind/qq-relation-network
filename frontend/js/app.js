const API_BASE = "";
let chart = null;
let graphData = {
    nodes: [],
    links: [],
    categories: [
        { name: "自己", itemStyle: { color: "#FFD700", shadowBlur: 8, shadowColor: "rgba(255,255,255,0.5)" } },
        { name: "好友", itemStyle: { color: "#4A90D9", shadowBlur: 8, shadowColor: "rgba(255,255,255,0.4)" } },
        { name: "共同群好友", itemStyle: { color: "#87CEEB", shadowBlur: 8, shadowColor: "rgba(255,255,255,0.4)" } },
        { name: "仅同群", itemStyle: { color: "#B0C4DE", shadowBlur: 8, shadowColor: "rgba(255,255,255,0.4)" } },
        { name: "群", itemStyle: { color: "#E74C3C", shadowBlur: 8, shadowColor: "rgba(255,255,255,0.4)" } }
    ]
};
let nodeMap = {};
let linkMap = {};
let groups = [];
let friends = [];
let isLoading = false;
let pollTimer = null;
let completedGroupIds = new Set();
let showLabels = true;

let viewMode = "default";
let focusedNodeId = null;
let clickTimer = null;
let clickDelay = 300;
let multiSelectMode = false;
let multiSelectRelationshipMode = false;
let selectedNodes = new Set();
let performanceLevel = 0;
let perfHistory = [];

const COLORS = {
    self: "#FFD700",
    friend: "#4A90D9",
    acquaintance: "#87CEEB",
    stranger: "#B0C4DE",
    group: "#E74C3C"
};

const TYPE_LABELS = {
    self: "自己",
    friend: "好友",
    acquaintance: "共同群好友",
    stranger: "仅同群",
    group: "群"
};

document.addEventListener("DOMContentLoaded", init);

function init() {
    initChart();
    bindEvents();
    checkStatus();
    loadInitialData();
    window.addEventListener("resize", () => chart && chart.resize());
}

function initChart() {
    const chartDom = document.getElementById("chart");
    chart = echarts.init(chartDom);
    renderCurrentView();
    bindChartEvents();
}

function getBaseOption(nodes, links) {
    return {
        tooltip: {
            trigger: "item",
            formatter: function(params) {
                if (params.dataType === "node") {
                    const info = params.data.info || {};
                    let html = `<div style="font-weight:bold;margin-bottom:5px;">${params.data.name}</div>`;
                    html += `<div style="font-size:12px;color:#666;">类型: ${TYPE_LABELS[params.data.type] || params.data.type}</div>`;
                    if (info.qq) html += `<div style="font-size:12px;color:#666;">QQ: ${info.qq}</div>`;
                    if (info.common_group_count !== undefined) html += `<div style="font-size:12px;color:#666;">共同群数: ${info.common_group_count}</div>`;
                    if (info.member_count !== undefined) html += `<div style="font-size:12px;color:#666;">成员数: ${info.member_count}</div>`;
                    html += `<div style="font-size:12px;color:#666;">关联数: ${params.data.value}</div>`;
                    return html;
                }
                return "";
            }
        },
        legend: {
            data: ["自己", "好友", "共同群好友", "仅同群", "群"],
            top: 10,
            right: 20,
            itemWidth: 12,
            itemHeight: 12
        },
        animationDurationUpdate: 500,
        animationEasingUpdate: "quinticInOut",
        series: [{
            type: "graph",
            layout: "force",
            data: nodes,
            links: links,
            categories: graphData.categories,
            roam: true,
            draggable: true,
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
                        fontSize: 11
                    }
                }
            },
            lineStyle: {
                color: "#aaa",
                curveness: 0.1,
                opacity: 0.3
            },
            emphasis: {
                focus: "adjacency",
                lineStyle: {
                    width: 3,
                    color: "#888"
                }
            },
            force: {
                repulsion: 100,
                edgeLength: 50,
                gravity: 0.1,
                friction: 0.9
            }
        }]
    };
}

function renderCurrentView() {
    const t0 = performance.now();
    const { nodes, links } = getCurrentViewData();
    const option = getBaseOption(nodes, links);
    chart.setOption(option, { notMerge: true, lazyUpdate: false });
    const t1 = performance.now();
    const elapsed = t1 - t0;
    updatePerformanceMonitor(elapsed);
}

function updatePerformanceMonitor(elapsed) {
    perfHistory.push(elapsed);
    if (perfHistory.length > 10) perfHistory.shift();
    const avg = perfHistory.reduce((a, b) => a + b, 0) / perfHistory.length;

    let newLevel = 0;
    if (avg > 500) newLevel = 3;
    else if (avg > 250) newLevel = 2;
    else if (avg > 100) newLevel = 1;

    if (newLevel !== performanceLevel) {
        performanceLevel = newLevel;
        applyPerformanceSettings();
    }
}

function applyPerformanceSettings() {
    const optLabels = document.getElementById("optLabels");
    const optAcquaintance = document.getElementById("optAcquaintance");
    const optStranger = document.getElementById("optStranger");

    if (performanceLevel >= 1) {
        if (optLabels.checked) {
            optLabels.checked = false;
            showLabels = false;
        }
    }
    if (performanceLevel >= 2) {
        if (optAcquaintance.checked) {
            optAcquaintance.checked = false;
        }
    }
    if (performanceLevel >= 3) {
        if (optStranger.checked) {
            optStranger.checked = false;
        }
    }

    if (performanceLevel > 0) {
        const labels = ["标签", "共同群好友", "仅同群"];
        const disabled = [];
        if (performanceLevel >= 1) disabled.push(labels[0]);
        if (performanceLevel >= 2) disabled.push(labels[1]);
        if (performanceLevel >= 3) disabled.push(labels[2]);
        showToast(`性能优化：已自动关闭 ${disabled.join("、")}`, "warning");
        renderCurrentView();
    }
}

function getCurrentViewData() {
    if (multiSelectRelationshipMode) {
        return getMultiSelectRelationshipViewData();
    }
    if (viewMode === "focused" && focusedNodeId) {
        return getFocusedViewData(focusedNodeId);
    }
    return getDefaultViewData();
}

function getDefaultViewData() {
    const showSelf = document.getElementById("optSelf").checked;
    const showFriends = document.getElementById("optFriends").checked;
    const showAcquaintance = document.getElementById("optAcquaintance").checked;
    const showStranger = document.getElementById("optStranger").checked;
    const showGroups = document.getElementById("optGroups").checked;

    const filteredNodes = graphData.nodes.filter(n => {
        if (n.type === "self") return showSelf;
        if (n.type === "friend") return showFriends;
        if (n.type === "acquaintance") return showAcquaintance;
        if (n.type === "stranger") return showStranger;
        if (n.type === "group") return showGroups;
        return true;
    });

    // 多选模式下淡化未选中的节点
    const nodesToRender = filteredNodes.map(n => {
        if (multiSelectMode && !multiSelectRelationshipMode) {
            const nid = String(n.id);
            const isSelected = selectedNodes.has(nid);
            return {
                ...n,
                itemStyle: {
                    ...(n.itemStyle || {}),
                    opacity: isSelected ? 1 : 0.3,
                    borderColor: isSelected ? "#fff" : undefined,
                    borderWidth: isSelected ? 2 : 0
                },
                symbolSize: isSelected ? (n.symbolSize || 20) * 1.2 : n.symbolSize || 20
            };
        }
        return n;
    });

    const visibleIds = new Set(filteredNodes.map(n => String(n.id)));
    const filteredLinks = graphData.links.filter(l =>
        visibleIds.has(String(l.source)) && visibleIds.has(String(l.target))
    );

    return { nodes: nodesToRender, links: filteredLinks };
}

function getFocusedViewData(nodeId) {
    const nid = String(nodeId);
    const node = nodeMap[nid];
    if (!node) return { nodes: [], links: [] };

    const showStranger = document.getElementById("optStranger").checked;
    const visibleNodeIds = new Set();
    visibleNodeIds.add(nid);

    const selfNode = graphData.nodes.find(n => n.type === "self");
    if (selfNode) {
        visibleNodeIds.add(String(selfNode.id));
    }

    if (node.type === "group") {
        graphData.links.forEach(link => {
            const src = String(link.source);
            const tgt = String(link.target);
            if (src === nid || tgt === nid) {
                const otherId = src === nid ? tgt : src;
                const otherNode = nodeMap[otherId];
                if (otherNode) {
                    if (otherNode.type === "stranger" && !showStranger) return;
                    visibleNodeIds.add(otherId);
                }
            }
        });
    } else if (node.type === "friend" || node.type === "acquaintance") {
        const neighborGroupIds = new Set();
        graphData.links.forEach(link => {
            const src = String(link.source);
            const tgt = String(link.target);
            if (src === nid || tgt === nid) {
                const otherId = src === nid ? tgt : src;
                const otherNode = nodeMap[otherId];
                if (otherNode && otherNode.type === "group") {
                    neighborGroupIds.add(otherId);
                }
            }
        });
        neighborGroupIds.forEach(gid => visibleNodeIds.add(gid));
    }

    const filteredNodes = graphData.nodes.filter(n => visibleNodeIds.has(String(n.id)));
    const filteredLinks = graphData.links.filter(l =>
        visibleNodeIds.has(String(l.source)) && visibleNodeIds.has(String(l.target))
    );

    return { nodes: filteredNodes, links: filteredLinks };
}

function getMultiSelectRelationshipViewData() {
    if (selectedNodes.size === 0) {
        return { nodes: [], links: [] };
    }

    const showAcquaintance = document.getElementById("optAcquaintance").checked;
    const showStranger = document.getElementById("optStranger").checked;
    const visibleNodeIds = new Set(selectedNodes);

    // 找出选中的群节点和非群节点
    const selectedGroupIds = new Set();
    const selectedNonGroupIds = new Set();
    selectedNodes.forEach(nid => {
        const node = nodeMap[nid];
        if (node && node.type === "group") {
            selectedGroupIds.add(nid);
        } else {
            selectedNonGroupIds.add(nid);
        }
    });

    // 找出连接选中节点的群（如果选中了多个非群节点，找它们的共同群）
    const connectingGroups = new Set();
    if (selectedNonGroupIds.size >= 2) {
        graphData.links.forEach(link => {
            const src = String(link.source);
            const tgt = String(link.target);
            const srcNode = nodeMap[src];
            const tgtNode = nodeMap[tgt];
            if (srcNode?.type === "group" && selectedNonGroupIds.has(tgt)) {
                connectingGroups.add(src);
            } else if (tgtNode?.type === "group" && selectedNonGroupIds.has(src)) {
                connectingGroups.add(tgt);
            }
        });
    }

    // 如果选中了多个群，找出这些群的共同成员
    const connectingMembers = new Set();
    if (selectedGroupIds.size >= 2) {
        graphData.links.forEach(link => {
            const src = String(link.source);
            const tgt = String(link.target);
            const srcNode = nodeMap[src];
            const tgtNode = nodeMap[tgt];
            if (selectedGroupIds.has(src) && tgtNode && tgtNode.type !== "group") {
                if (showAcquaintance || tgtNode.type !== "acquaintance") {
                    if (showStranger || tgtNode.type !== "stranger") {
                        connectingMembers.add(tgt);
                    }
                }
            } else if (selectedGroupIds.has(tgt) && srcNode && srcNode.type !== "group") {
                if (showAcquaintance || srcNode.type !== "acquaintance") {
                    if (showStranger || srcNode.type !== "stranger") {
                        connectingMembers.add(src);
                    }
                }
            }
        });
        // 只保留同时属于多个选中群的成员
        const groupMemberCount = {};
        connectingMembers.forEach(mid => {
            groupMemberCount[mid] = 0;
            selectedGroupIds.forEach(gid => {
                const key = mid < gid ? `${mid}-${gid}` : `${gid}-${mid}`;
                if (linkMap[key]) {
                    groupMemberCount[mid]++;
                }
            });
        });
        Object.keys(groupMemberCount).forEach(mid => {
            if (groupMemberCount[mid] >= 2) {
                visibleNodeIds.add(mid);
            }
        });
    }

    // 添加这些群
    connectingGroups.forEach(gid => visibleNodeIds.add(gid));

    // 添加_self节点
    const selfNode = graphData.nodes.find(n => n.type === "self");
    if (selfNode && selectedNodes.size > 1) {
        visibleNodeIds.add(String(selfNode.id));
    }

    // 过滤节点
    const filteredNodes = graphData.nodes.filter(n => {
        if (!visibleNodeIds.has(String(n.id))) return false;
        if (n.type === "acquaintance" && !showAcquaintance) return false;
        if (n.type === "stranger" && !showStranger) return false;
        return true;
    });

    // 过滤连线（只保留两端都在可见节点中的）
    const filteredLinks = graphData.links.filter(l =>
        visibleNodeIds.has(String(l.source)) && visibleNodeIds.has(String(l.target))
    );

    return { nodes: filteredNodes, links: filteredLinks };
}

function bindChartEvents() {
    chart.on("click", function(params) {
        if (params.dataType === "node") {
            handleNodeClick(params);
        } else {
            handleBlankClick();
        }
    });
}

function handleNodeClick(params) {
    const nodeId = String(params.data.id);
    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        handleNodeDoubleClick(nodeId);
    } else {
        clickTimer = setTimeout(() => {
            clickTimer = null;
            handleNodeSingleClick(nodeId, params);
        }, clickDelay);
    }
}

function handleNodeSingleClick(nodeId, params) {
    if (multiSelectMode) {
        toggleNodeSelection(nodeId);
        return;
    }
    showNodePopup(nodeId, params.event);
}

function toggleNodeSelection(nodeId) {
    const nid = String(nodeId);
    if (selectedNodes.has(nid)) {
        selectedNodes.delete(nid);
    } else {
        selectedNodes.add(nid);
    }
    renderCurrentView();
}

function handleNodeDoubleClick(nodeId) {
    hideNodePopup();
    enterFocusedView(nodeId);
}

function handleBlankClick() {
    hideNodePopup();
    if (multiSelectRelationshipMode) {
        exitMultiSelectRelationship();
        return;
    }
    if (viewMode === "focused") {
        exitFocusedView();
        return;
    }
}

function showNodePopup(nodeId, event) {
    const node = nodeMap[String(nodeId)];
    if (!node) return;

    const popup = document.getElementById("nodePopup");
    const avatarEl = document.getElementById("popupAvatar");
    const nameEl = document.getElementById("popupName");
    const typeEl = document.getElementById("popupType");
    const infoListEl = document.getElementById("popupInfoList");

    nameEl.textContent = node.name || "未知";
    typeEl.textContent = TYPE_LABELS[node.type] || node.type;

    if (node.type === "group") {
        avatarEl.style.display = "none";
        if (!document.querySelector(".popup-avatar-group")) {
            const groupAvatar = document.createElement("div");
            groupAvatar.className = "popup-avatar-group";
            groupAvatar.id = "popupGroupAvatar";
            groupAvatar.textContent = "群";
            avatarEl.parentNode.insertBefore(groupAvatar, avatarEl);
        }
    } else {
        const groupAvatar = document.getElementById("popupGroupAvatar");
        if (groupAvatar) groupAvatar.remove();
        avatarEl.style.display = "block";
        const qq = node.info?.qq || node.id;
        avatarEl.src = `https://q.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=100`;
        avatarEl.onerror = function() {
            this.src = "";
            this.style.display = "none";
        };
    }

    const info = node.info || {};
    let infoHtml = "";

    if (node.type !== "group" && info.qq) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">QQ号</span><span class="popup-info-value">${info.qq}</span></div>`;
    }
    if (info.remark) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">备注</span><span class="popup-info-value">${info.remark}</span></div>`;
    }
    if (info.card) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">群名片</span><span class="popup-info-value">${info.card}</span></div>`;
    }
    if (info.common_group_count !== undefined) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">共同群</span><span class="popup-info-value">${info.common_group_count} 个</span></div>`;
    }
    if (info.member_count !== undefined) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">成员数</span><span class="popup-info-value">${info.member_count} 人</span></div>`;
    }
    if (info.group_id) {
        infoHtml += `<div class="popup-info-item"><span class="popup-info-label">群号</span><span class="popup-info-value">${info.group_id}</span></div>`;
    }
    infoHtml += `<div class="popup-info-item"><span class="popup-info-label">关联数</span><span class="popup-info-value">${node.value || 0}</span></div>`;

    infoListEl.innerHTML = infoHtml;

    const chartRect = document.getElementById("chart").getBoundingClientRect();
    const contentRect = document.querySelector(".content").getBoundingClientRect();
    const popupWidth = 280;
    const popupHeight = 200;
    let left = (event?.offsetX || 100) + 20;
    let top = (event?.offsetY || 100) - 20;

    if (left + popupWidth > chartRect.width - 10) {
        left = (event?.offsetX || 100) - popupWidth - 20;
    }
    if (top + popupHeight > chartRect.height - 10) {
        top = chartRect.height - popupHeight - 10;
    }
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    popup.style.left = left + "px";
    popup.style.top = top + "px";
    popup.classList.add("show");
}

function hideNodePopup() {
    const popup = document.getElementById("nodePopup");
    popup.classList.remove("show");
}

function enterFocusedView(nodeId) {
    const node = nodeMap[String(nodeId)];
    if (!node) return;

    viewMode = "focused";
    focusedNodeId = String(nodeId);

    const indicator = document.getElementById("focusedIndicator");
    const textEl = document.getElementById("focusedText");
    textEl.textContent = `一级关系网: ${node.name}（点击空白处返回）`;
    indicator.classList.add("show");

    renderCurrentView();
}

function exitFocusedView() {
    viewMode = "default";
    focusedNodeId = null;

    const indicator = document.getElementById("focusedIndicator");
    indicator.classList.remove("show");

    renderCurrentView();
}

function toggleMultiSelectMode() {
    if (multiSelectRelationshipMode) {
        exitMultiSelectMode();
        return;
    }

    if (multiSelectMode) {
        if (selectedNodes.size < 2) {
            showToast("请选择至少2个节点", "warning");
            return;
        }
        enterMultiSelectRelationship();
    } else {
        multiSelectMode = true;
        selectedNodes.clear();
        document.getElementById("btnMultiSelect").textContent = "✔️ 查看关系";
        showToast("多选模式：点击节点选择/取消，再次点击按钮查看关系网", "info");
        renderCurrentView();
    }
}

function enterMultiSelectRelationship() {
    multiSelectRelationshipMode = true;
    document.getElementById("btnMultiSelect").textContent = "❌ 退出";
    const selectedNames = Array.from(selectedNodes).map(id => nodeMap[id]?.name || id).slice(0, 3).join(", ");
    showToast(`显示 ${selectedNames}${selectedNodes.size > 3 ? "..." : ""} 的关系网`, "info");
    renderCurrentView();
}

function exitMultiSelectRelationship() {
    multiSelectRelationshipMode = false;
    document.getElementById("btnMultiSelect").textContent = "✔️ 查看关系";
    renderCurrentView();
}

function exitMultiSelectMode() {
    multiSelectMode = false;
    multiSelectRelationshipMode = false;
    selectedNodes.clear();
    document.getElementById("btnMultiSelect").textContent = "☑️ 多选模式";
    renderCurrentView();
}

function bindEvents() {
    document.getElementById("btnMultiSelect").addEventListener("click", toggleMultiSelectMode);
    document.getElementById("btnRefresh").addEventListener("click", refreshData);
    document.getElementById("btnLoadAll").addEventListener("click", startLoadingAll);
    document.getElementById("btnStop").addEventListener("click", stopLoading);
    document.getElementById("optSelf").addEventListener("change", updateView);
    document.getElementById("optFriends").addEventListener("change", updateView);
    document.getElementById("optAcquaintance").addEventListener("change", updateView);
    document.getElementById("optStranger").addEventListener("change", updateView);
    document.getElementById("optGroups").addEventListener("change", updateView);
    document.getElementById("optLabels").addEventListener("change", toggleLabels);
    document.getElementById("groupSearch").addEventListener("input", filterGroups);
    document.getElementById("popupClose").addEventListener("click", hideNodePopup);
    document.getElementById("focusedClose").addEventListener("click", exitFocusedView);

    document.querySelector(".content").addEventListener("click", function(e) {
        if (e.target.id === "chart" || e.target === this) {
            hideNodePopup();
        }
    });
}

function updateView() {
    renderCurrentView();
}

function toggleLabels() {
    showLabels = document.getElementById("optLabels").checked;
    renderCurrentView();
}

async function checkStatus() {
    try {
        const resp = await fetch(API_BASE + "/api/status");
        const data = await resp.json();
        updateConnectionStatus(data.ok);
    } catch (e) {
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(connected) {
    const el = document.getElementById("connectionStatus");
    const textEl = el.querySelector(".status-text");
    if (connected) {
        el.className = "status-badge status-connected";
        textEl.textContent = "已连接";
    } else {
        el.className = "status-badge status-disconnected";
        textEl.textContent = "未连接";
    }
}

async function loadInitialData() {
    showLoading("正在加载数据...");
    try {
        const [friendsResp, groupsResp] = await Promise.all([
            fetch(API_BASE + "/api/friends").then(r => r.json()),
            fetch(API_BASE + "/api/groups").then(r => r.json())
        ]);
        if (friendsResp.ok) {
            friends = friendsResp.friends;
            document.getElementById("statFriends").textContent = friendsResp.count;
        }
        if (groupsResp.ok) {
            groups = groupsResp.groups;
            document.getElementById("statGroups").textContent = groupsResp.count;
            renderGroupList();
        }
        await loadRelationData();
    } catch (e) {
        showToast("数据加载失败: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

async function loadRelationData() {
    try {
        const resp = await fetch(API_BASE + "/api/relation_data");
        const data = await resp.json();
        if (data.ok) {
            graphData = data.data;
            rebuildNodeMap();
            updateStats(data.stats.node_count, data.stats.link_count);
            renderCurrentView();
        }
    } catch (e) {
        console.error("加载关系数据失败:", e);
    }
}

function rebuildNodeMap() {
    nodeMap = {};
    linkMap = {};
    graphData.nodes.forEach(n => nodeMap[String(n.id)] = n);
    graphData.links.forEach(l => {
        const src = String(l.source);
        const tgt = String(l.target);
        const key = src < tgt ? `${src}-${tgt}` : `${tgt}-${src}`;
        linkMap[key] = l;
    });
}

function incrementalUpdate(delta) {
    if (!delta) return;
    delta.new_nodes.forEach(node => {
        const nid = String(node.id);
        if (!nodeMap[nid]) {
            graphData.nodes.push(node);
            nodeMap[nid] = node;
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
    renderCurrentView();
}

function updateStats(nodes, links) {
    document.getElementById("statNodes").textContent = nodes;
    document.getElementById("statLinks").textContent = links;
    updateTypeCounts();
}

function updateTypeCounts() {
    const counts = { self: 0, friend: 0, acquaintance: 0, stranger: 0, group: 0 };
    graphData.nodes.forEach(n => {
        if (counts[n.type] !== undefined) counts[n.type]++;
    });
    document.getElementById("countSelf").textContent = counts.self;
    document.getElementById("countFriends").textContent = counts.friend;
    document.getElementById("countAcquaintance").textContent = counts.acquaintance;
    document.getElementById("countStranger").textContent = counts.stranger;
    document.getElementById("countGroups").textContent = counts.group;
}

function renderGroupList() {
    const container = document.getElementById("groupList");
    const keyword = document.getElementById("groupSearch").value.toLowerCase();
    const filtered = groups.filter(g =>
        g.group_name.toLowerCase().includes(keyword) ||
        String(g.group_id).includes(keyword)
    );
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-hint">没有找到群</div>';
        return;
    }
    let html = "";
    filtered.forEach(g => {
        let statusClass = "group-status-pending";
        let statusText = "待加载";
        if (completedGroupIds.has(String(g.group_id))) {
            statusClass = "group-status-done";
            statusText = "已加载";
        }
        html += `
            <div class="group-item" data-group-id="${g.group_id}">
                <span class="group-name" title="${g.group_name}">${g.group_name}</span>
                <span class="group-member-count">${g.member_count}人</span>
                <span class="group-status ${statusClass}">${statusText}</span>
            </div>
        `;
    });
    container.innerHTML = html;
    container.querySelectorAll(".group-item").forEach(item => {
        item.addEventListener("click", () => {
            const gid = item.dataset.groupId;
            loadSingleGroup(gid);
        });
    });
}

function filterGroups() {
    renderGroupList();
}

async function loadSingleGroup(groupId) {
    if (completedGroupIds.has(String(groupId))) {
        showToast("该群已加载", "info");
        return;
    }
    showLoading("加载群成员...");
    try {
        const resp = await fetch(API_BASE + `/api/group_members/${groupId}`);
        const data = await resp.json();
        if (data.ok) {
            completedGroupIds.add(String(groupId));
            renderGroupList();
            await loadRelationData();
            showToast(`已加载 ${data.count} 个成员`, "success");
        } else {
            showToast("加载失败: " + data.error, "error");
        }
    } catch (e) {
        showToast("加载失败: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

async function startLoadingAll() {
    if (isLoading) return;
    const threadCount = parseInt(document.getElementById("threadCount").value);
    showLoading("启动加载任务...");
    try {
        const resp = await fetch(API_BASE + "/api/start_loading", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thread_count: threadCount })
        });
        const data = await resp.json();
        if (data.ok) {
            isLoading = true;
            completedGroupIds = new Set();
            document.getElementById("btnLoadAll").style.display = "none";
            document.getElementById("btnStop").style.display = "inline-block";
            document.getElementById("progressContainer").style.display = "flex";
            showToast(`开始加载 ${data.total_groups} 个群的成员`, "info");
            startPolling();
        } else {
            showToast("启动失败: " + data.error, "error");
        }
    } catch (e) {
        showToast("启动失败: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollProgress, 500);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

async function pollProgress() {
    try {
        const resp = await fetch(API_BASE + "/api/loading_progress");
        const data = await resp.json();
        if (!data.ok) return;
        const percent = data.total_count > 0 ? (data.completed_count / data.total_count * 100) : 0;
        document.getElementById("progressFill").style.width = percent + "%";
        document.getElementById("progressText").textContent = `${data.completed_count} / ${data.total_count} 群`;
        if (data.incremental && (data.incremental.new_nodes.length > 0 || data.incremental.new_links.length > 0)) {
            incrementalUpdate(data.incremental);
            updateStats(data.total_nodes, data.total_links);
            const newIds = data.all_completed_ids.filter(id => !completedGroupIds.has(id));
            newIds.forEach(id => completedGroupIds.add(id));
            renderGroupList();
        }
        if (data.status === "completed" || data.status === "stopped") {
            isLoading = false;
            stopPolling();
            document.getElementById("btnLoadAll").style.display = "inline-block";
            document.getElementById("btnStop").style.display = "none";
            if (data.status === "completed") {
                showToast("全部加载完成！", "success");
            } else {
                showToast("已停止加载", "info");
            }
        }
    } catch (e) {
        console.error("轮询进度失败:", e);
    }
}

async function stopLoading() {
    try {
        await fetch(API_BASE + "/api/stop_loading", { method: "POST" });
    } catch (e) {
        console.error("停止失败:", e);
    }
}

async function refreshData() {
    if (isLoading) {
        showToast("正在加载中，请先停止", "warning");
        return;
    }
    exitFocusedView();
    hideNodePopup();
    showLoading("正在刷新数据...");
    try {
        await fetch(API_BASE + "/api/reset", { method: "POST" });
        completedGroupIds.clear();
        await loadInitialData();
        showToast("刷新成功", "success");
    } catch (e) {
        showToast("刷新失败: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

function showLoading(text = "加载中...") {
    document.getElementById("loadingText").textContent = text;
    document.getElementById("loadingOverlay").style.display = "flex";
}

function hideLoading() {
    document.getElementById("loadingOverlay").style.display = "none";
}

let toastTimer = null;
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.className = "toast";
    }, 2500);
}
