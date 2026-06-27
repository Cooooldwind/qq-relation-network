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

const COLORS = {
    self: "#FFD700",
    friend: "#4A90D9",
    acquaintance: "#87CEEB",
    stranger: "#B0C4DE",
    group: "#E74C3C"
};

document.addEventListener("DOMContentLoaded", init);

function init() {
    initChart();
    bindEvents();
    checkStatus();
    loadInitialData();
    window.addEventListener("resize", () => chart && chart.resize());
}

let highlightedNodeId = null;

function initChart() {
    renderChart();
}

function renderChart() {
    const chartDom = document.getElementById("chart");
    if (chart) {
        chart.dispose();
    }
    chart = echarts.init(chartDom);
    const option = {
        series: [{
            type: "graph",
            layout: "force",
            data: graphData.nodes,
            links: graphData.links,
            categories: graphData.categories,
            roam: true,
            draggable: true,
            label: {
                show: showLabels
            },
            force: {
                repulsion: 50,
                edgeLength: 80,
                gravity: 0.1,
                friction: 0.95
            }
        }]
    };
    chart.setOption(option);
    bindChartEvents();
}

function bindChartEvents() {
    chart.on("click", function(params) {
        if (params.dataType === "node") {
            if (highlightedNodeId === params.data.id) {
                clearHighlight();
            } else {
                highlightNode(params.data.id);
            }
        } else {
            clearHighlight();
        }
    });
}

function getNeighborIds(nodeId) {
    const neighbors = new Set();
    neighbors.add(String(nodeId));
    graphData.links.forEach(link => {
        const src = String(link.source);
        const tgt = String(link.target);
        if (src === String(nodeId)) {
            neighbors.add(tgt);
        }
        if (tgt === String(nodeId)) {
            neighbors.add(src);
        }
    });
    return neighbors;
}

function highlightNode(nodeId) {
    highlightedNodeId = String(nodeId);
    const neighborIds = getNeighborIds(nodeId);
    // 先按复选框过滤，再应用高亮
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
    const visibleIds = new Set(filteredNodes.map(n => n.id));
    const newNodes = graphData.nodes.map(node => {
        const nid = String(node.id);
        const isVisible = visibleIds.has(nid);
        const isRelated = neighborIds.has(nid);
        return {
            ...node,
            itemStyle: {
                ...node.itemStyle,
                opacity: isVisible ? (isRelated ? 1 : 0.1) : 0
            },
            label: {
                opacity: isVisible ? (isRelated ? 1 : 0.1) : 0
            }
        };
    });
    const newLinks = graphData.links.map(link => {
        const src = String(link.source);
        const tgt = String(link.target);
        const srcVisible = visibleIds.has(src);
        const tgtVisible = visibleIds.has(tgt);
        const isRelated = src === String(nodeId) || tgt === String(nodeId);
        return {
            ...link,
            lineStyle: {
                ...(link.lineStyle || {}),
                opacity: (srcVisible && tgtVisible) ? (isRelated ? 1 : 0.05) : 0
            }
        };
    });
    chart.setOption({
        series: [{
            data: newNodes,
            links: newLinks
        }]
    });
}

function clearHighlight() {
    highlightedNodeId = null;
    updateVisibility();
}

function getBaseOption() {
    return {
        title: {
            show: false
        },
        tooltip: {
            trigger: "item",
            formatter: function(params) {
                if (params.dataType === "node") {
                    const info = params.data.info || {};
                    const typeMap = {
                        "self": "自己",
                        "friend": "好友",
                        "acquaintance": "共同群好友",
                        "stranger": "仅同群",
                        "group": "群"
                    };
                    let html = `<div style="font-weight:bold;margin-bottom:5px;">${params.data.name}</div>`;
                    html += `<div style="font-size:12px;color:#666;">类型: ${typeMap[params.data.type] || params.data.type}</div>`;
                    if (info.qq) {
                        html += `<div style="font-size:12px;color:#666;">QQ: ${info.qq}</div>`;
                    }
                    if (info.remark) {
                        html += `<div style="font-size:12px;color:#666;">备注: ${info.remark}</div>`;
                    }
                    if (info.card) {
                        html += `<div style="font-size:12px;color:#666;">群名片: ${info.card}</div>`;
                    }
                    if (info.common_group_count !== undefined) {
                        html += `<div style="font-size:12px;color:#666;">共同群数: ${info.common_group_count}</div>`;
                    }
                    if (info.member_count !== undefined) {
                        html += `<div style="font-size:12px;color:#666;">成员数: ${info.member_count}</div>`;
                    }
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
            data: graphData.nodes,
            links: graphData.links,
            categories: graphData.categories,
            roam: true,
            draggable: true,
            label: {
                show: true,
                position: "right",
                formatter: "{b}",
                fontSize: 11
            },
            lineStyle: {
                color: "source",
                curveness: 0.1,
                opacity: 0.4
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
                repulsion: 30,
                edgeLength: 100,
                gravity: 0.3,
                friction: 0.98
            }
        }]
    };
}

function bindEvents() {
    document.getElementById("btnRefresh").addEventListener("click", refreshData);
    document.getElementById("btnLoadAll").addEventListener("click", startLoadingAll);
    document.getElementById("btnStop").addEventListener("click", stopLoading);
    document.getElementById("optSelf").addEventListener("change", updateVisibility);
    document.getElementById("optFriends").addEventListener("change", updateVisibility);
    document.getElementById("optAcquaintance").addEventListener("change", updateVisibility);
    document.getElementById("optStranger").addEventListener("change", updateVisibility);
    document.getElementById("optGroups").addEventListener("change", updateVisibility);
    document.getElementById("optLabels").addEventListener("change", toggleLabels);
    document.getElementById("groupSearch").addEventListener("input", filterGroups);
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
            updateVisibility();
        }
    } catch (e) {
        console.error("加载关系数据失败:", e);
    }
}

function rebuildNodeMap() {
    nodeMap = {};
    linkMap = {};
    graphData.nodes.forEach(n => nodeMap[n.id] = n);
    graphData.links.forEach(l => {
        const key = l.source < l.target ? `${l.source}-${l.target}` : `${l.target}-${l.source}`;
        linkMap[key] = l;
    });
}

function updateChart() {
    if (!document.getElementById("chart")) return;
    renderChart();
}

function incrementalUpdate(delta) {
    if (!delta) return;
    delta.new_nodes.forEach(node => {
        if (!nodeMap[node.id]) {
            graphData.nodes.push(node);
            nodeMap[node.id] = node;
        }
    });
    delta.new_links.forEach(link => {
        const key = link.source < link.target ? `${link.source}-${link.target}` : `${link.target}-${link.source}`;
        if (!linkMap[key]) {
            graphData.links.push(link);
            linkMap[key] = link;
        }
    });
    delta.updated_nodes.forEach(node => {
        if (nodeMap[node.id]) {
            Object.assign(nodeMap[node.id], node);
        }
    });
    updateVisibility();
}

function updateStats(nodes, links) {
    document.getElementById("statNodes").textContent = nodes;
    document.getElementById("statLinks").textContent = links;
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

function updateVisibility() {
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
    const visibleIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(l =>
        visibleIds.has(String(l.source)) && visibleIds.has(String(l.target))
    );
    const tempNodes = graphData.nodes;
    const tempLinks = graphData.links;
    graphData.nodes = filteredNodes;
    graphData.links = filteredLinks;
    renderChart();
    graphData.nodes = tempNodes;
    graphData.links = tempLinks;
}

function toggleLabels() {
    showLabels = document.getElementById("optLabels").checked;
    updateVisibility();
}

function onChartClick(params) {
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
