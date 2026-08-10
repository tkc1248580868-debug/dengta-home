const fs = require("node:fs/promises");
const path = require("node:path");
const {
    buildVoiceDesignRequest,
    designMiniMaxVoice
} = require("../services/minimax-voice-design");

const VALUE_FLAGS = new Set([
    "--prompt-file",
    "--preview-file",
    "--voice-id",
    "--output-dir"
]);
const MODE_FLAGS = new Set(["--prepare", "--confirm-billing"]);

function argumentValue(argv, name) {
    const index = argv.indexOf(name);
    if (index < 0) return "";
    return String(argv[index + 1] || "").trim();
}

function validateArguments(argv) {
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (MODE_FLAGS.has(argument)) {
            if (argv.indexOf(argument) !== index) {
                throw new Error(`参数不能重复：${argument}`);
            }
            continue;
        }
        if (!VALUE_FLAGS.has(argument)) {
            throw new Error(`不支持的参数：${argument}`);
        }
        const value = argv[index + 1];
        if (!value || String(value).startsWith("--")) {
            throw new Error(`缺少 ${argument} 的值。`);
        }
        if (argv.indexOf(argument) !== index) {
            throw new Error(`参数不能重复：${argument}`);
        }
        index += 1;
    }

    const prepare = argv.includes("--prepare");
    const confirmBilling = argv.includes("--confirm-billing");
    if (prepare === confirmBilling) {
        throw new Error(
            "必须且只能选择一种模式：零费用 --prepare，或付费 --confirm-billing。"
        );
    }
    return { prepare, confirmBilling };
}

async function readRequiredFile(argv, flag, label, readFile) {
    const fileName = argumentValue(argv, flag);
    if (!fileName) {
        throw new Error(`缺少 ${flag}（${label}文件路径）。`);
    }
    return readFile(path.resolve(fileName), "utf8");
}

async function runVoiceDesignCli({
    argv = process.argv.slice(2),
    env = process.env,
    readFile = fs.readFile,
    mkdir = fs.mkdir,
    writeFile = fs.writeFile,
    designVoice = designMiniMaxVoice,
    now = Date.now,
    log = console.log
} = {}) {
    const mode = validateArguments(argv);
    const prompt = await readRequiredFile(
        argv,
        "--prompt-file",
        "音色描述提示词",
        readFile
    );
    const previewText = await readRequiredFile(
        argv,
        "--preview-file",
        "试听文本",
        readFile
    );
    const voiceId = argumentValue(argv, "--voice-id");
    const request = buildVoiceDesignRequest({
        prompt,
        previewText,
        voiceId
    });

    if (mode.prepare) {
        log("Voice Design 待命检查通过。");
        log("模式: --prepare（零费用）");
        log("网络请求: 未发送");
        log("API Key: 未读取");
        log(
            `本地内容: prompt ${Array.from(request.prompt).length} 字符；` +
                `preview ${Array.from(request.preview_text).length} 字符`
        );
        log(`自定义 voice_id: ${request.voice_id ? "已配置" : "未配置"}`);
        log(
            "计费条件: 未确认；只有改用 --confirm-billing 才会发送一次请求。"
        );
        return { mode: "prepare", request };
    }

    const result = await designVoice({
        prompt: request.prompt,
        previewText: request.preview_text,
        voiceId: request.voice_id || "",
        env
    });
    const outputDirectory = path.resolve(
        argumentValue(argv, "--output-dir") || "voice-design.local"
    );
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = path.join(
        outputDirectory,
        `minimax-preview-${now()}.mp3`
    );
    await writeFile(outputPath, result.audio, { flag: "wx" });

    log("MiniMax Voice Design 完成。");
    log(`voice_id: ${result.voiceId}`);
    log(`试听文件: ${outputPath}`);
    log(
        "试听满意后，把 voice_id 填入 Render 的 MINIMAX_TTS_VOICE_ID。"
    );
    return { mode: "billing", outputPath, voiceId: result.voiceId };
}

if (require.main === module) {
    runVoiceDesignCli().catch((error) => {
        console.error(error?.message || "MiniMax Voice Design 失败。");
        process.exitCode = 1;
    });
}

module.exports = {
    argumentValue,
    runVoiceDesignCli,
    validateArguments
};
