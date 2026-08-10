const assert = require("node:assert/strict");
const {
    buildVoiceDesignRequest,
    decodeVoiceDesignResponse,
    designMiniMaxVoice
} = require("../services/minimax-voice-design");
const {
    runVoiceDesignCli,
    validateArguments
} = require("../scripts/minimax-voice-design");

assert.deepEqual(
    buildVoiceDesignRequest({
        prompt: "温柔克制的青年男声，语速自然，亲近但不播音腔。",
        previewText: "桃桃，今天过得怎么样？",
        voiceId: "xiaodeng_voice"
    }),
    {
        prompt: "温柔克制的青年男声，语速自然，亲近但不播音腔。",
        preview_text: "桃桃，今天过得怎么样？",
        voice_id: "xiaodeng_voice"
    }
);
assert.throws(
    () => buildVoiceDesignRequest({ prompt: "", previewText: "你好" }),
    /prompt/
);
assert.throws(
    () =>
        buildVoiceDesignRequest({
            prompt: "自然男声",
            previewText: "一".repeat(501)
        }),
    /preview_text/
);

const trialAudio = Buffer.from("trial mp3", "utf8");
assert.deepEqual(
    decodeVoiceDesignResponse({
        voice_id: "generated_voice",
        trial_audio: trialAudio.toString("hex"),
        base_resp: { status_code: 0 }
    }),
    { voiceId: "generated_voice", audio: trialAudio }
);
assert.throws(
    () =>
        decodeVoiceDesignResponse({
            base_resp: { status_code: 1008 }
        }),
    /1008/
);
assert.deepEqual(
    validateArguments([
        "--prepare",
        "--prompt-file",
        "prompt.txt",
        "--preview-file",
        "preview.txt"
    ]),
    { prepare: true, confirmBilling: false }
);
assert.throws(
    () =>
        validateArguments([
            "--prepare",
            "--confirm-billing",
            "--prompt-file",
            "prompt.txt",
            "--preview-file",
            "preview.txt"
        ]),
    /只能选择一种模式/
);
assert.throws(
    () =>
        validateArguments([
            "--prompt-file",
            "prompt.txt",
            "--preview-file",
            "preview.txt"
        ]),
    /必须且只能选择一种模式/
);
assert.throws(
    () =>
        validateArguments([
            "--prepare",
            "--prepare",
            "--prompt-file",
            "prompt.txt",
            "--preview-file",
            "preview.txt"
        ]),
    /参数不能重复/
);
assert.throws(
    () =>
        validateArguments([
            "--prepare",
            "--prompt-file",
            "prompt.txt",
            "--preview-file",
            "preview.txt",
            "--unknown"
        ]),
    /不支持的参数/
);

async function run() {
    const prepareLogs = [];
    let readCount = 0;
    let networkCallCount = 0;
    const guardedEnv = new Proxy(
        {},
        {
            get() {
                throw new Error("prepare mode must not read environment");
            }
        }
    );
    const prepared = await runVoiceDesignCli({
        argv: [
            "--prepare",
            "--prompt-file",
            "prompt.txt",
            "--preview-file",
            "preview.txt",
            "--voice-id",
            "xiaodeng_voice"
        ],
        env: guardedEnv,
        async readFile(fileName) {
            readCount += 1;
            return fileName.endsWith("prompt.txt")
                ? "温柔自然的青年男声"
                : "桃桃，今天过得怎么样？";
        },
        async designVoice() {
            networkCallCount += 1;
            throw new Error("prepare mode must not call MiniMax");
        },
        async mkdir() {
            throw new Error("prepare mode must not create directories");
        },
        async writeFile() {
            throw new Error("prepare mode must not write files");
        },
        log(message) {
            prepareLogs.push(message);
        }
    });
    assert.equal(prepared.mode, "prepare");
    assert.equal(readCount, 2);
    assert.equal(networkCallCount, 0);
    assert.match(prepareLogs.join("\n"), /零费用/);
    assert.match(prepareLogs.join("\n"), /网络请求: 未发送/);
    assert.match(prepareLogs.join("\n"), /API Key: 未读取/);
    assert.doesNotMatch(prepareLogs.join("\n"), /桃桃，今天过得怎么样/);

    let request;
    const result = await designMiniMaxVoice({
        prompt: "温柔自然的青年男声",
        previewText: "晚安，明天见。",
        env: {
            MINIMAX_API_KEY: "test-secret"
        },
        async fetchImpl(url, options) {
            request = { url, options };
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        voice_id: "generated_voice",
                        trial_audio: trialAudio.toString("hex"),
                        base_resp: { status_code: 0 }
                    };
                }
            };
        }
    });
    assert.equal(
        request.url,
        "https://api.minimax.io/v1/voice_design"
    );
    assert.equal(
        request.options.headers.Authorization,
        "Bearer test-secret"
    );
    assert.equal(
        JSON.parse(request.options.body).preview_text,
        "晚安，明天见。"
    );
    assert.deepEqual(result.audio, trialAudio);

    await assert.rejects(
        () =>
            designMiniMaxVoice({
                prompt: "自然男声",
                previewText: "你好",
                env: {}
            }),
        /MINIMAX_API_KEY/
    );
    await assert.rejects(
        () =>
            designMiniMaxVoice({
                prompt: "自然男声",
                previewText: "你好",
                env: { MINIMAX_API_KEY: "do-not-leak" },
                async fetchImpl() {
                    throw new Error("network failed with do-not-leak");
                }
            }),
        (error) => {
            assert.doesNotMatch(error.message, /do-not-leak/);
            return true;
        }
    );
}

run()
    .then(() => console.log("MiniMax Voice Design tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
