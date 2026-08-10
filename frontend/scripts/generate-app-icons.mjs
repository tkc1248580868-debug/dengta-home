import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "..",
);
const source = await readFile(
  path.join(repositoryRoot, "public", "app-icon.svg"),
);

async function renderIcon(relativePath, size) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(repositoryRoot, relativePath));
}

await renderIcon("public/app-icon-192.png", 192);
await renderIcon("public/app-icon-512.png", 512);
await renderIcon("public/apple-touch-icon.png", 180);

const densities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, size] of Object.entries(densities)) {
  const base = path.join(
    repositoryRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    `mipmap-${density}`,
  );
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(base, "ic_launcher.png"));
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(base, "ic_launcher_round.png"));

  const adaptiveSize = Math.round(size * 2.25);
  await sharp(source)
    .resize(adaptiveSize, adaptiveSize)
    .png()
    .toFile(path.join(base, "ic_launcher_foreground.png"));
  await sharp({
    create: {
      width: adaptiveSize,
      height: adaptiveSize,
      channels: 4,
      background: "#ffffff",
    },
  })
    .png()
    .toFile(path.join(base, "ic_launcher_background.png"));
}

console.log("DengTa icon assets generated from public/app-icon.svg");
