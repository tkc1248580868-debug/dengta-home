import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  formatAttachmentSize,
  normalizeMessageAttachments,
} from "./chat-attachments";
import {
  personalizedThinkingStatus,
  thinkingPanelCompleted,
  thinkingPanelVisible,
} from "./chat-thinking";
import { usePrivateMediaSource } from "./use-private-media";

function attachmentIcon(kind) {
  if (kind === "image") return "图";
  if (kind === "audio") return "声";
  if (kind === "video") return "影";
  return "文";
}

export function SelectedAttachmentStrip({ items, onRemove }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="selected-attachment-strip" aria-label="待发送附件">
      {items.map((item) => (
        <div className="selected-attachment" key={item.id}>
          {(item.kind === "image" || item.kind === "video") &&
          item.previewUrl ? (
            <img src={item.previewUrl} alt="" />
          ) : (
            <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
              {attachmentIcon(item.kind)}
            </span>
          )}
          <span className="attachment-copy">
            <strong title={item.name}>{item.name}</strong>
            <small>{formatAttachmentSize(item.size)}</small>
          </span>
          <button
            type="button"
            aria-label={`移除附件 ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function AuthenticatedAttachment({ item, onPreview }) {
  const media = usePrivateMediaSource(item.url);
  if (media.loading) {
    return (
      <div className="message-file-attachment is-loading" role="status">
        <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
          {attachmentIcon(item.kind)}
        </span>
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>正在安全读取</small>
        </span>
      </div>
    );
  }
  if (!media.url) {
    return (
      <div
        className="message-file-attachment is-error"
        role="status"
        title={media.error}
      >
        <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
          {attachmentIcon(item.kind)}
        </span>
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>暂时无法读取</small>
        </span>
      </div>
    );
  }

  if (item.kind === "image") {
    return (
      <button
        type="button"
        className="message-image-attachment"
        onClick={() => onPreview?.(media.url, item.name)}
      >
        <img src={media.url} alt={item.name} loading="lazy" />
        <span>{item.name}</span>
      </button>
    );
  }
  if (item.kind === "audio") {
    return (
      <div className="message-audio-attachment">
        <div className="message-audio-heading">
          <span className="attachment-kind audio" aria-hidden="true">
            {attachmentIcon(item.kind)}
          </span>
          <span className="attachment-copy">
            <strong>{item.name}</strong>
            <small>{formatAttachmentSize(item.size)}</small>
          </span>
        </div>
        <audio
          controls
          preload="metadata"
          src={media.url}
          aria-label={`播放语音 ${item.name}`}
        />
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <div className="message-video-attachment">
        <video
          controls
          preload="metadata"
          src={media.url}
          aria-label={`播放视频 ${item.name}`}
        />
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>{formatAttachmentSize(item.size)}</small>
        </span>
      </div>
    );
  }
  return (
    <a
      className="message-file-attachment"
      href={media.url}
      download={item.name}
    >
      <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
        {attachmentIcon(item.kind)}
      </span>
      <span className="attachment-copy">
        <strong>{item.name}</strong>
        <small>{formatAttachmentSize(item.size)}</small>
      </span>
    </a>
  );
}

export function MessageAttachments({ value, apiBaseUrl, onPreview }) {
  const items = normalizeMessageAttachments(value, apiBaseUrl);
  if (items.length === 0) return null;

  return (
    <div className="message-attachments" aria-label="消息附件">
      {items.map((item) => (
        <AuthenticatedAttachment
          item={item}
          onPreview={onPreview}
          key={item.id}
        />
      ))}
    </div>
  );
}

export function ThinkingPanel({
  message,
  aiName = "伴侣",
  companionMood = "",
  innerMonologue = null,
  innerMonologuePending = false,
  innerMonologueError = "",
  onRequestInnerMonologue,
}) {
  const completed = thinkingPanelCompleted(message);
  const canRequestInnerMonologue =
    completed &&
    typeof onRequestInnerMonologue === "function";
  const visible =
    !completed ||
    thinkingPanelVisible(message) ||
    Boolean(innerMonologue?.text) ||
    canRequestInnerMonologue;
  const [open, setOpen] = useState(!completed);
  const [monologueDialogOpen, setMonologueDialogOpen] = useState(false);

  useEffect(() => {
    if (!monologueDialogOpen) return undefined;
    const closeFromEscape = (event) => {
      if (event.key === "Escape") setMonologueDialogOpen(false);
    };
    document.addEventListener("keydown", closeFromEscape);
    return () => document.removeEventListener("keydown", closeFromEscape);
  }, [monologueDialogOpen]);

  if (!visible) return null;

  const statuses = Array.isArray(message.thinkingStatuses)
    ? message.thinkingStatuses
    : [];
  const displayName = String(aiName || "").trim() || "伴侣";
  const mood = String(companionMood || "").trim();
  const monologueText = String(innerMonologue?.text || "").trim();

  const requestMonologue = () => {
    setOpen(true);
    setMonologueDialogOpen(true);
    onRequestInnerMonologue?.(message);
  };

  return (
    <>
      <details
        className="thinking-panel"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
      <summary>
        <span>{completed ? `${displayName}的心声` : `${displayName}正在回应你`}</span>
        <small>
          {completed
            ? monologueText
              ? "仅保存在这台设备"
              : "按需生成，不进入聊天记忆"
            : "正在处理这条消息"}
        </small>
      </summary>
      <div className="thinking-panel-body">
        <div className="thinking-context-chip">
          <strong>{displayName}</strong>
          {mood && <span>此刻：{mood}</span>}
        </div>
        {!completed && statuses.length > 0 && (
          <ol>
            {statuses.map((status, index) => {
              const active = !completed && index === statuses.length - 1;
              return (
                <li
                  className={active ? "is-active" : "is-complete"}
                  aria-current={active ? "step" : undefined}
                  key={`${status}-${index}`}
                >
                  <span className="thinking-step-marker" aria-hidden="true">
                    {active ? "·" : "✓"}
                  </span>
                  <span>
                    {personalizedThinkingStatus(status, {
                      aiName: displayName,
                      companionMood: mood,
                    })}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {completed && monologueText ? (
          <div className="inner-monologue-result">
            <p className="thinking-summary-text inner-monologue-text">
              {monologueText}
            </p>
            <button type="button" onClick={() => setMonologueDialogOpen(true)}>
              打开这次心声
            </button>
          </div>
        ) : completed ? (
          <div className="inner-monologue-request">
            <button
              type="button"
              disabled={innerMonologuePending}
              onClick={requestMonologue}
            >
              {innerMonologuePending ? "正在写下此刻的心声…" : "听听她此刻的心声"}
            </button>
            {innerMonologueError && (
              <small className="inner-monologue-error">{innerMonologueError}</small>
            )}
          </div>
        ) : (
          <p className="thinking-availability-note">
            回复完成后可以按需生成这一次的可见心声。
          </p>
        )}
        </div>
      </details>

      {monologueDialogOpen && (
        <div
          className="inner-monologue-dialog-backdrop"
          role="presentation"
          onClick={() => setMonologueDialogOpen(false)}
        >
          <section
            className="inner-monologue-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${displayName}此刻的心声`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>
                <small>{displayName}此刻的心声</small>
                <strong>{mood || "静静想着你"}</strong>
              </span>
              <button
                type="button"
                aria-label="关闭心声"
                onClick={() => setMonologueDialogOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="inner-monologue-dialog-body">
              {innerMonologuePending ? (
                <div className="inner-monologue-dialog-pending" role="status">
                  <span aria-hidden="true" />
                  <p>她正在把没有说出口的念头慢慢写下来…</p>
                </div>
              ) : monologueText ? (
                <p>{monologueText}</p>
              ) : innerMonologueError ? (
                <div className="inner-monologue-dialog-error" role="alert">
                  <p>{innerMonologueError}</p>
                  <button type="button" onClick={requestMonologue}>
                    再试一次
                  </button>
                </div>
              ) : (
                <p>这一次暂时没有收到可显示的心声。</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
