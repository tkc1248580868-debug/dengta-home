const MINIMAX_VOICE_DESIGN_ENDPOINT =
    "https://api.minimax.io/v1/voice_design";
const MAX_PROMPT_CHARACTERS = 2000;
const MAX_PREVIEW_CHARACTERS = 500;
const MAX_TRIAL_AUDIO_BYTES = 10 * 1024 * 1024;

function voiceDesignError(message, status = 502) {
    const error = new Error(message);
    error.status = status;
    error.code = "MINIMAX_VOICE_DESIGN_ERROR";
    return error;
}

function requiredText(value, fieldName, maxCharacters) {
    const text = String(value || "").trim();
    const length = Array.from(text).length;
    if (!text || length > maxCharacters) {
        throw voiceDesignError(
            `${fieldName} 必须为 1 到 ${maxCharacters} 个字符。`,
            400
        );
    }
    return text;
}

function optionalVoiceId(value) {
    const voiceId = String(value || "").trim();
    if (!voiceId) return "";
    if (
        voiceId.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(voiceId)
    ) {
        throw voiceDesignError("voice_id 格式不正确。", 400);
    }
    return voiceId;
}

function buildVoiceDesignRequest({ prompt, previewText, voiceId = "" }) {
    const payload = {
        prompt: requiredText(
            prompt,
            "Voice Design prompt",
            MAX_PROMPT_CHARACTERS
        ),
        preview_text: requiredText(
            previewText,
            "Voice Design preview_text",
            MAX_PREVIEW_CHARACTERS
        )
    };
    const normalizedVoiceId = optionalVoiceId(voiceId);
    if (normalizedVoiceId) payload.voice_id = normalizedVoiceId;
    return payload;
}

function decodeVoiceDesignResponse(payload) {
    const statusCode = Number(payload?.base_resp?.status_code);
    if (statusCode !== 0) {
        throw voiceDesignError(
            `MiniMax Voice Design 失败（代码 ${
                Number.isFinite(statusCode) ? statusCode : "未知"
            }）。`
        );
    }
    const voiceId = optionalVoiceId(payload?.voice_id);
    if (!voiceId) {
        throw voiceDesignError("MiniMax Voice Design 没有返回 voice_id。");
    }
    const trialAudio = String(payload?.trial_audio || "").trim();
    if (
        !trialAudio ||
        trialAudio.length % 2 !== 0 ||
        !/^[0-9a-f]+$/i.test(trialAudio)
    ) {
        throw voiceDesignError("MiniMax Voice Design 没有返回可播放的试听。");
    }
    const audio = Buffer.from(trialAudio, "hex");
    if (audio.length === 0 || audio.length > MAX_TRIAL_AUDIO_BYTES) {
        throw voiceDesignError("MiniMax Voice Design 试听大小不正确。");
    }
    return { voiceId, audio };
}

async function designMiniMaxVoice({
    prompt,
    previewText,
    voiceId = "",
    env = process.env,
    fetchImpl = fetch
}) {
    const apiKey = String(env.MINIMAX_API_KEY || "").trim();
    if (!apiKey) {
        throw voiceDesignError(
            "当前终端没有设置 MINIMAX_API_KEY。",
            503
        );
    }
    const timeoutValue = Number(env.MINIMAX_VOICE_DESIGN_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutValue)
        ? Math.min(120_000, Math.max(5_000, timeoutValue))
        : 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let response;
        try {
            response = await fetchImpl(MINIMAX_VOICE_DESIGN_ENDPOINT, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(
                    buildVoiceDesignRequest({
                        prompt,
                        previewText,
                        voiceId
                    })
                ),
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw voiceDesignError(
                    "MiniMax Voice Design 等待超时。",
                    504
                );
            }
            const connectionError = voiceDesignError(
                "无法连接 MiniMax Voice Design。"
            );
            connectionError.cause = error;
            throw connectionError;
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw voiceDesignError("MiniMax Voice Design 返回无法读取。");
        }
        if (!response.ok) {
            throw voiceDesignError(
                `MiniMax Voice Design 暂时不可用（HTTP ${response.status}）。`
            );
        }
        return decodeVoiceDesignResponse(payload);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    MAX_PREVIEW_CHARACTERS,
    MAX_PROMPT_CHARACTERS,
    MAX_TRIAL_AUDIO_BYTES,
    MINIMAX_VOICE_DESIGN_ENDPOINT,
    buildVoiceDesignRequest,
    decodeVoiceDesignResponse,
    designMiniMaxVoice
};
