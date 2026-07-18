const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourcePath = path.join(root, "styles.css");
const playerSources = ["player.html", "player.js", "combat-system.js", "shared-data.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const dashboardSources = ["index.html", "app.js", "dashboard-optional.js", "mission-console-live.css"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

function skipTrivia(text, index) {
  let cursor = index;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) {
      cursor += 1;
      continue;
    }
    if (text.startsWith("/*", cursor)) {
      const end = text.indexOf("*/", cursor + 2);
      cursor = end < 0 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function scanToBoundary(text, start, boundaries) {
  let quote = "";
  let comment = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (!parenDepth && !bracketDepth && boundaries.has(char)) return index;
  }
  return text.length;
}

function matchingBrace(text, openingIndex) {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = openingIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (!depth) return index;
    }
  }
  return text.length - 1;
}

function parseNodes(text) {
  const nodes = [];
  let cursor = 0;
  while (cursor < text.length) {
    cursor = skipTrivia(text, cursor);
    if (cursor >= text.length) break;
    const boundary = scanToBoundary(text, cursor, new Set(["{", ";"]));
    const header = text.slice(cursor, boundary).trim();
    if (!header) {
      cursor = boundary + 1;
      continue;
    }
    if (text[boundary] === ";") {
      nodes.push({ type: "statement", header });
      cursor = boundary + 1;
      continue;
    }
    if (text[boundary] !== "{") break;
    const closing = matchingBrace(text, boundary);
    const body = text.slice(boundary + 1, closing);
    const isContainer = /^@(media|supports|container|layer|document)\b/i.test(header);
    nodes.push({
      type: /^@keyframes\b/i.test(header) ? "keyframes" : isContainer ? "container" : header.startsWith("@") ? "at-rule" : "rule",
      header,
      body,
      children: isContainer ? parseNodes(body) : null
    });
    cursor = closing + 1;
  }
  return nodes;
}

function splitSelectors(selectorText) {
  const selectors = [];
  let cursor = 0;
  while (cursor < selectorText.length) {
    const boundary = scanToBoundary(selectorText, cursor, new Set([","]));
    selectors.push(selectorText.slice(cursor, boundary).trim());
    cursor = boundary + 1;
  }
  return selectors.filter(Boolean);
}

function textUsesToken(text, token) {
  return new RegExp(`(^|[^A-Za-z0-9_-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`).test(text);
}

function sourceUsesToken(token) {
  return textUsesToken(playerSources, token);
}

function selectorTokens(selector) {
  return [...selector.matchAll(/([.#])([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => ({ kind: match[1], name: match[2] }));
}

function isGlobalPlayerSelector(selector) {
  const clean = selector.trim();
  if (!clean) return false;
  if (/^(?::root|\*|\*::before|\*::after|html(?::[^\s]+)?|body(?:::{0,1}[A-Za-z-]+)?|\[hidden\])$/.test(clean)) return true;
  if (/^(button|input|select|textarea|label|form|option)(?:\b|:|\[)/.test(clean) && !/[.#][A-Za-z_]/.test(clean)) return true;
  return false;
}

function isPlayerRelevantSelector(selectorText) {
  return splitSelectors(selectorText).some((selector) => {
    if (isGlobalPlayerSelector(selector)) return true;
    return selectorTokens(selector).some((token) => sourceUsesToken(token.name));
  });
}

function isPlayerOnlySelector(selectorText) {
  const selectors = splitSelectors(selectorText);
  return Boolean(selectors.length) && selectors.every((selector) => {
    const tokens = selectorTokens(selector);
    return tokens.some((token) => sourceUsesToken(token.name) && !textUsesToken(dashboardSources, token.name));
  });
}

function splitDeclarations(body) {
  const parts = [];
  let cursor = 0;
  while (cursor < body.length) {
    const boundary = scanToBoundary(body, cursor, new Set([";"]));
    const raw = body.slice(cursor, boundary).trim();
    if (raw) parts.push(raw);
    cursor = boundary + 1;
  }
  return parts.map((raw) => {
    const colon = scanToBoundary(raw, 0, new Set([":"]));
    if (colon >= raw.length) return { raw, property: "", important: false };
    const property = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    return { raw: `${raw};`, property, important: /!important\s*$/i.test(value) };
  });
}

function pruneSupersededDeclarations(nodes) {
  const seenBySelector = new Map();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.type === "container") {
      pruneSupersededDeclarations(node.children);
      continue;
    }
    if (node.type !== "rule") continue;
    const key = node.header.replace(/\s+/g, " ").trim();
    if (!seenBySelector.has(key)) seenBySelector.set(key, new Map());
    const seen = seenBySelector.get(key);
    const declarations = splitDeclarations(node.body);
    const kept = [];
    for (let declIndex = declarations.length - 1; declIndex >= 0; declIndex -= 1) {
      const declaration = declarations[declIndex];
      if (!declaration.property) {
        kept.push(declaration.raw);
        continue;
      }
      const later = seen.get(declaration.property);
      const overridden = later && (!declaration.important || later.important);
      if (!overridden) {
        kept.push(declaration.raw);
        seen.set(declaration.property, { important: declaration.important || Boolean(later?.important) });
      }
    }
    node.body = kept.reverse().join("\n");
  }
  return nodes.filter((node) => node.type !== "rule" || node.body.trim());
}

function filterPlayerNodes(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "container") {
      const children = filterPlayerNodes(node.children);
      return children.length ? [{ ...node, children }] : [];
    }
    if (node.type === "rule") return isPlayerRelevantSelector(node.header) ? [{ ...node }] : [];
    if (node.type === "statement" || node.type === "at-rule") return [{ ...node }];
    return [];
  });
}

function filterDashboardNodes(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "container") {
      const children = filterDashboardNodes(node.children);
      return children.length ? [{ ...node, children }] : [];
    }
    if (node.type === "rule" && isPlayerOnlySelector(node.header)) return [];
    return [{ ...node }];
  });
}

