import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STICKER_CATALOG,
  findStickersByMood,
  getStickerById,
  isStickerId,
} from "../src/sticker-catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const chatMessage = fs.readFileSync(
  path.join(root, "src", "ChatMessage.jsx"),
  "utf8",
);

assert.equal(STICKER_CATALOG.length, 6);
assert.equal(isStickerId("bear-hug"), true);
assert.equal(isStickerId("../private-key"), false);
assert.equal(getStickerById("https://example.com/sticker"), null);
assert.equal(findStickersByMood(["hug"])[0].id, "bear-hug");
assert.match(chatMessage, /tool_calls\?\.sticker_id/);
assert.match(chatMessage, /message-sticker/);

for (const sticker of STICKER_CATALOG) {
  assert.match(sticker.assetPath, /^\/assets\/stickers\/bear-[a-z-]+\.jpg$/);
  const localAsset = path.join(
    root,
    "public",
    ...sticker.assetPath.split("/").filter(Boolean),
  );
  assert.equal(
    fs.existsSync(localAsset),
    true,
    `${sticker.id} must ship with the app`,
  );
}

console.log("trusted companion sticker tests passed");
