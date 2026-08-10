import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function findNextBoundary(source, start) {
  let quote = "";
  let escaped = false;
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && (character === "{" || character === ";")) {
      return { character, index };
    }
  }

  return null;
}

function findBlockEnd(source, openIndex) {
  let depth = 1;
  let quote = "";
  let escaped = false;

  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return index;
  }

  throw new Error("Unclosed CSS block");
}

function mediaFeatureMatches(feature, viewport) {
  const normalized = compact(feature).toLowerCase();
  if (normalized === "all" || normalized === "screen") return true;

  const dimension = normalized.match(
    /^\((min|max)-(width|height):\s*([0-9.]+)px\)$/,
  );
  if (dimension) {
    const [, boundary, axis, rawLimit] = dimension;
    const actual = axis === "width" ? viewport.width : viewport.height;
    const limit = Number(rawLimit);
    return boundary === "min" ? actual >= limit : actual <= limit;
  }

  const orientation = normalized.match(
    /^\(orientation:\s*(portrait|landscape)\)$/,
  );
  if (orientation) {
    const actual =
      viewport.width > viewport.height ? "landscape" : "portrait";
    return actual === orientation[1];
  }

  if (normalized === "(prefers-reduced-motion: reduce)") {
    return viewport.reducedMotion === true;
  }
  if (normalized === "(prefers-reduced-motion: no-preference)") {
    return viewport.reducedMotion !== true;
  }
  return false;
}

function mediaMatches(query, viewport) {
  return splitTopLevel(query, ",").some((alternative) => {
    const features = alternative
      .replace(/^\s*only\s+/i, "")
      .split(/\s+and\s+/i)
      .map((feature) => feature.trim())
      .filter(Boolean);
    return features.every((feature) => mediaFeatureMatches(feature, viewport));
  });
}

function parseDeclarations(body) {
  const declarations = [];
  for (const rawDeclaration of splitTopLevel(body, ";")) {
    const colonIndex = rawDeclaration.indexOf(":");
    if (colonIndex < 1) continue;
    const property = compact(rawDeclaration.slice(0, colonIndex)).toLowerCase();
    let value = compact(rawDeclaration.slice(colonIndex + 1));
    const important = /\s*!important$/i.test(value);
    value = value.replace(/\s*!important$/i, "").trim();
    if (property) declarations.push({ important, property, value });
  }
  return declarations;
}

function collectRules(source, viewport, rules, stylesheet) {
  let cursor = 0;

  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (cursor >= source.length) break;

    const boundary = findNextBoundary(source, cursor);
    if (!boundary) break;
    const prelude = compact(source.slice(cursor, boundary.index));
    if (boundary.character === ";") {
      cursor = boundary.index + 1;
      continue;
    }

    const closeIndex = findBlockEnd(source, boundary.index);
    const body = source.slice(boundary.index + 1, closeIndex);
    cursor = closeIndex + 1;

    if (/^@media\b/i.test(prelude)) {
      const query = prelude.replace(/^@media\b/i, "").trim();
      if (mediaMatches(query, viewport)) {
        collectRules(body, viewport, rules, stylesheet);
      }
      continue;
    }
    if (/^@(supports|layer)\b/i.test(prelude)) {
      collectRules(body, viewport, rules, stylesheet);
      continue;
    }
    if (prelude.startsWith("@")) continue;

    const selectors = splitTopLevel(prelude, ",")
      .map(compact)
      .filter(Boolean);
    const declarations = parseDeclarations(body);
    if (selectors.length > 0 && declarations.length > 0) {
      rules.push({ declarations, selectors, stylesheet });
    }
  }
}

export function loadEntrypointCssCascade(entrypointUrl, viewport) {
  const entrypoint = fs.readFileSync(entrypointUrl, "utf8");
  const imports = Array.from(
    entrypoint.matchAll(/^\s*import\s+["']([^"']+\.css)["'];?/gm),
    (match) => match[1],
  );
  if (imports.length === 0) {
    throw new Error("The entrypoint does not import any CSS stylesheets");
  }

  const stylesheets = imports.map((specifier) => {
    const url = new URL(specifier, entrypointUrl);
    return {
      name: path.basename(fileURLToPath(url)),
      source: fs.readFileSync(url, "utf8"),
      url,
    };
  });
  const rules = [];
  for (const stylesheet of stylesheets) {
    const withoutComments = stylesheet.source.replace(/\/\*[\s\S]*?\*\//g, "");
    collectRules(withoutComments, viewport, rules, stylesheet.name);
  }

  return {
    source: stylesheets.map((stylesheet) => stylesheet.source).join("\n"),
    stylesheets,
    declarations(selector) {
      const normalizedSelector = compact(selector);
      const effective = new Map();
      for (const rule of rules) {
        if (!rule.selectors.includes(normalizedSelector)) continue;
        for (const declaration of rule.declarations) {
          const current = effective.get(declaration.property);
          if (current?.important && !declaration.important) continue;
          effective.set(declaration.property, {
            ...declaration,
            stylesheet: rule.stylesheet,
          });
        }
      }
      return Object.fromEntries(effective);
    },
  };
}
