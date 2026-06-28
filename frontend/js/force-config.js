const ForceConfig = (function() {
    // 快速收敛、幅度适中
    const LEVELS = [
        { maxNodes: 100, repulsion: 200, edgeLength: 80, gravity: 0.1, friction: 0.1, animationDuration: 400, label: "流畅" },
        { maxNodes: 500, repulsion: 250, edgeLength: 100, gravity: 0.12, friction: 0.08, animationDuration: 400, label: "良好" },
        { maxNodes: 2000, repulsion: 300, edgeLength: 120, gravity: 0.15, friction: 0.05, animationDuration: 400, label: "标准" },
        { maxNodes: 10000, repulsion: 350, edgeLength: 140, gravity: 0.18, friction: 0.03, animationDuration: 400, label: "性能" },
        { maxNodes: Infinity, repulsion: 400, edgeLength: 160, gravity: 0.2, friction: 0.02, animationDuration: 400, label: "极速" }
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
