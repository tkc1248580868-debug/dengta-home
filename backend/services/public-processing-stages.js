const PUBLIC_PROCESSING_STAGES = Object.freeze([
    "accepted",
    "already_received",
    "processing_attachments",
    "attachments_ready",
    "organizing_context",
    "calling_model",
    "model_deep_reasoning",
    "model_still_reasoning",
    "model_extended_reasoning",
    "saving",
    "completed"
]);

const PUBLIC_PROCESSING_STAGE_SET = new Set(PUBLIC_PROCESSING_STAGES);

function normalizePublicProcessingStages(value) {
    if (!Array.isArray(value)) return [];

    const stages = [];
    for (const item of value) {
        const stage = String(item || "").trim().toLowerCase();
        if (!PUBLIC_PROCESSING_STAGE_SET.has(stage)) continue;
        if (stages.includes(stage)) continue;
        stages.push(stage);
    }
    return stages;
}

function appendPublicProcessingStage(value, stage) {
    return normalizePublicProcessingStages([
        ...normalizePublicProcessingStages(value),
        stage
    ]);
}

module.exports = {
    PUBLIC_PROCESSING_STAGES,
    appendPublicProcessingStage,
    normalizePublicProcessingStages
};
