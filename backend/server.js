const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { randomUUID } = require("crypto");
const { version: appVersion } = require("./package.json");
const { createClient } = require("@supabase/supabase-js");
const {
    MAIN_CHAT_PROMPT_ARCHITECTURE,
    generateReply,
    generateReplyStream,
    generateMemorySummary,
    generateMomentReaction
} = require("./services/ai-service");
const {
    UPDATE_COMPANION_STATUS_TOOL,
    applyCompanionStatusUpdate,
    buildCompanionStatusRuntimeContext,
    parseCompanionStatusToolArguments,
    sanitizeCompanionStatusSnapshot
} = require("./services/companion-status");
const {
    createCompanionInteractionGuard,
    runCompanionInteraction
} = require("./services/companion-interaction");
const {
    runVisibleInnerMonologue
} = require("./services/visible-inner-monologue");
const {
    assertPromptFieldsDoNotContainSecrets
} = require("./services/prompt-security");
const {
    appendShadowUserTrigger,
    buildShadowUserContent,
    cleanPushReply,
    decideShadowPush,
    getZonedClock,
    randomCooldownMinutes,
    resolveTimezone
} = require("./services/shadow-push");
const {
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    createHervoiceWarmup,
    createVoiceRateLimitState,
    parseVoiceTurnFields
} = require("./services/voice-turn");
const {
    getExpressiveSpeechCapabilities,
    isSafeSpeechMessageId,
    synthesizeExpressiveSpeech
} = require("./services/expressive-speech");
const {
    createExpressiveSpeechCache,
    isSafeConversationId,
    publicAssistantMessageWithSpeechAccess,
    speechCacheOptions,
    verifySpeechAccessToken
} = require("./services/expressive-speech-access");
const { listModels, resolveTurnModel } = require("./services/model-catalog");
const { normalizeChatBody } = require("./services/chat-request");
const {
    messageReferenceRuntimeContext,
    normalizeMessageReferenceSnapshot,
    resolveMessageReference
} = require("./services/message-reference");
const {
    buildEnvironmentRuntimeContext
} = require("./services/environment-context");
const {
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerSelector
} = require("./services/companion-stickers");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    createReplySuggestionSelector,
    finalizeReplySuggestions,
    replySuggestionToolCalls
} = require("./services/reply-suggestions");
const {
    assertClientMessageConversation,
    chatGenerationInProgressError,
    createChatGenerationLeaseHeartbeat,
    createChatGenerationLeaseStore,
    createClientMessageQueue,
    generationLeaseFields,
    isClientMessageUniqueConflict
} = require("./services/chat-idempotency");
const {
    applyProviderSettingPins,
    isProductionDeployment,
    providerSettingsForPersistence
} = require("./services/provider-settings-policy");
const {
    publicChatErrorCode,
    publicChatErrorMessage,
    streamFailure,
    streamSuccess
} = require("./services/chat-stream-contract");
const {
    assertProviderOutputSafe
} = require("./services/provider-output-guard");
const {
    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue
} = require("./services/persistent-memory-filter");
const {
    appendPublicProcessingStage
} = require("./services/public-processing-stages");
const {
    startModelWaitProgress
} = require("./services/model-wait-progress");
const {
    MAX_ATTACHMENT_FILE_BYTES,
    MAX_ATTACHMENT_FILES,
    attachmentRuntimeContext,
    attachmentSystemInstruction,
    attachmentToolCalls,
    findStoredAttachment,
    isSafeMessageId,
    modelImageAttachments,
    prepareAttachments,
    publicMessage,
    removeStoredAttachments,
    scrubAttachmentBuffers,
    shouldPersistAttachments,
    storeAttachments,
    storedAttachmentPathsForConversation,
    visibleMessageText,
    validateEphemeralAttachments,
    withAttachmentUserContext
} = require("./services/chat-attachments");
const ombreDashboardRouter = require("./routes/ombre-dashboard");
const { publicMcpConfig } = require("./services/ombre-mcp");
const { createMcpConnectionsRouter } = require("./routes/mcp-connections");
const {
    createMcpDeviceCenter,
    hasCredentialEncryption
} = require("./services/mcp-device-center");
const {
    createAiProviderCenter,
    publicRuntimeSettings
} = require("./services/ai-provider-center");
const {
    normalizeReasoningEffort,
    reasoningProtocolForProvider
} = require("./services/provider-reasoning-effort");
const { createAiProvidersRouter } = require("./routes/ai-providers");
const {
    createCompanionCreativeCenter
} = require("./services/companion-creative");
const {
    createCompanionCreativeRouter
} = require("./routes/companion-creative");
const {
    handleTenantCreativeCheck,
    handleTenantSurpriseReveal
} = require("./services/tenant-companion-creative");
const { createWeatherRouter } = require("./routes/weather");
const { createAccountRouter } = require("./routes/account");
const { createV2CoreRouter } = require("./routes/v2/core");
const { createV2ContentRouter } = require("./routes/v2/content");
const { createNurseryRouter } = require("./routes/nursery");
const { createIntimateDuelRouter } = require("./routes/intimate-duel");
const { handleNurseryEvent } = require("./services/nursery-events");
const { createChatSkinRouter } = require("./routes/chat-skin");
const { createCoWatchRouter } = require("./routes/co-watch");
const {
    booleanEnv,
    createAuthContextMiddleware
} = require("./services/auth-context");
const {
    publicStoredSettings,
    updateStoredSettings
} = require("./services/settings-store");
const {
    createTenantDatabase
} = require("./services/request-scope");
const {
    createBackgroundJobWorker
} = require("./services/background-job-worker");
const {
    createBackgroundJobTrigger
} = require("./services/background-job-trigger");
const {
    startBackgroundJobLoop
} = require("./services/background-job-loop");
const {
    reconcileTenantRecurringJobs
} = require("./services/background-job-reconciliation");
const {
    createTenantMomentInteractionHandler
} = require("./services/tenant-moment-runtime");
const {
    handleTenantProactiveMessage,
    scheduleProactiveMessageEvaluation
} = require("./services/tenant-proactive-message");
const {
    handleTenantMomentPost,
    scheduleMomentPostEvaluation
} = require("./services/tenant-moment-post");
const {
    handleTenantDiaryUpdate,
    scheduleDiaryUpdate
} = require("./services/tenant-diary-update");
const {
    handleTenantProfileRefresh,
    scheduleProfileRefresh
} = require("./services/tenant-profile-refresh");
const {
    isContextTimestampCurrent,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows
} = require("./services/context-reset");
const {
    DEFAULT_MEMORY_CHAR_BUDGET,
    memoryBudgetEnabled
} = require("./services/memory-budget");
const { buildNurseryRuntimeContext } = require("./services/nursery-engine");

require("dotenv").config({
    path: path.join(__dirname, ".env"),
    quiet: true
});

const app = express();
const port = Number(process.env.PORT) || 3000;
const companionInteractionGuard = createCompanionInteractionGuard();
const runClientMessageTask = createClientMessageQueue();
const voiceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fields: 9,
        fileSize: 12 * 1024 * 1024
    }
});
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: MAX_ATTACHMENT_FILES,
        fields: 13,
        parts: MAX_ATTACHMENT_FILES + 13,
        fileSize: MAX_ATTACHMENT_FILE_BYTES,
        fieldSize: 128 * 1024
    }
});
const voiceRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.VOICE_RATE_LIMIT_WINDOW_MS,
    maxRequests: process.env.VOICE_RATE_LIMIT_MAX
});
const hervoiceWarmup = createHervoiceWarmup();
const expressiveSpeechRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.EXPRESSIVE_TTS_RATE_LIMIT_WINDOW_MS || 60_000,
    maxRequests: process.env.EXPRESSIVE_TTS_RATE_LIMIT_MAX || 12
});
const expressiveSpeechCache = createExpressiveSpeechCache(
    speechCacheOptions(process.env)
);

app.set("trust proxy", 1);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const authRequired = booleanEnv(
    process.env.AUTH_REQUIRED,
    process.env.NODE_ENV === "production"
);

if (!supabaseUrl || !supabaseSecretKey) {
    console.error("启动失败：.env 中缺少 Supabase 配置。");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});
