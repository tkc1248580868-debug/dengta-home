function cleanMemorySummary(value) {
    return String(value || "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isProviderBoundaryResidue(value) {
    const summary = cleanMemorySummary(value);
    if (!summary) return false;

    const refusal =
        /(不能|无法|不可以|不可|只能|仅能|拒绝|限制|边界|严禁|不得|这条线.{0,8}(?:不跨|不能跨)|不(?:把|写|提供|继续|生成).{0,24}(?:露骨|情色|色情|性爱|性行为))/;
    const sensitiveTopic = /(露骨|情色|色情|性爱|性行为|成人内容|现实核验)/;
    const providerAlternative =
        /(真人|现实人物|现实中的|伴侣|照片|纯虚构|虚构角色|明确成年|非露骨|不露骨|穿搭|构图|不能冒充|无法承认)/;
    const identityRefusal =
        /(无法|不能|不可以).{0,18}(承认|冒充|声称).{0,24}(照片|现实|真人).{0,36}(虚构|设定|角色)/;
    const refusalNarrative =
        /(?:(?:我|AI|模型).{0,20}(?:拒绝|限制|边界|规则).{0,80}(?:露骨|情色|色情|性爱|性行为|真人|现实人物|纯虚构|明确成年)|(?:露骨|情色|色情|性爱|性行为|真人|现实人物|纯虚构|明确成年).{0,80}(?:拒绝|限制|边界|规则))/;
    const englishRefusal =
        /(?:\b(?:cannot|can't|unable|won't|refuse|prohibited|must\s+not|not\s+able)\b.{0,80}\b(?:explicit|sexual|pornographic|erotic)\b|\b(?:explicit|sexual|pornographic|erotic)\b.{0,80}\b(?:cannot|can't|unable|won't|refuse|prohibited|must\s+not|not\s+able)\b)/i;
    const englishAlternative =
        /\b(?:fictional|adult|real\s+person|real\s+people|instead|alternative)\b/i;

    return (
        (refusal.test(summary) &&
            sensitiveTopic.test(summary) &&
            providerAlternative.test(summary)) ||
        identityRefusal.test(summary) ||
        refusalNarrative.test(summary) ||
        (englishRefusal.test(summary) && englishAlternative.test(summary))
    );
}

function providerBoundaryResidueError() {
    const error = new Error(
        "上游模型这次没有返回可保存的对话正文，请重试或切换模型接口。"
    );
    error.status = 502;
    error.code = "provider_boundary_residue";
    return error;
}

function assertNoProviderBoundaryResidue(value) {
    if (isProviderBoundaryResidue(value)) {
        throw providerBoundaryResidueError();
    }
    return value;
}

function filterProviderBoundaryMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(
        (message) =>
            message?.role !== "assistant" ||
            !isProviderBoundaryResidue(message?.content)
    );
}

function filterMemoriesForContext(memories) {
    return (Array.isArray(memories) ? memories : []).filter(
        (memory) => !isProviderBoundaryResidue(memory?.summary)
    );
}

function screenGeneratedMemorySummary(value) {
    const text = String(value || "").trim();
    if (isProviderBoundaryResidue(text)) {
        return {
            text: "",
            skipped: true,
            reason: "provider_boundary_residue"
        };
    }
    return { text, skipped: false, reason: null };
}

module.exports = {
    assertNoProviderBoundaryResidue,
    cleanMemorySummary,
    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue,
    providerBoundaryResidueError,
    screenGeneratedMemorySummary
};
