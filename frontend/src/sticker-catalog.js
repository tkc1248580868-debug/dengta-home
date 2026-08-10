const STICKERS = [
  {
    id: "bear-sleepy",
    assetPath: "/assets/stickers/bear-sleepy.jpg",
    alt: "伴侣大熊抱着枕头打瞌睡",
    moodTags: ["sleepy", "tired", "quiet", "night"],
  },
  {
    id: "bear-hug",
    assetPath: "/assets/stickers/bear-hug.jpg",
    alt: "伴侣大熊张开手臂想抱抱你",
    moodTags: ["hug", "comfort", "warm", "love"],
  },
  {
    id: "bear-miss-you",
    assetPath: "/assets/stickers/bear-miss-you.jpg",
    alt: "伴侣大熊托着脸想念你",
    moodTags: ["miss", "longing", "love", "quiet"],
  },
  {
    id: "bear-cheer",
    assetPath: "/assets/stickers/bear-cheer.jpg",
    alt: "伴侣大熊挥着小旗为你加油",
    moodTags: ["cheer", "happy", "support", "energy"],
  },
  {
    id: "bear-shy",
    assetPath: "/assets/stickers/bear-shy.jpg",
    alt: "伴侣大熊捂着脸害羞",
    moodTags: ["shy", "blush", "love", "cute"],
  },
  {
    id: "bear-goodnight",
    assetPath: "/assets/stickers/bear-goodnight.jpg",
    alt: "伴侣大熊盖好被子向你说晚安",
    moodTags: ["goodnight", "sleepy", "night", "care"],
  },
];

export const STICKER_CATALOG = Object.freeze(
  STICKERS.map((sticker) =>
    Object.freeze({
      ...sticker,
      moodTags: Object.freeze([...sticker.moodTags]),
    }),
  ),
);

const STICKER_BY_ID = new Map(
  STICKER_CATALOG.map((sticker) => [sticker.id, sticker]),
);
const SAFE_TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

function normalizeMoodTags(value) {
  const source = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      source
        .map((tag) => String(tag || "").trim().toLowerCase())
        .filter((tag) => SAFE_TAG_PATTERN.test(tag)),
    ),
  ].slice(0, 8);
}

export function isStickerId(value) {
  return typeof value === "string" && STICKER_BY_ID.has(value);
}

export function getStickerById(value) {
  if (!isStickerId(value)) return null;
  return STICKER_BY_ID.get(value);
}

export function getStickerAssetPath(value) {
  return getStickerById(value)?.assetPath || null;
}

export function findStickersByMood(value, { limit = 3 } = {}) {
  const tags = normalizeMoodTags(value);
  if (tags.length === 0) return [];

  const safeLimit = Math.min(6, Math.max(1, Number.parseInt(limit, 10) || 3));
  return STICKER_CATALOG.map((sticker, index) => ({
    sticker,
    index,
    score: tags.reduce(
      (total, tag) => total + (sticker.moodTags.includes(tag) ? 1 : 0),
      0,
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, safeLimit)
    .map((entry) => entry.sticker);
}

export function selectStickerByMood(value) {
  return findStickersByMood(value, { limit: 1 })[0] || null;
}
