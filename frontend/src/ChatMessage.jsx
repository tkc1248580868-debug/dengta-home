import { memo, useCallback, useEffect, useRef } from "react";
import DeviceActionReceipts from "./DeviceActionReceipts";
import { MessageAttachments, ThinkingPanel } from "./ChatMessageExtras";
import { AuthenticatedImage } from "./PrivateMedia";
import {
  longPressMovementExceeded,
  messageCanBeReferenced,
  messageReferenceFromMessage,
} from "./message-reference";
import { getStickerById } from "./sticker-catalog";
import { formatVoiceConfidence } from "./voice";
import ChatSkinOrnament from "./ChatSkinOrnament";

function formatMessageTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ChatMessage({
  item,
  aiName = "伴侣",
  userName = "你",
  companionMood = "",
  skin = "classic-glass",
  skinPresentation = null,
  apiBaseUrl,
  onPreview,
  onReference,
  onDismissError,
  innerMonologue,
  innerMonologuePending = false,
  innerMonologueError = "",
  onRequestInnerMonologue,
}) {
  const isUser = item.role === "user";
  const displayName = isUser ? userName : aiName;
  const quotedMessage = messageReferenceFromMessage(item);
  const canReference =
    item.chatError !== true &&
    typeof onReference === "function" &&
    messageCanBeReferenced(item);
  const longPressRef = useRef(null);
  const sticker = !isUser
    ? getStickerById(item.tool_calls?.sticker_id)
    : null;
  const artworkId = !isUser
    ? String(item.tool_calls?.artwork_id || "")
    : "";
  const artworkAlt =
    item.tool_calls?.artwork_alt || `${aiName}创作的图片`;

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current?.timerId) {
      window.clearTimeout(longPressRef.current.timerId);
    }
    longPressRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function beginLongPress(event) {
    if (
      !canReference ||
      (event.button !== undefined && event.button !== 0) ||
      event.target?.closest?.("button, a, input, textarea, select")
    ) {
      return;
    }
    cancelLongPress();
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false,
      timerId: null,
    };
    gesture.timerId = window.setTimeout(() => {
      if (longPressRef.current !== gesture) return;
      gesture.triggered = true;
      onReference(item);
      globalThis.navigator?.vibrate?.(8);
    }, 520);
    longPressRef.current = gesture;
  }

  function moveLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      longPressMovementExceeded(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
      )
    ) {
      cancelLongPress();
    }
  }

  function endLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.triggered) event.preventDefault();
    cancelLongPress();
  }

  function preventTriggeredContextMenu(event) {
    if (longPressRef.current?.triggered) event.preventDefault();
  }

  const quotedDisplayName =
    quotedMessage?.role === "user" ? userName : aiName;

  return (
    <article
      className={`message-row ${isUser ? "user" : "assistant"}${
        canReference ? " can-reference" : ""
      }${skin === "taotao-cream" ? " chat-skin-cream-message" : ""}${
        skinPresentation?.groupStart ? " group-start" : ""
      }${skinPresentation?.groupEnd ? " group-end" : ""}${
        item.chatError === true ? " chat-error-message" : ""
      }`}
      onPointerDown={beginLongPress}
      onPointerMove={moveLongPress}
      onPointerUp={endLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={preventTriggeredContextMenu}
    >
      <span
        className={`message-avatar message-avatar-letter ${
          isUser ? "is-user" : "is-assistant"
        }`}
        role="img"
        aria-label={`${displayName}的标记`}
      >
        {isUser ? "桃" : "D"}
      </span>
      <div className="message-column">
        <div className="message-role">{displayName}</div>
        <div className="message-bubble">
          {skin === "taotao-cream" && skinPresentation?.showOrnament && (
            <ChatSkinOrnament
              role={item.role}
              mood={companionMood}
            />
          )}
          {quotedMessage && (
            <div className="message-reference-block">
              <strong>引用 {quotedDisplayName}</strong>
              <span>
                {quotedMessage.text ||
                  `${quotedMessage.attachment_summary?.count || 0} 个附件`}
                {quotedMessage.text_truncated ? "…" : ""}
              </span>
            </div>
          )}
          {item.content && (
            <div className="message-content">{item.content}</div>
          )}
          {sticker && (
            <button
              type="button"
              className="message-sticker"
              aria-label={`查看表情：${sticker.alt}`}
              onClick={() => onPreview?.(sticker.assetPath, sticker.alt)}
            >
              <img src={sticker.assetPath} alt={sticker.alt} loading="lazy" />
            </button>
          )}
          {artworkId && (
            <div className="message-artwork">
              {item.tool_calls?.is_surprise_reveal === true && (
                <span className="message-artwork-reveal">
                  悄悄准备的惊喜，现在揭晓
                </span>
              )}
              <AuthenticatedImage
                src={`/api/v2/creative/artworks/${encodeURIComponent(
                  artworkId,
                )}/image`}
                alt={artworkAlt}
                className="message-artwork-image"
                buttonClassName="message-artwork-preview"
                onPreview={onPreview}
              />
            </div>
          )}
          <MessageAttachments
            value={item.attachments || item.files}
            apiBaseUrl={apiBaseUrl}
            onPreview={onPreview}
          />
          {isUser &&
            item.tool_calls?.attachment_instruction_mode === "system" && (
              <div className="attachment-instruction-badge">
                本轮附件已作为系统指令
              </div>
            )}
          {!isUser && (
            <>
              <ThinkingPanel
                message={item}
                aiName={aiName}
                companionMood={companionMood}
                innerMonologue={innerMonologue}
                innerMonologuePending={innerMonologuePending}
                innerMonologueError={innerMonologueError}
                onRequestInnerMonologue={onRequestInnerMonologue}
              />
              <DeviceActionReceipts actions={item.tool_calls?.mcp_actions} />
            </>
          )}
          {item.voiceAnalysis && (
            <div className="voice-message-meta">
              <span>语音转写</span>
              <strong>
                {item.voiceAnalysis.emotion} ·{" "}
                {formatVoiceConfidence(item.voiceAnalysis.confidence)}
              </strong>
            </div>
          )}
          {item.isStreaming && (
            <span className="stream-caret" aria-label="正在回复">
              ♥
            </span>
          )}
          <div className="message-footer">
            {item.chatError === true &&
              typeof onDismissError === "function" && (
                <button
                  type="button"
                  className="message-error-dismiss"
                  aria-label="关闭这条错误提示"
                  title="关闭错误提示"
                  onClick={() => onDismissError(item.id)}
                >
                  ×
                </button>
              )}
            {canReference && (
              <button
                type="button"
                className="message-reference-button"
                aria-label={`引用${displayName}的这条消息`}
                onClick={() => onReference(item)}
              >
                引用
              </button>
            )}
            <time>
              {item.formattedTime || formatMessageTime(item.created_at)}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}

export default memo(ChatMessage);