const chatGenerationLeaseStore = createChatGenerationLeaseStore(supabase);
const mcpDeviceCenter = createMcpDeviceCenter({ supabase });
const aiProviderCenter = createAiProviderCenter({ supabase });
const backgroundJobsEnabled = booleanEnv(
    process.env.BACKGROUND_JOBS_ENABLED,
    false
);
const backgroundJobWorker = createBackgroundJobWorker({
    adminSupabase: supabase,
    createTenantDatabase,
    reconcileTenant: ({ database }) =>
        reconcileTenantRecurringJobs({
            database,
            getSettings: (scopedDatabase) => getSettings(scopedDatabase)
        }),
    handlers: {
        moment_interaction: createTenantMomentInteractionHandler({
            storage: supabase.storage,
            generateReply,
            getSettings: (database) => getSettings(database),
            loadCompanionInteractionContext: (
                conversationId,
                settings,
                database
            ) =>
                loadCompanionInteractionContext(
                    conversationId,
                    settings,
                    database
                )
        }),
        proactive_message: ({ job, database, lease }) =>
            handleTenantProactiveMessage({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                generateReply,
                saveMessage,
                touchConversation
            }),
        moment_post: ({ job, database, lease }) =>
            handleTenantMomentPost({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                generateReply
            }),
        diary_update: ({ job, database, lease }) =>
            handleTenantDiaryUpdate({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        profile_refresh: ({ job, database, lease }) =>
            handleTenantProfileRefresh({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        creative_check: ({ job, tenant, database, lease }) =>
            handleTenantCreativeCheck({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        surprise_reveal: ({ job, tenant, database, lease }) =>
            handleTenantSurpriseReveal({
                job,
                database,
                lease,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        nursery_event: ({ job, database, lease }) =>
            handleNurseryEvent({
                job,
                database,
                lease,
                saveMessage,
                touchConversation
            })
    },
    workerId: process.env.BACKGROUND_WORKER_ID || undefined,
    concurrency: process.env.BACKGROUND_JOB_CONCURRENCY || undefined,
    claimLimit: process.env.BACKGROUND_JOB_BATCH_SIZE || undefined,
    leaseSeconds: process.env.BACKGROUND_JOB_LEASE_SECONDS || undefined,
    maxAttempts: process.env.BACKGROUND_JOB_MAX_ATTEMPTS || undefined,
    baseRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_BASE_SECONDS || undefined,
    maxRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_MAX_SECONDS || undefined
});
const backgroundJobTrigger = createBackgroundJobTrigger({
    worker: backgroundJobWorker,
    secret: process.env.BACKGROUND_JOB_TRIGGER_SECRET,
    enabled: backgroundJobsEnabled,
    budgetMs: Number(
        process.env.BACKGROUND_JOB_TICK_BUDGET_MS || 45_000
    )
});
const backgroundJobLoop = startBackgroundJobLoop({
    worker: backgroundJobWorker,
    enabled: backgroundJobsEnabled,
    intervalMs: process.env.BACKGROUND_JOB_LOCAL_INTERVAL_MS
});

const allowedOrigins = new Set(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://localhost",
        "capacitor://localhost",
        ...(process.env.FRONTEND_URL || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ]
);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true);
                return;
            }

            const error = new Error("该网页地址没有权限访问后端。");
            error.status = 403;
            callback(error);
        },
        exposedHeaders: [
            "X-DengTa-Voice-Provider",
            "X-DengTa-Voice-Emotion",
            "X-DengTa-Voice-Cache",
            "X-DengTa-Companion-Id"
        ]
    })
);
app.use("/api/weather", createWeatherRouter());
app.post("/internal/background-jobs/tick", backgroundJobTrigger);
app.use(express.json({ limit: "30mb" }));
app.use(
    createAuthContextMiddleware({
        adminSupabase: supabase,
        authRequired,
        initialOwnerEmail: process.env.INITIAL_OWNER_EMAIL || ""
    })
);
app.use("/api/account", createAccountRouter());
app.use(
    "/api/v2",
    createV2CoreRouter({ storage: supabase.storage })
);
app.use("/api/v2/nursery", createNurseryRouter());
app.use(
    "/api/v2/intimate-duel",
    createIntimateDuelRouter({
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/creative",
    createCompanionCreativeRouter({
        createCenter: (scope) =>
            createCompanionCreativeCenter({
                database: scope.db,
                storage: supabase.storage,
                identity: {
                    userId: scope.userId,
                    companionId: scope.companionId
                }
            }),
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/chat-skin",
    createChatSkinRouter({
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/co-watch",
    createCoWatchRouter({
        getSettings: (database) => getSettings(database),
        loadChatContext: (conversationId, settings, database) =>
            loadChatContext(conversationId, settings, database),
        generateReply,
        saveMessage,
        touchConversation
    })
);
app.use(
    "/api/v2",
    createV2ContentRouter({
        storage: supabase.storage,
        readSettings: (scope) =>
            publicStoredSettings(scope.db, process.env),
        saveSettings: async (scope, body) =>
            publicRuntimeSettings(
                await updateStoredSettings(
                    scope.db,
                    body,
                    process.env
                )
            )
    })
);
app.use("/api/ombre", ombreDashboardRouter);
app.use(
    "/api/mcp/connections",
    createMcpConnectionsRouter({ center: mcpDeviceCenter })
);
app.use(
    "/api/ai-providers",
    createAiProvidersRouter({ center: aiProviderCenter })
);

const defaultSettings = {
    ai_name: "伴侣",
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    intimate_expression_enabled: false,
    provider: "custom",
    api_url: "",
    model: "",
    reasoning_effort: "",
    temperature: 0.7,
    context_turns: 20,
    max_tokens: 2048,
    compression_threshold: 12000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
};

const PUBLIC_MOMENT_FIELDS = [
    "id",
    "author",
    "content",
    "images",
    "reply_due_at",
    "reply_status",
    "liked",
    "reply_content",
    "replied_at",
    "reply_seen_at",
    "user_liked",
    "created_at"
].join(",");
const PUBLIC_MOMENT_COMMENT_FIELDS = [
    "id",
    "moment_id",
    "author",
    "content",
    "reply_status",
    "seen_at",
    "created_at"
].join(",");
const POST_MOMENT_TOOL = {
    name: "post_moment",
    description: [
        "在聊天过程中有感而发，发布一条 AI 自己的 Moments 动态。",
        "判断标准是此刻有没有一句想让用户之后刷到的话，不要求情绪重大或值得长期保存。",
        "想念、吃醋、占有欲、心软、被逗笑、隐约不爽、温柔吐槽、一个具体观察，",
        "或一句不适合在聊天回复里直接说完的话，都可以成为动态。",
        "不要为了使用工具而使用工具；一次聊天请求最多发布一条。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "公开显示在 Moments 里的正文。1到3句，自然、具体，像随手发出的朋友圈。"
            },
            context_note: {
                type: "string",
                description: "用户不可见的内部备注：为什么发这条、当时在聊什么、这条动态的情绪底色。"
            }
        },
        required: ["content", "context_note"],
        additionalProperties: false
    }
};

const memoryCompressionLocks = new Set();
const momentReplyLocks = new Set();
const commentReplyLocks = new Set();
let shadowPushLock = false;
let diaryGenerationLock = false;
let diaryGenerationStatus = {
    state: "watching",
    message: "正在等待新的真实对话。",
    updated_at: new Date().toISOString()
};

function cleanText(value, maxLength = 10000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePromptMode(value, fallback = "legacy") {
    const normalized = String(value ?? fallback)
        .trim()
        .toLowerCase();
    if (["legacy", "unified"].includes(normalized)) return normalized;

    const error = new Error("prompt_mode 只能是 legacy 或 unified。");
    error.status = 400;
    throw error;
}

function cleanUnifiedSystemPrompt(value) {
    const normalized = String(value ?? "");
    if (Array.from(normalized).length > 30000) {
        const error = new Error("unified_system_prompt 不能超过 30000 个字符。");
        error.status = 400;
        throw error;
    }
    return normalized;
}

function cleanUserDetails(value) {
    const normalized = String(value ?? "");
    if (Array.from(normalized).length > 30000) {
        const error = new Error("user_details 不能超过 30000 个字符。");
        error.status = 400;
        throw error;
    }
    return normalized;
}

function normalizeChatRequest(req) {
    return {
        ...normalizeChatBody(req.body, req.files),
        requestScope: req.scope || null
    };
}

function acceptChatBody(req, res, next) {
    if (!req.is("multipart/form-data")) {
        req.files = [];
        next();
        return;
    }
    chatUpload.fields([
        { name: "files", maxCount: MAX_ATTACHMENT_FILES },
        { name: "attachments", maxCount: MAX_ATTACHMENT_FILES }
    ])(req, res, (error) => {
        if (error) return next(error);
        const groups = req.files && typeof req.files === "object" ? req.files : {};
        req.files = [
            ...(Array.isArray(groups.files) ? groups.files : []),
            ...(Array.isArray(groups.attachments) ? groups.attachments : [])
        ];
        if (req.files.length > MAX_ATTACHMENT_FILES) {
            const tooMany = new Error("一次最多发送 4 个附件。");
            tooMany.status = 413;
            return next(tooMany);
        }
        next();
    });
}

function toPublicMoment(moment) {
    if (!moment || typeof moment !== "object") return moment;
    const {
        context_note,
        image_description,
        reply_due_at,
        reply_status,
        ...publicMoment
    } = moment;
    return publicMoment;
}

function toPublicMomentComment(comment) {
    if (!comment || typeof comment !== "object") return comment;
    const { reply_due_at, reply_status, ...publicComment } = comment;
    return publicComment;
}

function cleanInternalMomentContext(value, maxLength = 1500) {
    return cleanText(value, maxLength)
        .replace(/active_session_id:[^\s]+/gi, "")
        .replace(/tool_call_id:[^\s]+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value ?? "")
    );
}

function toNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, number));
}

function createChatToolExecutor(
    conversationId,
    initialCompanionStatus,
    clientMessageId = "",
    mcpRuntime = null,
    database = supabase,
    userDisplayName = ""
) {
    let momentCreated = false;
    let statusUpdated = false;
    const stickerSelector = createCompanionStickerSelector();
    const replySuggestionSelector = createReplySuggestionSelector();
    let companionStatus = sanitizeCompanionStatusSnapshot(
        initialCompanionStatus
    );

    async function executeChatTool(toolCall) {
        if (toolCall?.name === UPDATE_COMPANION_STATUS_TOOL.name) {
            if (statusUpdated) {
                return { ok: false, error: "这次聊天已经更新过一次状态。" };
            }

            const parsed = parseCompanionStatusToolArguments(
                toolCall.arguments ?? ""
            );
            if (!parsed.ok) {
                return { ok: false, error: parsed.error };
            }

            companionStatus = applyCompanionStatusUpdate(
                companionStatus,
                parsed.value,
                new Date(),
                { userDisplayName }
            );
            statusUpdated = true;
            return {
                ok: true,
                message: "伙伴状态已更新。",
                companion_status: companionStatus
            };
        }

        if (toolCall?.name === SELECT_COMPANION_STICKER_TOOL.name) {
            return stickerSelector.executeTool(toolCall);
        }

        if (toolCall?.name === SELECT_REPLY_SUGGESTIONS_TOOL.name) {
            return replySuggestionSelector.executeTool(toolCall);
        }

        if (mcpRuntime?.hasTool(toolCall?.name)) {
            return mcpRuntime.execute(toolCall);
        }

        if (toolCall?.name !== POST_MOMENT_TOOL.name) {
            return { ok: false, error: "未知工具，未执行。" };
        }
        if (momentCreated) {
            return { ok: false, error: "这次聊天已经发布过一条动态。" };
        }

        let args;
        try {
            args = JSON.parse(String(toolCall.arguments || ""));
        } catch {
            return { ok: false, error: "动态参数不是有效的 JSON。" };
        }

        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return { ok: false, error: "动态参数格式不正确。" };
        }
        if (typeof args.content !== "string" || typeof args.context_note !== "string") {
            return { ok: false, error: "动态正文和内部备注必须是文字。" };
        }

        const content = cleanText(args.content, 800);
        const contextNote = cleanInternalMomentContext(args.context_note, 1500);
        if (!content || !contextNote) {
            return { ok: false, error: "动态正文和内部备注不能为空。" };
        }

        const replyDueAt = new Date(
            Date.now() + randomDelayMinutes(8, 20) * 60 * 1000
        ).toISOString();
        const storedContextNote = [
            contextNote,
            isUuid(conversationId) ? `active_session_id:${conversationId}` : ""
        ]
            .filter(Boolean)
            .join("\n");

        try {
            if (clientMessageId) {
                const { data: existing, error: findError } = await database
                    .from("moments")
                    .select("id")
                    .eq("source_client_message_id", clientMessageId)
                    .maybeSingle();
                if (findError) throw findError;
                if (existing) {
                    momentCreated = true;
                    return {
                        ok: true,
                        moment_id: existing.id,
                        message: "动态已发布。",
                        deduplicated: true
                    };
                }
            }

            const momentValues = {
                author: "assistant",
                content,
                context_note: storedContextNote,
                images: [],
                reply_due_at: replyDueAt,
                reply_status: "done"
            };
            if (clientMessageId) {
                momentValues.source_client_message_id = clientMessageId;
            }
            const { data, error } = await database
                .from("moments")
                .insert(momentValues)
                .select("id")
                .single();

            if (error) throw error;
            momentCreated = true;
            return {
                ok: true,
                moment_id: data.id,
                message: "动态已发布。"
            };
        } catch (error) {
            console.error("AI 动态发布失败：", error?.message || "未知错误");
            return { ok: false, error: "动态发布失败。" };
        }
    }

    return {
        executeTool: executeChatTool,
        getCompanionStatus() {
            return sanitizeCompanionStatusSnapshot(companionStatus);
        },
        getStickerId() {
            return stickerSelector.getStickerId();
        },
        getReplySuggestions() {
            return replySuggestionSelector.getSuggestions();
        }
    };
}

function previousReplySuggestionsFromMessages(messages = []) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
            message?.role === "assistant" &&
            Array.isArray(message?.tool_calls?.reply_suggestions)
        ) {
            return message.tool_calls.reply_suggestions;
        }
    }
    return [];
}

function limitVoiceTurnsPerIp(req, res, next) {
    const result = voiceRateLimitState.consume(req.ip || req.socket?.remoteAddress);
    if (result.allowed) {
        next();
        return;
    }

    const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.retryAfterMs / 1000)
    );
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
        message: "语音发送得太频繁了，请稍等一下再试。",
        retry_after_seconds: retryAfterSeconds
    });
}

async function requireAssistantMoment(momentId, actionLabel) {
    const { data, error } = await supabase
        .from("moments")
        .select("id, author")
        .eq("id", momentId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        const notFound = new Error("找不到这条动态。");
        notFound.status = 404;
        throw notFound;
    }
    if (data.author !== "assistant") {
        const invalidTarget = new Error(`只能${actionLabel} AI 发布的动态。`);
        invalidTarget.status = 400;
        throw invalidTarget;
    }

    return data;
}

function estimateTokenCount(value) {
    const text = String(value ?? "");
    if (!text) return 0;
    return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3));
}

function estimateContextTokenCount(settings, messages, memories) {
    const configuredPrompt =
        normalizePromptMode(settings.prompt_mode) === "unified" &&
        cleanUnifiedSystemPrompt(settings.unified_system_prompt)
            ? [settings.unified_system_prompt]
            : [
                  settings.system_prompt,
                  settings.additional_prompt,
                  settings.personality
              ];
    const fixedContext = [
        ...configuredPrompt,
        settings.user_details,
        ...(memories || []).map((item) => item.summary)
    ]
        .filter(Boolean)
        .join("\n\n");

    return (
        estimateTokenCount(fixedContext) +
        (messages || []).reduce(
            (total, item) => total + 4 + estimateTokenCount(item.content),
            0
        )
    );
}

function normalizeApiUrl(value) {
    const cleaned = cleanText(value, 500).replace(/\/+$/, "");
    if (!cleaned) return "";

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        const error = new Error("API 地址格式不正确。");
        error.status = 400;
        throw error;
    }

    const hostname = parsed.hostname.toLowerCase();
    const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(
        hostname
    );
    const privateIpv4 =
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^169\.254\./.test(hostname);

    if (parsed.username || parsed.password) {
        const error = new Error("API 地址不能包含用户名或密码。");
        error.status = 400;
        throw error;
    }

    if (
        parsed.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && localDevelopmentHost)
    ) {
        const error = new Error("API 地址必须使用 HTTPS。");
        error.status = 400;
        throw error;
    }

    if (
        process.env.NODE_ENV === "production" &&
        (localDevelopmentHost || privateIpv4 || hostname.endsWith(".local"))
    ) {
        const error = new Error("公开部署时不能使用本机或内网 API 地址。");
        error.status = 400;
        throw error;
    }

    return cleaned;
}

function isMissingRelationError(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /could not find the table|relation .* does not exist/i.test(error?.message || "")
    );
}

function writeSse(res, event) {
    if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (typeof res.flush === "function") {
            res.flush();
        }
    }
}

function runtimeContextFromValues(values, companionStatus, userDisplayName = "") {
    return [
        buildEnvironmentRuntimeContext(values.environmentContext),
        buildCompanionStatusRuntimeContext(companionStatus, new Date(), {
            userDisplayName
        })
    ]
        .filter(Boolean)
        .join("\n");
}

