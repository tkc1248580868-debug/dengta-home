const MODEL_WAIT_STAGES = Object.freeze([
    Object.freeze({
        delay: 8000,
        stage: "model_deep_reasoning",
        content: "所选模型正在深入思考"
    }),
    Object.freeze({
        delay: 30000,
        stage: "model_still_reasoning",
        content: "模型仍在推理，这次思考比平时更久"
    }),
    Object.freeze({
        delay: 75000,
        stage: "model_extended_reasoning",
        content: "最高强度推理仍在继续，连接保持正常"
    })
]);

function startModelWaitProgress({
    onStatus,
    schedule = setTimeout,
    cancel = clearTimeout
} = {}) {
    if (typeof onStatus !== "function") return () => {};
    const handles = MODEL_WAIT_STAGES.map(({ delay, stage, content }) => {
        const handle = schedule(
            () => onStatus({ type: "status", stage, content }),
            delay
        );
        handle?.unref?.();
        return handle;
    });
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        handles.forEach((handle) => cancel(handle));
    };
}

module.exports = {
    MODEL_WAIT_STAGES,
    startModelWaitProgress
};
