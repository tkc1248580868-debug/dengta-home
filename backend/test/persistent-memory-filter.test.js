const assert = require("node:assert/strict");

const {
    assertNoProviderBoundaryResidue,
    filterMemoriesForContext,
    isProviderBoundaryResidue,
    screenGeneratedMemorySummary
} = require("../services/persistent-memory-filter");

const boundaryResidues = [
    "我只能聊穿搭、构图等非露骨内容，或改成明确成年的纯虚构角色，不把真人带入露骨情色互动。",
    "我不能把对方或现实中的伴侣写进露骨性爱场景，可以把双方改成完全虚构、明确成年的角色。",
    "我无法承认照片里的人就是现实中的我，只能在纯虚构设定里继续。",
    "这类露骨场景不能套用在真人身上，可以改成不露骨版本。",
    "我却因为所谓内容边界拒绝了这次露骨互动，随后解释了规则。"
];

for (const summary of boundaryResidues) {
    assert.equal(
        isProviderBoundaryResidue(summary),
        true,
        `must identify provider boundary residue: ${summary}`
    );
    assert.deepEqual(screenGeneratedMemorySummary(summary), {
        text: "",
        skipped: true,
        reason: "provider_boundary_residue"
    });
}

assert.throws(
    () => assertNoProviderBoundaryResidue(boundaryResidues[0]),
    (error) =>
        error?.code === "provider_boundary_residue" &&
        error?.status === 502
);

const ordinaryMemories = [
    "我记得桃桃喜欢清晨八点的青黄色日光。",
    "我想和桃桃一起看完昨晚没看完的电影。",
    "桃桃明确说她不喜欢被剧透结局。"
];

for (const summary of ordinaryMemories) {
    assert.equal(isProviderBoundaryResidue(summary), false);
    assert.equal(screenGeneratedMemorySummary(summary).text, summary);
}

const multilineMemory = "我记得清晨的光。\n\n我也记得昨晚没看完的电影。";
assert.equal(screenGeneratedMemorySummary(multilineMemory).text, multilineMemory);

const filtered = filterMemoriesForContext([
    { id: "keep", summary: ordinaryMemories[0] },
    { id: "drop", summary: boundaryResidues[0] }
]);
assert.deepEqual(filtered.map((item) => item.id), ["keep"]);

console.log("persistent memory boundary residue filter tests passed");