function runtimeContextFromRequest(req, companionStatus) {
    return runtimeContextFromValues(
        {
            environmentContext:
                req.body.environment_context || req.body.weather_context
        },
        companionStatus
    );
}

async function getStoredSettings(database = supabase) {
    const { data, error } = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: created, error: createError } = await database
        .from("settings")
        .insert(defaultSettings)
        .select("*")
        .single();

    if (createError) {
        throw createError;
    }

    return created;
}

async function getSettings(database = supabase) {
    const stored = await getStoredSettings(database);
    const legacy = applyProviderSettingPins(
        stored,
        process.env,
        normalizeApiUrl
    );
    return aiProviderCenter
        .forDatabase(database)
        .resolveDefaultSettings(legacy);
}

async function ensureConversation(
    conversationId,
    firstMessage,
    database = supabase
) {
    if (conversationId) {
        if (!isUuid(conversationId)) {
            const error = new Error("会话编号格式不正确。");
            error.status = 400;
            throw error;
        }

        const { data, error } = await database
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            const notFound = new Error("找不到这个会话。");
            notFound.status = 404;
            throw notFound;
        }

        return data.id;
    }

    const title = cleanText(firstMessage, 30) || "新对话";
    const { data, error } = await database
        .from("conversations")
        .insert({ title })
        .select("id")
        .single();

    if (error) {
        throw error;
    }

    return data.id;
}

async function saveMessage(conversationId, role, content, options = {}) {
    const database = options.database || supabase;
    const toolCalls =
        options.tool_calls && typeof options.tool_calls === "object"
            ? options.tool_calls
            : {};
    const values = {
        conversation_id: conversationId,
        role,
        content,
        visible: options.visible !== false,
        tool_calls: toolCalls
    };
    if (options.client_message_id) {
        values.client_message_id = options.client_message_id;
    }
    if (options.reply_to_message_id && options.reply_snapshot) {
        values.reply_to_message_id = options.reply_to_message_id;
        values.reply_snapshot = options.reply_snapshot;
    }
    for (const [field, value] of Object.entries(
        options.generation_lease || {}
    )) {
        values[field] = value;
    }
    const { data, error } = await database
        .from("messages")
        .insert(values)
        .select(
            "id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot"
        )
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function loadReferencedMessage({
    messageId,
    conversationId,
    database = supabase
}) {
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, visible, tool_calls"
        )
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

function publicAssistantMessage(message, conversationId) {
    return publicAssistantMessageWithSpeechAccess(
        publicMessage(message),
        conversationId,
        process.env
    );
}

async function findUserMessageByClientId(
    clientMessageId,
    database = supabase
) {
    if (!clientMessageId) return null;
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot, " +
                "client_message_id, chat_generation_state, " +
                "chat_generation_lease_id, chat_generation_lease_expires_at, " +
                "chat_generation_started_at, chat_generation_failed_at, " +
                "chat_generation_completed_at"
        )
        .eq("client_message_id", clientMessageId)
        .eq("role", "user")
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function findAssistantReplyByClientId(
    conversationId,
    clientMessageId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            reply_to_client_message_id: clientMessageId
        })
        .order("created_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    return data?.[0] || null;
}

function emitCommittedUserReceipt(savedUserMessage, onStatus) {
    onStatus({
        type: "status",
        stage: "already_received"
    });
    onStatus({
        type: "meta",
        session_id: savedUserMessage.conversation_id,
        user_message: publicMessage(savedUserMessage),
        deduplicated: true
    });
}

async function replayCommittedChatTurn(
    savedUserMessage,
    input,
    onStatus,
    receiptEmitted = false,
    database = supabase
) {
    assertClientMessageConversation(
        savedUserMessage,
        input.conversationId
    );
    const conversationId = savedUserMessage.conversation_id;
    const savedAssistantMessage = await findAssistantReplyByClientId(
        conversationId,
        input.clientMessageId,
        database
    );

    if (!receiptEmitted) {
        emitCommittedUserReceipt(savedUserMessage, onStatus);
    }

    if (!savedAssistantMessage) {
        throw chatGenerationInProgressError();
    }

    return {
        reply: savedAssistantMessage.content,
        session_id: conversationId,
        conversation_id: conversationId,
        user_message: publicMessage(savedUserMessage),
        assistant_message: publicAssistantMessage(
            savedAssistantMessage,
            conversationId
        ),
        model: savedUserMessage.tool_calls?.resolved_model || "",
        provider: "",
        response_mode:
            savedAssistantMessage.tool_calls?.response_mode || "deduplicated",
        prompt_receipt: null,
        memory_compression: null,
        companion_status: null,
        deduplicated: true
    };
}