function keyframeName(node) {
  return node.header.replace(/^@keyframes\s+/i, "").trim();
}

function collectReferencedKeyframes(nodes, names) {
  const serializedRules = nodes.map((node) => node.type === "container"
    ? collectRuleText(node.children)
    : node.type === "rule" ? node.body : "").join("\n");
  return new Set(names.filter((name) => new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`).test(serializedRules)));
}

function collectRuleText(nodes) {
  return nodes.map((node) => node.type === "container" ? collectRuleText(node.children) : node.type === "rule" ? node.body : "").join("\n");
}

function serializeNodes(nodes, indent = "") {
  return nodes.map((node) => {
    if (node.type === "statement") return `${indent}${node.header};`;
    if (node.type === "container") return `${indent}${node.header} {\n${serializeNodes(node.children, `${indent}  `)}\n${indent}}`;
    const body = node.body.trim().split("\n").map((line) => `${indent}  ${line.trim()}`).join("\n");
    return `${indent}${node.header} {\n${body}\n${indent}}`;
  }).join("\n\n");
}

const source = fs.readFileSync(sourcePath, "utf8");
const nodes = parseNodes(source);
const keyframes = nodes.filter((node) => node.type === "keyframes");
const keyframeNames = keyframes.map(keyframeName);

let playerNodes = filterPlayerNodes(nodes);
playerNodes = pruneSupersededDeclarations(playerNodes);
const referencedKeyframes = collectReferencedKeyframes(playerNodes, keyframeNames);
const lastKeyframeByName = new Map();
keyframes.forEach((node) => lastKeyframeByName.set(keyframeName(node), node));
const playerKeyframes = [...referencedKeyframes].map((name) => lastKeyframeByName.get(name)).filter(Boolean);
playerNodes.push(...playerKeyframes);

const dashboardNodes = filterDashboardNodes(nodes);
const banner = "/* Generated from styles.css by build-ui-css.js. Edit styles.css, then regenerate. */\n\n";
fs.writeFileSync(path.join(root, "player.css"), banner + serializeNodes(playerNodes) + "\n");
fs.writeFileSync(path.join(root, "dashboard.css"), banner + serializeNodes(dashboardNodes) + "\n");

const summary = {
  playerBytes: fs.statSync(path.join(root, "player.css")).size,
  dashboardBytes: fs.statSync(path.join(root, "dashboard.css")).size,
  playerRules: playerNodes.filter((node) => node.type === "rule").length,
  playerKeyframes: playerKeyframes.length
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
