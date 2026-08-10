import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = mkdtempSync(join(tmpdir(), "dengta-bundle-budget-"));

try {
  execFileSync(
    process.execPath,
    [
      resolve(projectRoot, "node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      outputDirectory,
      "--emptyOutDir",
      "--manifest",
    ],
    { cwd: projectRoot, stdio: "pipe" },
  );

  const manifest = JSON.parse(
    readFileSync(join(outputDirectory, ".vite", "manifest.json"), "utf8"),
  );
  const entryKeys = Object.keys(manifest).filter((key) => manifest[key]?.isEntry);
  assert.equal(entryKeys.length, 1, "the build must expose one measurable entry");

  const initialFiles = new Set();
  const visitedKeys = new Set();
  function collectStaticImports(key) {
    if (visitedKeys.has(key)) return;
    visitedKeys.add(key);
    const chunk = manifest[key];
    assert.ok(chunk, `manifest import ${key} must exist`);
    if (chunk.file?.endsWith(".js")) initialFiles.add(chunk.file);
    for (const dependencyKey of chunk.imports || []) {
      collectStaticImports(dependencyKey);
    }
  }
  collectStaticImports(entryKeys[0]);

  const measurements = [...initialFiles].map((file) => {
    const filePath = join(outputDirectory, file);
    const rawBytes = statSync(filePath).size;
    return {
      file,
      rawBytes,
      gzipBytes: gzipSync(readFileSync(filePath), { level: 9 }).length,
    };
  });
  const rawBytes = measurements.reduce((total, item) => total + item.rawBytes, 0);
  const gzipBytes = measurements.reduce(
    (total, item) => total + item.gzipBytes,
    0,
  );
  const largestChunk = measurements.reduce(
    (largest, item) => (item.rawBytes > largest.rawBytes ? item : largest),
    { file: "", rawBytes: 0 },
  );

  assert.ok(
    rawBytes <= 600_000 &&
      gzipBytes <= 190_000 &&
      largestChunk.rawBytes <= 400_000,
    `initial JavaScript is ${rawBytes} raw bytes and ${gzipBytes} gzip bytes; largest chunk ${largestChunk.file} is ${largestChunk.rawBytes} bytes`,
  );

  console.log(
    `initial bundle budget passed (${rawBytes} raw bytes, ${gzipBytes} gzip bytes, ${measurements.length} static chunks)`,
  );
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
