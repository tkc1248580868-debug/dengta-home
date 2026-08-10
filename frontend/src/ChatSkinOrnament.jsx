export default function ChatSkinOrnament({ role, mood = "" }) {
  const isUser = role === "user";
  const label = isUser ? "我的小猫挂件" : "伴侣的大熊挂件";
  const moodClass = String(mood || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "")
    .slice(0, 16);

  return (
    <span
      className={`chat-skin-ornament ${isUser ? "is-cat" : "is-bear"}${
        moodClass ? ` mood-${moodClass}` : ""
      }`}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 76 58" aria-hidden="true" focusable="false">
        {isUser ? (
          <>
            <path className="ornament-body" d="M16 37c2-12 10-19 23-19s21 7 22 19" />
            <path className="ornament-line" d="M20 21 14 8l13 6M57 21l6-13-13 6" />
            <circle className="ornament-face" cx="39" cy="29" r="18" />
            <circle className="ornament-eye" cx="32" cy="29" r="1.8" />
            <circle className="ornament-eye" cx="46" cy="29" r="1.8" />
            <path className="ornament-line" d="M37 35q2 2 4 0M38 32h2" />
            <path className="ornament-line" d="M18 39q-6 6-11 2" />
          </>
        ) : (
          <>
            <circle className="ornament-ear" cx="24" cy="14" r="8" />
            <circle className="ornament-ear" cx="54" cy="14" r="8" />
            <path className="ornament-body" d="M18 49c1-13 8-21 21-21s20 8 21 21" />
            <circle className="ornament-face" cx="39" cy="29" r="19" />
            <circle className="ornament-eye" cx="31" cy="28" r="2" />
            <circle className="ornament-eye" cx="47" cy="28" r="2" />
            <ellipse className="ornament-muzzle" cx="39" cy="36" rx="8" ry="6" />
            <path className="ornament-line" d="M38 33h2M36 37q3 4 6 0M25 49q4-5 8 0M45 49q4-5 8 0" />
          </>
        )}
      </svg>
    </span>
  );
}