async function findCompanionInteractionReply(
    conversationId,
    eventId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            is_companion_interaction: true,
            client_event_id: eventId
        })
        .order("created_at", { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    return data?.[0] || null;
}

async function loadChatContext(
    conversationId,
    settings,
    database = supabase
) {
    return loadMainChatContextRows({
        database,
        conversationId,
        settings
    });
}

async function loadCompanionInteractionContext(
    conversationId,
    settings,
    database = supabase
) {
    return loadCompanionInteractionContextRows({
        database,
        conversationId,
        settings
    });
}

async function touchConversation(conversationId, database = supabase) {
    const { error } = await database
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

    if (error) {
        throw error;
    }
}

async function compressMemoryIfNeeded(
    conversationId,
    settings,
    database = supabase
) {
    if (memoryCompressionLocks.has(conversationId)) {
        return { compressed: false, reason: "already_running" };
    }

    memoryCompressionLocks.add(conversationId);

    try {
        const threshold = Math.max(
            1000,
            Number(settings.compression_threshold || 12000)
        );
        const keepRounds = Math.max(
            1,
            Number(settings.compression_keep || 20)
        );
        const compressionContext = await loadMemoryCompressionRows({
            database,
            conversationId,
            settings
        });
        const messages = compressionContext.messages;
        const existingMemories = compressionContext.memories;
        const estimatedTokenCount = estimateContextTokenCount(
            settings,
            messages,
            existingMemories
        );

        if (estimatedTokenCount <= threshold) {
            return {
                compressed: false,
                reason: "below_threshold",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (messages.length <= 2) {
            return {
                compressed: false,
                reason: "not_enough_messages",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        const desiredKeepMessages = keepRounds * 2;
        let compressCount = Math.max(
            2,
            messages.length - desiredKeepMessages
        );
        compressCount = Math.min(compressCount, messages.length - 2);
        if (compressCount % 2 !== 0 && compressCount > 2) {
            compressCount -= 1;
        }
        const messagesToCompress = messages.slice(0, compressCount);

        const generated = await generateMemorySummary({
            settings,
            messages: messagesToCompress,
            existingMemories
        });

        if (generated.skipped === true) {
            return {
                compressed: false,
                reason: "nothing_worth_remembering",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (!generated.text) {
            return {
                compressed: false,
                reason: "model_unavailable",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        const { data: savedMemory, error: insertError } = await database
            .from("memories")
            .insert({
                conversation_id: null,
                summary: generated.text
            })
            .select("id, summary, created_at, updated_at")
            .single();

        if (insertError) {
            throw insertError;
        }

        const ids = messagesToCompress.map((item) => item.id);
        const { error: hideError } = await database
            .from("messages")
            .update({ visible: false })
            .in("id", ids);

        if (hideError) {
            await database.from("memories").delete().eq("id", savedMemory.id);
            throw hideError;
        }

        return {
            compressed: true,
            memory_id: savedMemory.id,
            hidden_message_count: ids.length,
            visible_message_count: messages.length - ids.length,
            estimated_token_count: estimatedTokenCount,
            mode: generated.mode
        };
    } finally {
        memoryCompressionLocks.delete(conversationId);
    }
}

async function tryCompressMemory(
    conversationId,
    settings,
    database = supabase
) {
    try {
        return await compressMemoryIfNeeded(
            conversationId,
            settings,
            database
        );
    } catch (error) {
        console.error("长期记忆压缩失败：", error);
        return {
            compressed: false,
            reason: "compression_failed"
        };
    }
}

function randomDelayMinutes(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function tryScheduleProactiveMessageEvaluation({
    database,
    settings,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        settings?.push_enabled !== true ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return { scheduled: false, reason: "disabled" };
    }
    try {
        return await scheduleProactiveMessageEvaluation({
            database,
            sourceMessageId
        });
    } catch (error) {
        console.error(
            "主动消息后台评估排期失败：",
            error?.code || "database_error"
        );
        return { scheduled: false, reason: "schedule_failed" };
    }
}

async function tryScheduleAutonomousContentEvaluations({
    database,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return {
            momentPost: { scheduled: false, reason: "disabled" },
            diaryUpdate: { scheduled: false, reason: "disabled" },
            profileRefresh: {
                scheduled: false,
                reason: "disabled"
            }
        };
    }

    const [momentPost, diaryUpdate, profileRefresh] =
        await Promise.all([
        scheduleMomentPostEvaluation({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "自主动态后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleDiaryUpdate({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "私人日记后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleProfileRefresh({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "角色档案后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        })
    ]);
    return { momentPost, diaryUpdate, profileRefresh };
}

function randomDelaySeconds(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function imageExtension(mimeType) {
    const extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
    };
    return extensions[mimeType] || "jpg";
}

function normalizeMomentImages(value) {
    if (!Array.isArray(value)) return [];

    return value.slice(0, 4).map((item) => {
        const mimeType = cleanText(item?.type || item?.mime_type, 80).toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
            const error = new Error("动态图片只支持 JPG、PNG、WebP 或 GIF。");
            error.status = 400;
            throw error;
        }

        const rawData = String(item?.data || "")
            .replace(/^data:[^;]+;base64,/, "")
            .replace(/\s/g, "");
        if (!rawData || !/^[A-Za-z0-9+/]+={0,2}$/.test(rawData)) {
            const error = new Error("有一张动态图片无法读取。");
            error.status = 400;
            throw error;
        }

        const bytes = Buffer.from(rawData, "base64");
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
            const error = new Error("每张动态图片必须小于 5MB。");
            error.status = 400;
            throw error;
        }

        return { mimeType, bytes };
    });
}

async function uploadMomentImages(images) {
    const urls = [];
    const paths = [];
    const dateFolder = new Date().toISOString().slice(0, 10);

    try {
        for (const image of images) {
            const filePath = `user/${dateFolder}/${randomUUID()}.${imageExtension(
                image.mimeType
            )}`;
            const { error } = await supabase.storage
                .from("moments")
                .upload(filePath, image.bytes, {
                    contentType: image.mimeType,
                    upsert: false
                });

            if (error) throw error;

            const { data } = supabase.storage
                .from("moments")
                .getPublicUrl(filePath);
            paths.push(filePath);
            urls.push(data.publicUrl);
        }

        return { urls, paths };
    } catch (error) {
        if (paths.length > 0) {
            await supabase.storage.from("moments").remove(paths);
        }
        throw error;
    }
}

function momentSessionId(moment) {
    const match = String(moment.context_note || "").match(
        /active_session_id:([0-9a-f-]{36})/i
    );
    return match && isUuid(match[1]) ? match[1] : null;
}

async function getMomentConversationId(moment) {
    const storedId = momentSessionId(moment);
    if (storedId) return storedId;

    const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data?.id || null;
}

async function buildMomentBackground(moment) {
    const conversationId = await getMomentConversationId(moment);
    const chatQuery = conversationId
        ? supabase
              .from("messages")
              .select("role, content, created_at")
              .eq("conversation_id", conversationId)
              .eq("visible", true)
              .order("created_at", { ascending: false })
              .limit(8)
        : Promise.resolve({ data: [], error: null });

    const [chatResult, memoriesResult, timelineResult] = await Promise.all([
        chatQuery,
        database
            .from("memories")
            .select("summary, updated_at")
            .order("updated_at", { ascending: false })
            .limit(5),
        supabase
            .from("moments")
            .select("id, author, content, reply_content, liked, created_at")
            .neq("id", moment.id)
            .order("created_at", { ascending: false })
            .limit(3)
    ]);

    for (const result of [chatResult, memoriesResult, timelineResult]) {
        if (result.error) throw result.error;
    }

    const recentChat = filterProviderBoundaryMessages(chatResult.data)
        .reverse()
        .map(
            (item) =>
                `${item.role === "assistant" ? "AI" : "用户"}：${cleanText(
                    item.content,
                    160
                )}`
        )
        .join("\n");
    const memories = filterMemoriesForContext(memoriesResult.data)
        .map((item) => cleanText(item.summary, 400))
        .join("\n");
    const timeline = (timelineResult.data || [])
        .map((item) => {
            const reaction =
                item.reply_content &&
                !isProviderBoundaryResidue(item.reply_content)
                ? `；AI回应：${cleanText(item.reply_content, 120)}`
                : "";
            return `${item.author === "assistant" ? "AI" : "用户"}动态：${cleanText(
                item.content,
                120
            )}${reaction}`;
        })
        .join("\n");
    const imageContext = moment.image_description
        ? `图片曾被理解为：${cleanText(moment.image_description, 1000)}`
        : Array.isArray(moment.images) && moment.images.length > 0
          ? `附有 ${moment.images.length} 张图片，本次是第一次查看。`
          : "没有图片。";
    const internalContext = cleanInternalMomentContext(moment.context_note, 1000);

    return [
        `【近期聊天】\n${recentChat || "暂无"}`,
        `【长期记忆】\n${memories || "暂无"}`,
        `【近期动态】\n${timeline || "暂无"}`,
        `【当前动态】\n正文：${cleanText(moment.content, 2000) || "（仅图片）"}\n发布时间：${moment.created_at}\n${imageContext}${
            internalContext ? `\n内部语境：${internalContext}` : ""
        }`
    ].join("\n\n");
}

function parseMomentReactionOutput(text) {
    const source = String(text || "");
    const descriptions = [
        ...source.matchAll(/\[image_desc\]([\s\S]*?)\[\/image_desc\]/gi)
    ];
    const imageDescription = descriptions.length
        ? cleanText(descriptions[descriptions.length - 1][1], 1000)
        : null;
    const cleaned = source
        .replace(/\[image_desc\][\s\S]*?\[\/image_desc\]/gi, "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    try {
        if (start < 0 || end <= start) throw new Error("missing_json");
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return {
            liked: parsed.like === true,
            comment: cleanText(parsed.comment, 500),
            imageDescription
        };
    } catch {
        return {
            liked: false,
            comment: "",
            imageDescription
        };
    }
}

async function processDueMomentReply() {
    const { data: dueMoments, error } = await supabase
        .from("moments")
        .select("*")
        .eq("author", "user")
        .eq("reply_status", "pending")
        .lte("reply_due_at", new Date().toISOString())
        .order("reply_due_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    const moment = dueMoments?.[0];
    if (!moment || momentReplyLocks.has(moment.id)) return;

    momentReplyLocks.add(moment.id);
    try {
        const [settings, background] = await Promise.all([
            getSettings(),
            buildMomentBackground(moment)
        ]);
        const hasImages = Array.isArray(moment.images) && moment.images.length > 0;
        const imageInstruction = hasImages && !moment.image_description
            ? [
                  "这条动态包含图片。JSON 后请额外输出",
                  "[image_desc]...[/image_desc]，用 100-200 字客观描述画面内容、构图、光线和可读文字，不推测发布者心理。"
              ].join("")
            : "不要输出 image_desc 标签。";
        const prompt = [
            background,
            "请决定你对这条用户动态的自然反应。",
            "严格输出一行 JSON：{\"like\":true或false,\"comment\":\"不超过80字的评论，可为空字符串\"}",
            "不要在 JSON 前后解释。",
            imageInstruction
        ].join("\n\n");
        const generated = await generateMomentReaction({
            settings,
            prompt,
            imageUrls: hasImages && !moment.image_description ? moment.images : []
        });

        if (!generated.text) {
            await supabase
                .from("moments")
                .update({
                    reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
                })
                .eq("id", moment.id)
                .eq("reply_status", "pending");
            return;
        }

        const reaction = parseMomentReactionOutput(generated.text);
        const { error: updateError } = await supabase
            .from("moments")
            .update({
                liked: reaction.liked,
                reply_content: reaction.comment || null,
                image_description:
                    reaction.imageDescription || moment.image_description || null,
                replied_at: new Date().toISOString(),
                reply_status: "done"
            })
            .eq("id", moment.id)
            .eq("reply_status", "pending");

        if (updateError) throw updateError;
    } catch (error) {
        await supabase
            .from("moments")
            .update({
                reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
            })
            .eq("id", moment.id)
            .eq("reply_status", "pending");
        throw error;
    } finally {
        momentReplyLocks.delete(moment.id);
    }
}

async function processDueCommentReply() {
    const { data: dueComments, error } = await supabase
        .from("moment_comments")
        .select("*")
        .eq("author", "user")
        .eq("reply_status", "pending")
        .lte("reply_due_at", new Date().toISOString())
        .order("reply_due_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    const pendingComment = dueComments?.[0];
    if (!pendingComment || commentReplyLocks.has(pendingComment.id)) return;

    commentReplyLocks.add(pendingComment.id);
    let savedReplyId = null;

    try {
        const [momentResult, commentsResult, settings] = await Promise.all([
            supabase
                .from("moments")
                .select("*")
                .eq("id", pendingComment.moment_id)
                .single(),
            supabase
                .from("moment_comments")
                .select("author, content, created_at")
                .eq("moment_id", pendingComment.moment_id)
                .order("created_at", { ascending: false })
                .limit(10),
            getSettings()
        ]);

        if (momentResult.error) throw momentResult.error;
        if (commentsResult.error) throw commentsResult.error;

        const moment = momentResult.data;
        const [background, commentChain] = await Promise.all([
            buildMomentBackground(moment),
            Promise.resolve(
                (commentsResult.data || [])
                    .reverse()
                    .map(
                        (item) =>
                            `${item.author === "assistant" ? "AI" : "用户"}：${cleanText(
                                item.content,
                                300
                            )}`
                    )
                    .join("\n")
            )
        ]);
        const generated = await generateMomentReaction({
            settings: {
                ...settings,
                temperature: Math.max(
                    0.6,
                    Number(settings.temperature || 0.7)
                ),
                max_tokens: Math.min(
                    300,
                    Number(settings.max_tokens || 300)
                )
            },
            prompt: `${background}\n\n【最近评论链】\n${commentChain}\n\n请回复最后一条用户评论。`,
            purpose: "moment_comment"
        });

        if (!generated.text || generated.mode === "placeholder") return;

        const { data: savedReply, error: insertError } = await supabase
            .from("moment_comments")
            .insert({
                moment_id: pendingComment.moment_id,
                author: "assistant",
                content: cleanText(generated.text, 1000),
                reply_due_at: null,
                reply_status: "none"
            })
            .select("id")
            .single();

        if (insertError) throw insertError;
        savedReplyId = savedReply.id;

        const { error: updateError } = await supabase
            .from("moment_comments")
            .update({ reply_status: "done" })
            .eq("id", pendingComment.id)
            .eq("reply_status", "pending");

        if (updateError) throw updateError;
    } catch (error) {
        if (savedReplyId) {
            await supabase.from("moment_comments").delete().eq("id", savedReplyId);
        }
        await supabase
            .from("moment_comments")
            .update({
                reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
            })
            .eq("id", pendingComment.id)
            .eq("reply_status", "pending");
        throw error;
    } finally {
        commentReplyLocks.delete(pendingComment.id);
    }
}

async function processDueMoments() {
    const results = await Promise.allSettled([
        processDueMomentReply(),
        processDueCommentReply()
    ]);

    results.forEach((result) => {
        if (result.status === "rejected") {
            console.error("动态延迟回复生成失败：", result.reason);
        }
    });
}

function diaryStatus(state, message, extra = {}) {
    diaryGenerationStatus = {
        state,
        message,
        ...extra,
        updated_at: new Date().toISOString()
    };
    return diaryGenerationStatus;
}

function parseDiaryOutput(value, sourceWindowEnd) {
    const cleaned = String(value || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        const title = cleanText(parsed.title, 120);
        const content = cleanText(parsed.content, 6000);
        const mood = cleanText(parsed.mood, 80);
        const happenedOn = /^\d{4}-\d{2}-\d{2}$/.test(
            String(parsed.happened_on || "")
        )
            ? String(parsed.happened_on)
            : String(sourceWindowEnd || "").slice(0, 10);
        if (!title || content.length < 80) return null;
        return {
            title,
            content,
            mood,
            happened_on: happenedOn || null
        };
    } catch {
        return null;
    }
}

function toPublicDiaryEntry(entry) {
    const sourceIds = Array.isArray(entry?.source_message_ids)
        ? entry.source_message_ids
        : [];
    const { source_message_ids, ...publicEntry } = entry;
    return {
        ...publicEntry,
        source_message_count: sourceIds.length
    };
}

async function diarySourceBatch() {
    const latestResult = await supabase
        .from("companion_diary_entries")
        .select("source_window_end")
        .order("source_window_end", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestResult.error) throw latestResult.error;

    let query = supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("visible", true)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true })
        .limit(24);
    if (latestResult.data?.source_window_end) {
        query = query.gt("created_at", latestResult.data.source_window_end);
    }

    const result = await query;
    if (result.error) throw result.error;
    return filterProviderBoundaryMessages(result.data);
}

async function maybeGenerateDiaryEntry() {
    if (diaryGenerationLock) return diaryGenerationStatus;
    diaryGenerationLock = true;

    try {
        const messages = await diarySourceBatch();
        const userCount = messages.filter((item) => item.role === "user").length;
        const assistantCount = messages.filter(
            (item) => item.role === "assistant"
        ).length;
        if (messages.length < 8 || userCount < 3 || assistantCount < 3) {
            const remaining = Math.max(0, 8 - messages.length);
            return diaryStatus(
                "needs_more",
                remaining > 0
                    ? `还需要至少 ${remaining} 条新的双向消息，才会写下一篇。`
                    : "再聊几轮，让这一段经历更完整后再写。"
            );
        }

        diaryStatus("writing", "正在把最近的真实对话整理成一篇日记。");
        const [settings, memoriesResult] = await Promise.all([
            getSettings(),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(6)
        ]);
        if (memoriesResult.error) throw memoriesResult.error;

        const sourceWindowStart = messages[0].created_at;
        const sourceWindowEnd = messages[messages.length - 1].created_at;
        const chatText = messages
            .map(
                (item) =>
                    `[${item.created_at}] ${
                        item.role === "assistant" ? "AI" : "用户"
                    }：${cleanText(item.content, 500)}`
            )
            .join("\n");
        const memoryText = filterMemoriesForContext(memoriesResult.data)
            .map(
                (item) =>
                    `[${item.updated_at}] ${cleanText(item.summary, 600)}`
            )
            .join("\n");
        const prompt = [
            "请依据下面这段聊天和长期记忆，写一篇 AI 伴侣第一人称的私人记忆日记。",
            "沿用个性化指令决定的叙事世界，可以写没有直接说出口的在意、观察、感受和联想，并保持人物、时间与事件内部连贯。",
            "严格输出一行 JSON：",
            '{"title":"10-24字标题","content":"220-700字日记正文","mood":"2-8字氛围","happened_on":"YYYY-MM-DD"}',
            `【来源时间窗】\n${sourceWindowStart} 至 ${sourceWindowEnd}`,
            `【真实聊天】\n${chatText}`,
            `【长期记忆】\n${memoryText || "暂无额外长期记忆"}`
        ].join("\n\n");
        const generated = await generateMomentReaction({
            settings,
            prompt,
            purpose: "diary"
        });
        if (!generated.text) {
            return diaryStatus(
                "waiting_model",
                "模型连接可用后，会继续写这段已经积累好的日记。"
            );
        }

        const parsed = parseDiaryOutput(generated.text, sourceWindowEnd);
        if (!parsed) {
            return diaryStatus(
                "retrying",
                "这次日记格式不完整，稍后会根据同一段真实对话重试。"
            );
        }

        const { data, error } = await supabase
            .from("companion_diary_entries")
            .insert({
                ...parsed,
                source_message_ids: messages.map((item) => item.id),
                source_window_start: sourceWindowStart,
                source_window_end: sourceWindowEnd
            })
            .select("*")
            .single();
        if (error) {
            if (String(error.code || "") === "23505") {
                return diaryStatus("watching", "这一段真实对话已经写进日记。");
            }
            throw error;
        }

        diaryStatus("updated", "刚刚根据新的真实对话写好了一篇。", {
            entry_id: data.id
        });
        return diaryGenerationStatus;
    } catch (error) {
        if (isMissingRelationError(error)) {
            return diaryStatus(
                "migration_required",
                "日记数据表尚未创建，需要执行数据库迁移。"
            );
        }
        console.error("伴侣日记生成失败：", error);
        return diaryStatus(
            "retrying",
            "日记暂时没有写成功，服务恢复后会自动重试。"
        );
    } finally {
        diaryGenerationLock = false;
    }
}

function isShadowPushMessage(message) {
    const metadata = message?.tool_calls;
    return Boolean(
        metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata) &&
            metadata.is_push === true
    );
}

function buildRecentMomentsText(moments) {
    if (!Array.isArray(moments) || moments.length === 0) {
        return "暂无近期动态。";
    }

    return moments
        .map((moment) => {
            const author = moment.author === "assistant" ? "AI" : "用户";
            const content = cleanText(moment.content, 120) || "（只有图片）";
            const interaction = [
                moment.liked ? "AI 点过赞" : "",
                moment.user_liked ? "用户点过赞" : "",
                moment.reply_content
                    ? `AI 留言：${cleanText(moment.reply_content, 100)}`
                    : ""
            ]
                .filter(Boolean)
                .join("；");
            return `${author}：${content}${interaction ? `（${interaction}）` : ""}`;
        })
        .join("\n");
}

async function loadShadowPushContext(now, timezone) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
        return { available: false, reason: "no_active_conversation" };
    }

    const recentCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const [messagesResult, memoriesResult, momentsResult, pushMessagesResult] =
        await Promise.all([
            supabase
                .from("messages")
                .select("role, content, created_at")
                .eq("conversation_id", conversation.id)
                .eq("visible", true)
                .order("created_at", { ascending: false })
                .limit(16),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(5),
            supabase
                .from("moments")
                .select(
                    "author, content, liked, user_liked, reply_content, created_at"
                )
                .order("created_at", { ascending: false })
                .limit(6),
            supabase
                .from("messages")
                .select("created_at, tool_calls")
                .eq("conversation_id", conversation.id)
                .eq("role", "assistant")
                .gte("created_at", recentCutoff)
                .order("created_at", { ascending: false })
                .limit(100)
        ]);

    for (const result of [
        messagesResult,
        memoriesResult,
        momentsResult,
        pushMessagesResult
    ]) {
        if (result.error) throw result.error;
    }

    const recentMessages = filterProviderBoundaryMessages(
        (messagesResult.data || []).reverse()
    );
    if (recentMessages.length === 0) {
        return { available: false, reason: "no_conversation_context" };
    }

    const clock = getZonedClock(now, timezone);
    const pushesToday = (pushMessagesResult.data || []).filter(
        (message) =>
            isShadowPushMessage(message) &&
            getZonedClock(new Date(message.created_at), timezone).date === clock.date
    ).length;

    return {
        available: true,
        conversation,
        recentMessages,
        lastMessageAt: recentMessages[recentMessages.length - 1]?.created_at,
        memories: filterMemoriesForContext(memoriesResult.data),
        moments: momentsResult.data || [],
        pushesToday
    };
}

async function generateShadowPush({ now = new Date(), random = Math.random } = {}) {
    const settings = await getSettings();
    if (settings.push_enabled !== true) {
        return { pushed: false, reason: "disabled" };
    }
    if (shadowPushLock) {
        return { pushed: false, reason: "locked" };
    }

    shadowPushLock = true;
    try {
        const timezone = resolveTimezone(settings.timezone || "Asia/Shanghai");
        const context = await loadShadowPushContext(now, timezone);
        if (!context.available) {
            return { pushed: false, reason: context.reason };
        }

        const cooldownMinutes = randomCooldownMinutes(random);
        const decision = decideShadowPush({
            now,
            timezone,
            lastMessageAt: context.lastMessageAt,
            pushesToday: context.pushesToday,
            maxPushPerDay: settings.max_push_per_day ?? 7,
            cooldownMinutes
        });
        if (!decision.shouldPush) {
            return {
                pushed: false,
                reason: decision.reason,
                cooldown_minutes: decision.cooldownMinutes
            };
        }

        const shadowUserContent = buildShadowUserContent({
            clock: decision.clock,
            memories: context.memories,
            momentsText: buildRecentMomentsText(context.moments)
        });
        const pushMessages = appendShadowUserTrigger(
            context.recentMessages,
            shadowUserContent
        );
        const generated = await generateReply({
            settings: {
                ...settings,
                max_tokens: 200,
                temperature: 0.9
            },
            messages: pushMessages,
            // 影子消息已经包含同一份记忆；这里不再注入 system，避免重复加权。
            memories: [],
            runtimeContext: ""
        });

        if (generated.mode === "placeholder") {
            return { pushed: false, reason: "model_unavailable" };
        }

        const reply = cleanPushReply(generated.text);
        if (!reply) {
            return { pushed: false, reason: "empty_response" };
        }

        const savedMessage = await saveMessage(
            context.conversation.id,
            "assistant",
            reply,
            {
                visible: true,
                tool_calls: {
                    is_push: true,
                    generated_at: now.toISOString(),
                    timezone: decision.clock.timezone,
                    response_mode: generated.mode
                }
            }
        );
        await touchConversation(context.conversation.id);

        return {
            pushed: true,
            reason: "sent",
            message: reply,
            session_id: context.conversation.id,
            assistant_message: savedMessage,
            cooldown_minutes: cooldownMinutes
        };
    } finally {
        shadowPushLock = false;
    }
}

function chatAttachmentOptions() {
    return {
        hervoiceUrl: process.env.HERVOICE_URL,
        hervoiceSecret: process.env.HERVOICE_SECRET,
        hervoiceTimeoutMs: process.env.HERVOICE_TIMEOUT_MS
    };
}

async function executeChatTurnOnce(
    input,
    onStatus,
    onModelEvent,
    processingStages
) {
    const database = input.requestScope?.db || supabase;
    const userDisplayName = cleanText(
        input.requestScope?.profile?.display_name,
        80
    );
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    let storedAttachments = [];
    let preparedAttachments = [];
    let attachmentsCommitted = false;
    let savedUserMessage = null;
    let assistantCommitted = false;
    let leaseHeartbeat = null;
    let resolvedMessageReference = null;
    const generationLeaseId = input.clientMessageId ? randomUUID() : "";

    async function stopLeaseHeartbeat() {
        if (!leaseHeartbeat) return;
        const current = leaseHeartbeat;
        leaseHeartbeat = null;
        await current.stop();
    }

    try {
        const [previousUserMessage, settings] = await Promise.all([
            findUserMessageByClientId(input.clientMessageId, database),
            getSettings(database)
        ]);
        if (previousUserMessage) {
            assertClientMessageConversation(
                previousUserMessage,
                input.conversationId
            );
            emitCommittedUserReceipt(previousUserMessage, onStatus);
            const previousAssistant = await findAssistantReplyByClientId(
                previousUserMessage.conversation_id,
                input.clientMessageId,
                database
            );
            if (previousAssistant) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            const claimed = await chatGenerationLeaseStore.claim(
                input.clientMessageId,
                generationLeaseId,
                ownership
            );
            if (claimed?.claimed !== true || !claimed.message) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            savedUserMessage = claimed.message;
            attachmentsCommitted = true;
        }

        const effectiveModel = await resolveTurnModel(
            settings,
            input.requestedModel
        );

        if (input.files.length > 0) {
            onStatus({
                type: "status",
                stage: "processing_attachments",
                count: input.files.length
            });
        }
        preparedAttachments = await prepareAttachments(
            input.files,
            chatAttachmentOptions()
        );
        if (input.attachmentStorageMode === "ephemeral") {
            validateEphemeralAttachments(preparedAttachments);
        }
        const userMessage = savedUserMessage
            ? savedUserMessage.content
            : visibleMessageText(input.message, preparedAttachments);
        if (!userMessage) {
            const error = new Error("消息和附件不能同时为空。");
            error.status = 400;
            throw error;
        }

        if (preparedAttachments.length > 0) {
            onStatus({
                type: "status",
                stage: "attachments_ready",
                count: preparedAttachments.length
            });
        }

        const conversationId = savedUserMessage
            ? savedUserMessage.conversation_id
            : await ensureConversation(
                  input.conversationId,
                  userMessage,
                  database
              );
        if (savedUserMessage) {
            const savedSnapshot = normalizeMessageReferenceSnapshot(
                savedUserMessage.reply_snapshot
            );
            if (savedSnapshot) {
                resolvedMessageReference = {
                    messageId: savedSnapshot.message_id,
                    snapshot: savedSnapshot
                };
            }
        } else {
            resolvedMessageReference = await resolveMessageReference({
                reference: input.messageReference,
                conversationId,
                loadMessage: (reference) =>
                    loadReferencedMessage({ ...reference, database })
            });
        }
        const effectiveSettings = {
            ...settings,
            model: effectiveModel,
            emotion_understanding_enabled: input.emotionUnderstandingEnabled,
            attachment_system_prompt:
                input.attachmentInstructionMode === "system"
                    ? attachmentSystemInstruction(
                          preparedAttachments,
                          input.emotionUnderstandingEnabled
                      )
                    : ""
        };

        if (
            preparedAttachments.length > 0 &&
            !savedUserMessage &&
            shouldPersistAttachments(input.attachmentStorageMode)
        ) {
            storedAttachments = await storeAttachments(
                supabase,
                conversationId,
                preparedAttachments
            );
        }
        if (!savedUserMessage) {
            try {
                savedUserMessage = await saveMessage(
                    conversationId,
                    "user",
                    userMessage,
                    {
                        client_message_id: input.clientMessageId,
                        reply_to_message_id:
                            resolvedMessageReference?.messageId,
                        reply_snapshot:
                            resolvedMessageReference?.snapshot,
                        generation_lease: input.clientMessageId
                            ? generationLeaseFields(generationLeaseId)
                            : undefined,
                        tool_calls: {
                            ...attachmentToolCalls(storedAttachments),
                            ...(input.attachmentStorageMode === "ephemeral"
                                ? { ephemeral_visual: true }
                                : {}),
                            attachment_instruction_mode:
                                input.attachmentInstructionMode,
                            requested_model: input.requestedModel || null,
                            resolved_model: effectiveModel || ""
                        },
                        database
                    }
                );
            } catch (error) {
                if (
                    !input.clientMessageId ||
                    !isClientMessageUniqueConflict(error)
                ) {
                    throw error;
                }

                await removeStoredAttachments(supabase, storedAttachments);
                storedAttachments = [];
                const raceWinner = await findUserMessageByClientId(
                    input.clientMessageId,
                    database
                );
                if (!raceWinner) throw error;
                return replayCommittedChatTurn(
                    raceWinner,
                    input,
                    onStatus,
                    false,
                    database
                );
            }
            attachmentsCommitted = true;
            onStatus({
                type: "meta",
                session_id: conversationId,
                user_message: publicMessage(savedUserMessage)
            });
        }

        const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
            isContextTimestampCurrent(
                input.companionStatus?.updatedAt,
                settings
            )
                ? input.companionStatus
                : {},
            new Date(),
            { userDisplayName }
        );
        onStatus({ type: "status", stage: "organizing_context" });
        const [context, mcpRuntime] = await Promise.all([
            loadChatContext(conversationId, settings, database),
            mcpDeviceCenter
                .forDatabase(database)
                .createRuntime()
                .catch((error) => {
                    console.error(
                        "MCP 设备运行时加载失败：",
                        error?.code || error?.message || "unknown"
                    );
                    return {
                        tools: [],
                        actions: [],
                        runtimeContext: "",
                        hasTool: () => false,
                        execute: async () => ({
                            ok: false,
                            error: "设备中心暂时不可用。"
                        })
                    };
                })
        ]);
        const chatTools = createChatToolExecutor(
            conversationId,
            initialCompanionStatus,
            input.clientMessageId,
            mcpRuntime,
            database,
            userDisplayName
        );
        if (input.clientMessageId) {
            leaseHeartbeat = createChatGenerationLeaseHeartbeat({
                renew: () =>
                    chatGenerationLeaseStore.renew(
                        input.clientMessageId,
                        generationLeaseId,
                        ownership
                    )
            });
            await leaseHeartbeat.assertOwned();
        }
        const executeChatTool = input.clientMessageId
            ? async (toolCall) => {
                  await leaseHeartbeat.assertOwned();
                  return chatTools.executeTool(toolCall);
              }
            : chatTools.executeTool;
        const runtimeContext = [
            runtimeContextFromValues(
                {
                    environmentContext: input.environmentContext
                },
                initialCompanionStatus,
                userDisplayName
            ),
            attachmentRuntimeContext(
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            messageReferenceRuntimeContext(
                resolvedMessageReference?.snapshot
            ),
            buildNurseryRuntimeContext(context.nursery, userMessage),
            mcpRuntime.runtimeContext
        ]
            .filter(Boolean)
            .join("\n\n");
        const generationInput = {
            settings: effectiveSettings,
            messages: withAttachmentUserContext(
                context.messages,
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            memories: context.memories,
            runtimeContext,
            turnContext: input.turnContext,
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            attachments: modelImageAttachments(preparedAttachments),
            publicProgress: {
                companionMood: initialCompanionStatus.mood,
                hasAttachments: preparedAttachments.length > 0
            },
            tools: [
                UPDATE_COMPANION_STATUS_TOOL,
                POST_MOMENT_TOOL,
                SELECT_COMPANION_STICKER_TOOL,
                SELECT_REPLY_SUGGESTIONS_TOOL,
                ...mcpRuntime.tools
            ],
            executeTool: executeChatTool
        };

        onStatus({ type: "status", stage: "calling_model" });
        const stopModelWaitProgress = startModelWaitProgress({ onStatus });
        const forwardModelEvent = onModelEvent
            ? (event) => {
                  stopModelWaitProgress();
                  onModelEvent(event);
              }
            : null;
        let generated;
        try {
            generated = forwardModelEvent
                ? await generateReplyStream({
                      ...generationInput,
                      onEvent: forwardModelEvent
                  })
                : await generateReply(generationInput);
        } finally {
            stopModelWaitProgress();
        }
        assertProviderOutputSafe(generated.text);

        onStatus({ type: "status", stage: "saving" });
        const finalizedReplySuggestions = finalizeReplySuggestions({
            recentMessages: context.messages,
            assistantText: generated.text,
            candidate: chatTools.getReplySuggestions(),
            previousSuggestions: previousReplySuggestionsFromMessages(
                context.messages
            )
        });
        const assistantToolCalls = {
            resolved_model: effectiveModel || "",
            response_mode: generated.mode,
            processing_stages: appendPublicProcessingStage(
                processingStages,
                "completed"
            ),
            ...(mcpRuntime.actions.length
                ? { mcp_actions: mcpRuntime.actions }
                : {}),
            ...companionStickerToolCalls(chatTools.getStickerId()),
            ...replySuggestionToolCalls(finalizedReplySuggestions),
            ...(input.clientMessageId
                ? { reply_to_client_message_id: input.clientMessageId }
                : {})
        };
        let savedAssistantMessage;
        if (input.clientMessageId) {
            await leaseHeartbeat.assertOwned();
            await stopLeaseHeartbeat();
            const committed = await chatGenerationLeaseStore.commit({
                ...ownership,
                clientMessageId: input.clientMessageId,
                leaseId: generationLeaseId,
                content: generated.text,
                toolCalls: assistantToolCalls
            });
            if (
                committed?.committed !== true ||
                !committed.assistant_message
            ) {
                throw chatGenerationInProgressError();
            }
            savedAssistantMessage = committed.assistant_message;
        } else {
            savedAssistantMessage = await saveMessage(
                conversationId,
                "assistant",
                generated.text,
                { tool_calls: assistantToolCalls, database }
            );
        }
        assistantCommitted = true;
        await touchConversation(conversationId, database);
        await tryScheduleProactiveMessageEvaluation({
            database,
            settings,
            sourceMessageId: savedAssistantMessage.id
        });
        await tryScheduleAutonomousContentEvaluations({
            database,
            sourceMessageId: savedAssistantMessage.id
        });
        const memoryCompression = await tryCompressMemory(
            conversationId,
            settings,
            database
        );
        onStatus({ type: "status", stage: "completed" });

        return {
            reply: generated.text,
            session_id: conversationId,
            conversation_id: conversationId,
            user_message: publicMessage(savedUserMessage),
            assistant_message: publicAssistantMessage(
                savedAssistantMessage,
                conversationId
            ),
            model: effectiveModel || "",
            provider: settings.provider,
            response_mode: generated.mode,
            prompt_receipt: generated.prompt_receipt || null,
            memory_compression: memoryCompression,
            companion_status: chatTools.getCompanionStatus()
        };
    } catch (error) {
        try {
            await stopLeaseHeartbeat();
        } catch (heartbeatError) {
            console.error("停止聊天生成租约续期失败：", heartbeatError);
        }
        if (!attachmentsCommitted && storedAttachments.length > 0) {
            await removeStoredAttachments(supabase, storedAttachments);
        }
        if (
            attachmentsCommitted &&
            !assistantCommitted &&
            input.clientMessageId &&
            savedUserMessage
        ) {
            try {
                await chatGenerationLeaseStore.fail(
                    input.clientMessageId,
                    generationLeaseId,
                    ownership
                );
            } catch (stateError) {
                console.error("释放聊天生成租约失败：", stateError);
            }
        }
        throw error;
    } finally {
        if (input.attachmentStorageMode === "ephemeral") {
            scrubAttachmentBuffers(input.files);
            scrubAttachmentBuffers(preparedAttachments);
        }
    }
}

async function executeChatTurn(req, hooks = {}) {
    const onStatus =
        typeof hooks.onStatus === "function" ? hooks.onStatus : () => {};
    const onModelEvent =
        typeof hooks.onModelEvent === "function" ? hooks.onModelEvent : null;
    const input = normalizeChatRequest(req);
    const processingStages = [];
    const emitStatus = (event) => {
        if (event?.type === "status") {
            const nextStages = appendPublicProcessingStage(
                processingStages,
                event.stage
            );
            processingStages.splice(0, processingStages.length, ...nextStages);
        }
        onStatus(event);
    };

    emitStatus({ type: "status", stage: "accepted" });
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    return runClientMessageTask(
        input.clientMessageId,
        () =>
            executeChatTurnOnce(
                input,
                emitStatus,
                onModelEvent,
                processingStages
            ),
        ownership
    );
}

app.get("/", (req, res) => {
    res.json({
        ok: true,
        message: "DengTa home 后端运行成功",
        version: appVersion
    });
});

app.get("/health", async (req, res) => {
    let providerConfigurationError = null;
    try {
        applyProviderSettingPins({}, process.env, normalizeApiUrl);
    } catch (error) {
        providerConfigurationError = error;
    }

    const expressiveSpeech = getExpressiveSpeechCapabilities(process.env);
    const aiProviderStatus = await aiProviderCenter.status().catch((error) => ({
        available: false,
        configured: false,
        profiles: 0,
        enabled_profiles: 0,
        active_profile: null,
        error: error?.code || "AI_PROVIDER_CENTER_ERROR",
        message: "多接口控制台状态暂时不可用。"
    }));
    res.status(providerConfigurationError ? 503 : 200).json({
        ok: !providerConfigurationError,
        time: new Date().toISOString(),
        version: appVersion,
        configuration: {
            provider_pins_valid: !providerConfigurationError,
            error_code: providerConfigurationError?.code || null
        },
        features: {
            text_emotion_understanding: true,
            companion_dynamic_status: true,
            stream_tool_fallback: true,
            companion_interaction_reply: true,
            companion_interaction_cost_guard: true,
            companion_interaction_idempotency: true,
            companion_sticker_selection: true,
            companion_creative_studio: true,
            companion_image_provider: true,
            companion_surprise_reveal: true,
            companion_chat_skin: true,
            dynamic_composer_hint: true,
            safe_chat_error_boundary: true,
            dynamic_reply_suggestions: true,
            dynamic_reply_suggestions_provider_agnostic: true,
            china_time_context: true,
            weather_context: true,
            device_activity_context: true,
            ephemeral_visual_attachments: true,
            layered_prompt_delivery: true,
            prompt_application_receipt: true,
            redacted_prompt_payload_preview: true,
            isolated_moment_diary_prompts: true,
            openai_single_system_message: true,
            shadow_push_user_trigger: true,
            voice_turn: true,
            voice_emotion_understanding: true,
            voice_audio_ephemeral: true,
            provider_model_catalog: true,
            per_turn_model_override: true,
            multipart_chat: true,
            private_chat_attachments: true,
            multimodal_images: true,
            attachment_documents: true,
            attachment_system_instruction: true,
            attachment_audio_hervoice: true,
            stream_status_events: true,
            model_wait_progress: true,
            interactive_generation_latency_profiles: true,
            public_reasoning_summary_stream: false,
            companion_progress_stream: false,
            provider_reasoning_summary_only: false,
            visible_inner_monologue_on_demand: true,
            visible_inner_monologue_storage: "device_only",
            kiwi_memory_budget: memoryBudgetEnabled(),
            memory_context_char_budget: DEFAULT_MEMORY_CHAR_BUDGET,
            memory_recall_extra_model_calls: 0,
            nursery_local_language: true,
            nursery_provider_calls_per_action: 0,
            nursery_embedding_calls_per_action: 0,
            nursery_dynamic_context_max_chars: 800,
            expressive_tts: true,
            expressive_tts_provider:
                expressiveSpeech.provider_configured
                    ? "minimax"
                    : "",
            expressive_tts_configured: expressiveSpeech.configured,
            expressive_tts_access_token_required: true,
            expressive_tts_response_cache: true,
            expressive_tts_provider_configured:
                expressiveSpeech.provider_configured,
            expressive_tts_api_key_configured:
                expressiveSpeech.api_key_configured,
            expressive_tts_voice_configured:
                expressiveSpeech.voice_configured,
            expressive_tts_emotion_supported:
                expressiveSpeech.emotion_supported,
            expressive_tts_device_fallback:
                expressiveSpeech.device_tts_fallback,
            hervoice_proxy_configured: Boolean(
                process.env.HERVOICE_URL && process.env.HERVOICE_SECRET
            ),
            ombre_mcp_client: true,
            ombre_mcp_configured: publicMcpConfig().configured,
            mcp_device_center: true,
            mcp_device_management_configured: hasCredentialEncryption(process.env),
            ai_provider_center: true,
            ai_provider_management_configured: aiProviderStatus.configured,
            ai_provider_center_available: aiProviderStatus.available,
            ai_provider_profiles: aiProviderStatus.profiles,
            ai_provider_enabled_profiles: aiProviderStatus.enabled_profiles,
            ai_provider_active_profile: aiProviderStatus.active_profile,
            provider_reasoning_effort: true,
            background_job_worker: true,
            background_jobs_enabled: backgroundJobsEnabled,
            background_job_reconciliation: true,
            proactive_daily_limit: true,
            background_job_local_loop: backgroundJobsEnabled,
            background_job_trigger_configured: Boolean(
                String(process.env.BACKGROUND_JOB_TRIGGER_SECRET || "").trim()
            )
        }
    });
});

app.get("/models", async (req, res, next) => {
    try {
        res.json(
            await listModels(
                await getSettings(req.scope?.db || supabase)
            )
        );
    } catch (error) {
        next(error);
    }
});
app.post("/api/push/trigger", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (authRequired) {
        return res.status(410).json({
            code: "legacy_background_trigger_retired",
            message: "主动消息任务已升级为逐用户后台任务。"
        });
    }

    const expectedSecret = String(process.env.PUSH_SECRET || "");
    if (!expectedSecret) {
        return res.status(503).json({
            pushed: false,
            reason: "push_secret_not_configured"
        });
    }

    const providedSecret = String(req.headers["x-push-secret"] || "");
    if (providedSecret !== expectedSecret) {
        return res.status(401).json({
            pushed: false,
            reason: "unauthorized"
        });
    }

    try {
        await processDueMoments();
        const result = await generateShadowPush();
        res.json({
            ...result,
            maintenance: {
                due_moments_checked: true,
                due_comments_checked: true
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/push/messages", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const sinceText = cleanText(req.query.since, 64);
        const since = new Date(sinceText);
        if (!sinceText || Number.isNaN(since.getTime())) {
            return res.status(400).json({
                message: "请提供正确的主动消息查询时间。"
            });
        }

        const limit = Math.round(toNumber(req.query.limit, 50, 1, 100));
        const { data, error } = await database
            .from("messages")
            .select("id, conversation_id, role, content, created_at, tool_calls")
            .eq("role", "assistant")
            .eq("visible", true)
            .contains("tool_calls", { is_push: true })
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) {
            throw error;
        }

        res.json({
            messages: (data || []).map((message) => ({
                id: message.id,
                conversation_id: message.conversation_id,
                role: message.role,
                content: message.content,
                created_at: message.created_at,
                is_push: true
            }))
        });
    } catch (error) {
        next(error);
    }
});

app.get("/database-test", async (req, res, next) => {
    try {
        const settings = await getSettings(req.scope?.db || supabase);
        res.json({
            connected: true,
            message: "Supabase 数据库连接成功",
            settings: {
                ai_name: settings.ai_name,
                provider: settings.provider,
                model: settings.model
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/sessions", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("conversations")
            .select("id, title, model_id, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ sessions: data ?? [] });
    } catch (error) {
        next(error);
    }
});

app.post("/sessions", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const title = cleanText(req.body.title, 60) || "新对话";
        const settings = await getSettings(database);
        const modelId = await resolveTurnModel(
            settings,
            cleanText(req.body.model_id || req.body.model, 160) ||
                settings.model
        );
        const { data, error } = await database
            .from("conversations")
            .insert({ title, model_id: modelId || null })
            .select("id, title, model_id, created_at, updated_at")
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.patch("/sessions/:id", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const hasTitle = Object.prototype.hasOwnProperty.call(
            req.body || {},
            "title"
        );
        const hasModel =
            Object.prototype.hasOwnProperty.call(req.body || {}, "model_id") ||
            Object.prototype.hasOwnProperty.call(req.body || {}, "model");
        if (!hasTitle && !hasModel) {
            return res.status(400).json({ message: "没有需要保存的会话设置。" });
        }

        const updates = {};
        if (hasTitle) {
            const title = cleanText(req.body.title, 60);
            if (!title) {
                return res.status(400).json({ message: "会话名称不能为空。" });
            }
            updates.title = title;
            updates.updated_at = new Date().toISOString();
        }
        if (hasModel) {
            const settings = await getSettings(database);
            updates.model_id = await resolveTurnModel(
                settings,
                cleanText(req.body.model_id || req.body.model, 160)
            );
        }
        const { data, error } = await database
            .from("conversations")
            .update(updates)
            .eq("id", req.params.id)
            .select("id, title, model_id, created_at, updated_at")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({ message: "找不到这个会话。" });
        }

        res.json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.delete("/sessions/:id", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data: attachmentMessages, error: attachmentQueryError } =
            await database
                .from("messages")
                .select("tool_calls")
                .eq("conversation_id", req.params.id);
        if (attachmentQueryError) throw attachmentQueryError;
        const attachmentPaths = storedAttachmentPathsForConversation(
            attachmentMessages,
            req.params.id
        );

        const { error } = await database
            .from("conversations")
            .delete()
            .eq("id", req.params.id);

        if (error) {
            throw error;
        }
        if (attachmentPaths.length > 0) {
            await removeStoredAttachments(
                supabase,
                attachmentPaths.map((storage_path) => ({ storage_path }))
            );
        }

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

app.get("/sessions/:id/messages", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data, error } = await database
            .from("messages")
            .select(
                "id, role, content, created_at, tool_calls, " +
                    "reply_to_message_id, reply_snapshot"
            )
            .eq("conversation_id", req.params.id)
            .eq("visible", true)
            .order("created_at", { ascending: true });

        if (error) {
            throw error;
        }

        res.json({ messages: (data ?? []).map(publicMessage) });
    } catch (error) {
        next(error);
    }
});

app.get("/attachments/:messageId/:attachmentId", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (
            !isSafeMessageId(req.params.messageId) ||
            !isUuid(req.params.attachmentId)
        ) {
            return res.status(400).json({ message: "附件编号格式不正确。" });
        }
        const { data: message, error } = await database
            .from("messages")
            .select("id, tool_calls")
            .eq("id", req.params.messageId)
            .maybeSingle();
        if (error) throw error;
        const attachment = findStoredAttachment(
            message?.tool_calls,
            req.params.attachmentId
        );
        if (!attachment) {
            return res.status(404).json({ message: "找不到这个附件。" });
        }

        const { data: blob, error: downloadError } = await supabase.storage
            .from("chat-attachments")
            .download(attachment.storage_path);
        if (downloadError) throw downloadError;
        const buffer = Buffer.from(await blob.arrayBuffer());
        const filename = cleanText(attachment.name, 180) || "attachment";
        const disposition = ["image", "text"].includes(attachment.kind)
            ? "inline"
            : "attachment";
        res.set({
            "Content-Type": attachment.mime_type || "application/octet-stream",
            "Content-Length": String(buffer.length),
            "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(
                filename
            )}`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff"
        });
        res.send(buffer);
    } catch (error) {
        next(error);
    }
});

app.get("/settings", async (req, res, next) => {
    try {
        const settings = await getSettings(req.scope?.db || supabase);
        res.json({ settings: publicRuntimeSettings(settings) });
    } catch (error) {
        next(error);
    }
});

app.put("/settings", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const stored = await getStoredSettings(database);
        const current = applyProviderSettingPins(
            stored,
            process.env,
            normalizeApiUrl
        );
        const has = (field) =>
            Object.prototype.hasOwnProperty.call(req.body, field);
        const requestedProviderSettings = {
            provider: has("provider")
                ? cleanText(req.body.provider, 50) || "custom"
                : current.provider,
            api_url: has("api_url")
                ? normalizeApiUrl(req.body.api_url)
                : current.api_url
        };
        const persistedProviderSettings = providerSettingsForPersistence({
            stored,
            effective: current,
            requested: requestedProviderSettings,
            production: isProductionDeployment(process.env)
        });
        const reasoningProtocol = reasoningProtocolForProvider(
            requestedProviderSettings.provider
        );
        const reasoningEffort = has("reasoning_effort")
            ? normalizeReasoningEffort(
                  req.body.reasoning_effort,
                  reasoningProtocol,
                  { strict: true }
              )
            : normalizeReasoningEffort(
                  current.reasoning_effort,
                  reasoningProtocol
              );
        const changes = {
            ai_name: has("ai_name")
                ? cleanText(req.body.ai_name, 50) || current.ai_name
                : current.ai_name,
            system_prompt: Object.prototype.hasOwnProperty.call(
                req.body,
                "system_prompt"
            )
                ? cleanText(req.body.system_prompt, 12000)
                : cleanText(current.system_prompt, 12000),
            additional_prompt: has("additional_prompt")
                ? cleanText(req.body.additional_prompt, 8000)
                : cleanText(current.additional_prompt, 8000),
            personality: has("personality")
                ? cleanText(req.body.personality, 1000)
                : cleanText(current.personality, 1000),
            prompt_mode: has("prompt_mode")
                ? normalizePromptMode(req.body.prompt_mode)
                : normalizePromptMode(current.prompt_mode),
            unified_system_prompt: has("unified_system_prompt")
                ? cleanUnifiedSystemPrompt(req.body.unified_system_prompt)
                : cleanUnifiedSystemPrompt(current.unified_system_prompt),
            user_details: has("user_details")
                ? cleanUserDetails(req.body.user_details)
                : cleanUserDetails(current.user_details),
            intimate_expression_enabled: has("intimate_expression_enabled")
                ? req.body.intimate_expression_enabled === true
                : current.intimate_expression_enabled === true,
            provider: persistedProviderSettings.provider,
            api_url: persistedProviderSettings.api_url,
            model: has("model")
                ? cleanText(req.body.model, 120)
                : current.model,
            reasoning_effort: reasoningEffort,
            temperature: toNumber(
                req.body.temperature,
                current.temperature,
                0,
                2
            ),
            context_turns: Math.round(
                toNumber(req.body.context_turns, current.context_turns, 1, 200)
            ),
            max_tokens: Math.round(
                toNumber(req.body.max_tokens, current.max_tokens, 64, 200000)
            ),
            compression_threshold: Math.round(
                toNumber(
                    req.body.compression_threshold,
                    current.compression_threshold ?? 12000,
                    1000,
                    200000
                )
            ),
            compression_keep: Math.round(
                toNumber(
                    req.body.compression_keep,
                    current.compression_keep ?? 20,
                    1,
                    200
                )
            ),
            timezone:
                cleanText(req.body.timezone, 80) ||
                current.timezone ||
                "Asia/Shanghai",
            push_enabled: has("push_enabled")
                ? req.body.push_enabled === true
                : current.push_enabled === true,
            max_push_per_day: Math.round(
                toNumber(
                    req.body.max_push_per_day,
                    current.max_push_per_day ?? 7,
                    0,
                    50
                )
            ),
            updated_at: new Date().toISOString()
        };

        assertPromptFieldsDoNotContainSecrets(changes);

        const { data, error } = await database
            .from("settings")
            .update(changes)
            .eq("id", current.id)
            .select("*")
            .single();

        if (error) {
            throw error;
        }

        res.json({
            settings: publicRuntimeSettings(
                applyProviderSettingPins(
                    data,
                    process.env,
                    normalizeApiUrl
                )
            )
        });
    } catch (error) {
        next(error);
    }
});

app.get("/memories", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("memories")
            .select("id, summary, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ memories: data ?? [] });
    } catch (error) {
        next(error);
    }
});

app.get("/diary", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("companion_diary_entries")
            .select(
                "id, title, content, mood, happened_on, source_message_ids, source_window_start, source_window_end, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(40);
        if (error) {
            if (isMissingRelationError(error)) {
                diaryStatus(
                    "migration_required",
                    "日记数据表尚未创建，需要执行数据库迁移。"
                );
                return res.json({
                    available: false,
                    entries: [],
                    generation: diaryGenerationStatus
                });
            }
            throw error;
        }

        if (!req.scope) void maybeGenerateDiaryEntry();
        res.json({
            available: true,
            entries: (data || []).map(toPublicDiaryEntry),
            generation: diaryGenerationStatus
        });
    } catch (error) {
        next(error);
    }
});

app.use("/moments", (req, res, next) => {
    if (!req.scope) {
        next();
        return;
    }
    res.status(410).json({
        code: "legacy_route_retired",
        message: "动态接口已升级，请刷新 App 后重试。"
    });
});

app.get("/moments", async (req, res, next) => {
    try {
        await processDueMoments();

        const { data: moments, error } = await supabase
            .from("moments")
            .select(PUBLIC_MOMENT_FIELDS)
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) {
            if (isMissingRelationError(error)) {
                return res.json({
                    available: false,
                    entries: [],
                    message: "朋友圈数据库还没有升级。"
                });
            }
            throw error;
        }

        const ids = (moments || []).map((item) => item.id);
        let comments = [];

        if (ids.length > 0) {
            const result = await supabase
                .from("moment_comments")
                .select(PUBLIC_MOMENT_COMMENT_FIELDS)
                .in("moment_id", ids)
                .order("created_at", { ascending: true });

            if (result.error) {
                throw result.error;
            }
            comments = result.data || [];
        }

        const entries = (moments || []).map((moment) => ({
            ...toPublicMoment(moment),
            comments: comments
                .filter((comment) => comment.moment_id === moment.id)
                .map(toPublicMomentComment)
        }));

        res.json({ available: true, entries });
    } catch (error) {
        next(error);
    }
});

app.post("/moments", async (req, res, next) => {
    let uploadedPaths = [];

    try {
        const content = cleanText(req.body.content, 2000);
        const incomingImages = normalizeMomentImages(req.body.images);
        if (!content && incomingImages.length === 0) {
            return res.status(400).json({ message: "动态文字和图片不能同时为空。" });
        }

        const uploadResult = await uploadMomentImages(incomingImages);
        uploadedPaths = uploadResult.paths;
        const sessionId = isUuid(req.body.session_id) ? req.body.session_id : null;
        const delaySeconds = randomDelaySeconds(45, 120);
        const replyDueAt = new Date(
            Date.now() + delaySeconds * 1000
        ).toISOString();

        const { data, error } = await supabase
            .from("moments")
            .insert({
                author: "user",
                content,
                context_note: sessionId ? `active_session_id:${sessionId}` : null,
                images: uploadResult.urls,
                reply_due_at: replyDueAt,
                reply_status: "pending"
            })
            .select(PUBLIC_MOMENT_FIELDS)
            .single();

        if (error) {
            if (uploadedPaths.length > 0) {
                await supabase.storage.from("moments").remove(uploadedPaths);
                uploadedPaths = [];
            }
            if (isMissingRelationError(error)) {
                return res.status(503).json({ message: "朋友圈数据库还没有升级。" });
            }
            throw error;
        }

        res.status(201).json({
            moment: { ...toPublicMoment(data), comments: [] }
        });
    } catch (error) {
        if (uploadedPaths.length > 0) {
            await supabase.storage.from("moments").remove(uploadedPaths);
        }
        next(error);
    }
});

app.post("/moments/:id/like", async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "动态编号格式不正确。" });
        }

        await requireAssistantMoment(req.params.id, "点赞");

        const { data, error } = await supabase
            .from("moments")
            .update({ user_liked: req.body.liked === true })
            .eq("id", req.params.id)
            .select(PUBLIC_MOMENT_FIELDS)
            .single();

        if (error) {
            throw error;
        }

        res.json({ moment: toPublicMoment(data) });
    } catch (error) {
        next(error);
    }
});

app.post("/moments/:id/comments", async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "动态编号格式不正确。" });
        }

        const content = cleanText(req.body.content, 1000);
        if (!content) {
            return res.status(400).json({ message: "评论内容不能为空。" });
        }

        await requireAssistantMoment(req.params.id, "评论");

        const delaySeconds = randomDelaySeconds(30, 90);
        const replyDueAt = new Date(
            Date.now() + delaySeconds * 1000
        ).toISOString();

        const { data, error } = await supabase
            .from("moment_comments")
            .insert({
                moment_id: req.params.id,
                author: "user",
                content,
                reply_due_at: replyDueAt,
                reply_status: "pending"
            })
            .select(PUBLIC_MOMENT_COMMENT_FIELDS)
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ comment: toPublicMomentComment(data) });
    } catch (error) {
        next(error);
    }
});

app.post("/companion/interact", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const result = await runCompanionInteraction({
            body: req.body,
            services: {
                ensureConversation: (conversationId, firstMessage) =>
                    ensureConversation(
                        conversationId,
                        firstMessage,
                        database
                    ),
                getSettings: () => getSettings(database),
                loadChatContext: (conversationId, settings) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        database
                    ),
                loadCompanionInteractionContext: (
                    conversationId,
                    settings
                ) =>
                    loadCompanionInteractionContext(
                        conversationId,
                        settings,
                        database
                    ),
                findCompanionInteractionReply: (
                    conversationId,
                    eventId
                ) =>
                    findCompanionInteractionReply(
                        conversationId,
                        eventId,
                        database
                    ),
                interactionGuard: companionInteractionGuard,
                resolveTurnModel,
                generateReply,
                saveMessage: (
                    conversationId,
                    role,
                    content,
                    options = {}
                ) =>
                    saveMessage(
                        conversationId,
                        role,
                        content,
                        { ...options, database }
                    ),
                touchConversation: (conversationId) =>
                    touchConversation(conversationId, database)
            }
        });
        res.json({
            ...result,
            assistant_message: publicAssistantMessage(
                result.assistant_message,
                result.conversation_id || result.session_id
            )
        });
    } catch (error) {
        if (error.retryAfterMs) {
            res.set(
                "Retry-After",
                String(Math.max(1, Math.ceil(error.retryAfterMs / 1000)))
            );
        }
        next(error);
    }
});

app.post("/companion/inner-monologue", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
        const database = req.scope?.db || supabase;
        const result = await runVisibleInnerMonologue({
            body: req.body,
            services: {
                loadMessage: (conversationId, messageId) =>
                    loadReferencedMessage({
                        conversationId,
                        messageId,
                        database
                    }),
                getSettings: () => getSettings(database),
                loadChatContext: (conversationId, settings) =>
                    loadChatContext(conversationId, settings, database),
                resolveTurnModel,
                generateReply
            }
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.post(
    "/voice/warmup",
    async (req, res) => {
        const result = hervoiceWarmup.start({
            baseUrl: process.env.HERVOICE_URL
        });
        res.status(202).json({
            ok: true,
            started: result.started,
            reason: result.reason
        });
    }
);

app.post(
    "/voice/turn",
    limitVoiceTurnsPerIp,
    voiceUpload.single("file"),
    async (req, res, next) => {
        res.set("Cache-Control", "no-store");

        try {
            const database = req.scope?.db || supabase;
            if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
                return res.status(400).json({ message: "请先录制一段语音。" });
            }

            const fields = parseVoiceTurnFields(req.body);
            let conversationId = null;
            if (fields.sessionId) {
                conversationId = await ensureConversation(
                    fields.sessionId,
                    "",
                    database
                );
            }

            const settings = await getSettings(database);
            const effectiveModel = await resolveTurnModel(
                settings,
                fields.requestedModel
            );
            const voiceAnalysis = await analyzeVoiceWithHervoice({
                file: req.file,
                baseUrl: process.env.HERVOICE_URL,
                secret: process.env.HERVOICE_SECRET,
                timeoutMs: process.env.HERVOICE_TIMEOUT_MS
            });
            if (!conversationId) {
                conversationId = await ensureConversation(
                    "",
                    voiceAnalysis.text,
                    database
                );
            }

            const effectiveSettings = {
                ...settings,
                model: effectiveModel,
                emotion_understanding_enabled:
                    fields.emotionUnderstandingEnabled
            };
            const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
                isContextTimestampCurrent(
                    fields.companionStatus?.updatedAt,
                    settings
                )
                    ? fields.companionStatus
                    : {},
                new Date(),
                { userDisplayName: req.scope?.profile?.display_name || "" }
            );
            const savedUserMessage = await saveMessage(
                conversationId,
                "user",
                voiceAnalysis.text,
                {
                    tool_calls: {
                        ...buildVoiceMessageMetadata(voiceAnalysis),
                        requested_model: fields.requestedModel || null,
                        resolved_model: effectiveModel || ""
                    },
                    database
                }
            );
            const context = await loadChatContext(
                conversationId,
                settings,
                database
            );
            const mcpRuntime = await mcpDeviceCenter
                .forDatabase(database)
                .createRuntime()
                .catch((error) => {
                    console.error(
                        "语音轮次 MCP 设备运行时加载失败：",
                        error?.code || error?.message || "unknown"
                    );
                    return {
                        tools: [],
                        actions: [],
                        runtimeContext: "",
                        hasTool: () => false,
                        execute: async () => ({
                            ok: false,
                            error: "设备中心暂时不可用。"
                        })
                    };
                });
            const chatTools = createChatToolExecutor(
                conversationId,
                initialCompanionStatus,
                "",
                mcpRuntime,
                database,
                req.scope?.profile?.display_name || ""
            );
            const runtimeContext = [
                runtimeContextFromValues(
                    {
                        environmentContext: fields.environmentContext
                    },
                    initialCompanionStatus,
                    req.scope?.profile?.display_name || ""
                ),
                buildVoiceRuntimeContext(
                    voiceAnalysis,
                    fields.emotionUnderstandingEnabled
                ),
                buildNurseryRuntimeContext(
                    context.nursery,
                    voiceAnalysis.text
                ),
                mcpRuntime.runtimeContext
            ]
                .filter(Boolean)
                .join("\n\n");
            const generated = await generateReply({
                settings: effectiveSettings,
                messages: context.messages,
                memories: context.memories,
                runtimeContext,
                turnContext: fields.turnContext,
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                tools: [
                    UPDATE_COMPANION_STATUS_TOOL,
                    POST_MOMENT_TOOL,
                    SELECT_COMPANION_STICKER_TOOL,
                    SELECT_REPLY_SUGGESTIONS_TOOL,
                    ...mcpRuntime.tools
                ],
                executeTool: chatTools.executeTool
            });
            const finalizedReplySuggestions = finalizeReplySuggestions({
                recentMessages: context.messages,
                assistantText: generated.text,
                candidate: chatTools.getReplySuggestions(),
                previousSuggestions: previousReplySuggestionsFromMessages(
                    context.messages
                )
            });
            const savedAssistantMessage = await saveMessage(
                conversationId,
                "assistant",
                generated.text,
                {
                    tool_calls: {
                        ...companionStickerToolCalls(chatTools.getStickerId()),
                        ...replySuggestionToolCalls(finalizedReplySuggestions),
                        ...(mcpRuntime.actions.length
                            ? { mcp_actions: mcpRuntime.actions }
                            : {})
                    },
                    database
                }
            );

            await touchConversation(conversationId, database);
            await tryScheduleProactiveMessageEvaluation({
                database,
                settings,
                sourceMessageId: savedAssistantMessage.id
            });
            await tryScheduleAutonomousContentEvaluations({
                database,
                sourceMessageId: savedAssistantMessage.id
            });
            const memoryCompression = await tryCompressMemory(
                conversationId,
                settings,
                database
            );

            res.json({
                reply: generated.text,
                session_id: conversationId,
                conversation_id: conversationId,
                user_message: publicMessage(savedUserMessage),
                assistant_message: publicAssistantMessage(
                    savedAssistantMessage,
                    conversationId
                ),
                model: effectiveModel || "",
                provider: settings.provider,
                response_mode: generated.mode,
                voice_analysis: voiceAnalysis,
                prompt_receipt: generated.prompt_receipt || null,
                memory_compression: memoryCompression,
                companion_status: chatTools.getCompanionStatus()
            });
        } catch (error) {
            next(error);
        }
    }
);

app.post("/voice/speech", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const messageId = cleanText(req.body?.message_id, 80);
        const conversationId = cleanText(
            req.body?.session_id || req.body?.conversation_id,
            80
        );
        const speechToken = cleanText(req.body?.speech_token, 160);
        if (
            !isSafeSpeechMessageId(messageId) ||
            !isSafeConversationId(conversationId) ||
            !verifySpeechAccessToken(
                messageId,
                conversationId,
                speechToken,
                process.env
            )
        ) {
            return res.status(404).json({
                message: "找不到这条可朗读的 AI 回复。"
            });
        }

        const { data: message, error } = await database
            .from("messages")
            .select("id, role, content, tool_calls")
            .eq("id", messageId)
            .eq("conversation_id", conversationId)
            .eq("role", "assistant")
            .eq("visible", true)
            .maybeSingle();
        if (error) throw error;
        if (!message) {
            return res.status(404).json({ message: "找不到这条可朗读的 AI 回复。" });
        }

        const limit = expressiveSpeechRateLimitState.consume(req.ip);
        if (!limit.allowed) {
            res.set(
                "Retry-After",
                String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000)))
            );
            return res.status(429).json({
                message: "自然语音请求太频繁，请稍等一会儿再试。"
            });
        }

        const { speech, cacheStatus } =
            await expressiveSpeechCache.getOrCreate(
                messageId,
                () =>
                    synthesizeExpressiveSpeech({
                        text: message.content,
                        emotionHint:
                            message.tool_calls?.speech_emotion,
                        env: process.env
                    })
            );
        res.set({
            "Content-Type": speech.contentType,
            "Content-Length": String(speech.audio.length),
            "X-DengTa-Voice-Provider": speech.provider,
            "X-DengTa-Voice-Emotion": speech.emotion,
            "X-DengTa-Voice-Cache": cacheStatus,
            "X-Content-Type-Options": "nosniff"
        });
        res.send(speech.audio);
    } catch (error) {
        next(error);
    }
});

app.post("/chat", acceptChatBody, async (req, res, next) => {
    try {
        res.json(await executeChatTurn(req));
    } catch (error) {
        next(error);
    }
});

app.post("/chat/stream", acceptChatBody, async (req, res, next) => {
    let streamStarted = false;
    let userMessageCommitted = false;
    try {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
        streamStarted = true;
        const result = await executeChatTurn(req, {
            onStatus: (event) => {
                if (event?.type === "meta" && event.user_message) {
                    userMessageCommitted = true;
                }
                writeSse(res, event);
            },
            onModelEvent: (event) => {
                if (["text", "reasoning"].includes(event?.type)) {
                    writeSse(res, event);
                }
            }
        });
        writeSse(res, streamSuccess(result));
        res.end();
    } catch (error) {
        if (!streamStarted) return next(error);
        console.error("stream_chat_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            upstream_response_status:
                String(error?.upstreamResponseStatus || "").slice(0, 40) ||
                null,
            upstream_incomplete_reason:
                String(error?.upstreamIncompleteReason || "").slice(0, 80) ||
                null,
            upstream_output_types: Array.isArray(error?.upstreamOutputTypes)
                ? error.upstreamOutputTypes.slice(0, 12)
                : [],
            user_message_committed: userMessageCommitted
        });
        writeSse(res, streamFailure(error, { userMessageCommitted }));
        res.end();
    }
});

app.use((error, req, res, next) => {
    const isChatRequest = ["/chat", "/chat/stream"].includes(req.path);
    if (isChatRequest) {
        console.error("chat_request_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            method: req.method,
            path: req.path
        });
    } else {
        console.error("请求失败：", error);
    }

    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof multer.MulterError) {
        const voiceRequest = req.path === "/voice/turn";
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                message: voiceRequest
                    ? "语音文件不能超过 12MB。"
                    : "单个附件不能超过 12MB。"
            });
        }
        if (["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error.code)) {
            return res.status(413).json({
                message: voiceRequest
                    ? "一次只能发送一个语音文件。"
                    : "一次最多发送 4 个附件。"
            });
        }
        return res.status(400).json({
            message: voiceRequest
                ? "语音上传格式不正确，请重新录制后再试。"
                : "附件上传格式不正确，请重新选择后再试。"
        });
    }

    const status = Number(error.status) || 500;
    const clientErrorCode =
        status >= 400 &&
        status < 500 &&
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
            ? error.code
            : null;
    const publicErrorCode =
        publicChatErrorCode(error) || clientErrorCode;
    res.status(error.status || 500).json({
        message: isChatRequest
            ? publicChatErrorMessage(error, "服务器处理请求失败，请稍后重试。")
            : error.status
              ? error.message
              : "服务器处理请求失败。",
        detail:
            process.env.NODE_ENV === "production" || isChatRequest
                ? undefined
                : error.message,
        ...(publicErrorCode ? { code: publicErrorCode } : {})
    });
});

let momentMaintenanceTimer = null;
let diaryMaintenanceTimer = null;
if (!authRequired) {
    momentMaintenanceTimer = setInterval(() => {
        void processDueMoments();
    }, 20 * 1000);
    momentMaintenanceTimer.unref?.();

    diaryMaintenanceTimer = setInterval(() => {
        void maybeGenerateDiaryEntry();
    }, 60 * 1000);
    diaryMaintenanceTimer.unref?.();
}

app.listen(port, () => {
    if (!authRequired) {
        void processDueMoments();
        void maybeGenerateDiaryEntry();
    }
    console.log(`服务器运行在 http://localhost:${port}`);
});
