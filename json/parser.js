// Parsing, repair and validation of JSON-like text: everything the formatter
// does that doesn't touch the DOM (used by app.js and by tests/). Messages
// come from i18n.js, in its current locale.

import { t } from "./i18n.js";

// A number kept as written. JS numbers are doubles, so JSON.parse turns
// 12345678901234567890 into 12345678901234567000 and 1.0 into 1; since a
// formatter should only change whitespace, numbers whose text wouldn't
// survive that round trip are kept as their source text instead.
export class RawNumber {
  constructor(source) {
    this.source = source;
    Object.freeze(this);
  }
}

// True if writing Number(literal) back out wouldn't give the same text.
function rewritesNumber(literal) {
  return String(Number(literal)) !== literal;
}

// Browsers with JSON.parse source text access (reviver's 3rd argument).
const HAS_SOURCE_CONTEXT = (() => {
  let supported = false;
  JSON.parse("1", (key, value, context) => {
    supported = context?.source === "1";
    return value;
  });
  return supported;
})();

// JSON.parse, except numbers it would change come back as RawNumber.
// Throws exactly as JSON.parse does.
export function parseJson(text) {
  const value = JSON.parse(text);
  // Valid JSON from here on, so this regex can't mistake text for numbers.
  const literals = text.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  let rewritten = false;
  for (const [literal] of literals) {
    if (literal[0] !== '"' && rewritesNumber(literal)) {
      rewritten = true;
      break;
    }
  }
  if (!rewritten) return value;
  if (HAS_SOURCE_CONTEXT) {
    return JSON.parse(text, (key, v, context) =>
      typeof v === "number" && rewritesNumber(context.source) ? new RawNumber(context.source) : v
    );
  }
  return parseLenient(text); // reads valid JSON as JSON.parse does, keeping numbers
}

// JSON.stringify(value, null, indent), with RawNumber written as its source
// text; a null indent means compact output.
export function stringify(value, indent = null) {
  const parts = [];
  const write = (v, pad) => {
    if (v instanceof RawNumber) {
      parts.push(v.source);
      return;
    }
    if (v === null || typeof v !== "object") {
      parts.push(JSON.stringify(v));
      return;
    }
    const isArray = Array.isArray(v);
    const keys = isArray ? null : Object.keys(v);
    const n = isArray ? v.length : keys.length;
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    if (n === 0) {
      parts.push(open + close);
      return;
    }
    const inner = indent ? pad + indent : "";
    parts.push(indent ? open + "\n" + inner : open);
    for (let k = 0; k < n; k++) {
      if (k > 0) parts.push(indent ? ",\n" + inner : ",");
      if (isArray) {
        write(v[k], inner);
      } else {
        parts.push(JSON.stringify(keys[k]) + (indent ? ": " : ":"));
        write(v[keys[k]], inner);
      }
    }
    parts.push(indent ? "\n" + pad + close : close);
  };
  write(value, "");
  return parts.join("");
}

// End (exclusive) of the string or comment that starts at i, or -1 if none
// does. Strings stop at a line break so one missing quote doesn't swallow
// the rest of the text, and a '//' right after ':' isn't a comment (bare
// URLs like {url: http://x.com}).
function literalEnd(text, i) {
  const c = text[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
    return Math.min(text[j] === c ? j + 1 : j, text.length);
  }
  if (c === "/" && text[i + 1] === "*") {
    const close = text.indexOf("*/", i + 2);
    return close < 0 ? text.length : close + 2;
  }
  if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
    const close = text.indexOf("\n", i);
    return close < 0 ? text.length : close;
  }
  return -1;
}

// Calls visit(kind, pos, end) for each string ("string") and comment
// ("comment") in text, in order.
function forEachLiteral(text, visit) {
  for (let i = 0; i < text.length; ) {
    const end = literalEnd(text, i);
    if (end < 0) {
      i++;
      continue;
    }
    visit(text[i] === "/" ? "comment" : "string", i, end);
    i = end;
  }
}

// Blanks out line/block comments before lenient parsing; strings are left
// alone, so "a // b" or "src/**/*.js" survive. Comments become spaces
// (newlines kept) so error positions still match the original text.
export function stripComments(text) {
  let out = "";
  let from = 0;
  forEachLiteral(text, (kind, pos, end) => {
    if (kind !== "comment") return;
    out += text.slice(from, pos) + text.slice(pos, end).replace(/[^\n]/g, " ");
    from = end;
  });
  return out + text.slice(from);
}

const JSON_NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function coerceBareToken(raw) {
  const token = raw.trim();
  if (token === "true" || token === "True") return true;
  if (token === "false" || token === "False") return false;
  if (token === "null" || token === "None") return null;
  if (JSON_NUMBER_RE.test(token)) return rewritesNumber(token) ? new RawNumber(token) : Number(token);
  return token; // leading zeros, dates, free text, etc. stay as strings
}

// Escapes as JS reads them (\' included); an unknown or malformed one is
// kept as written, so Windows paths like C:\Users don't lose the backslash.
const ESCAPES = { '"': '"', "'": "'", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

// The escape sequence at s[i] (a backslash): [decoded text, length].
function decodeEscape(s, i) {
  const e = s[i + 1];
  if (e in ESCAPES) return [ESCAPES[e], 2];
  if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
    return [String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)), 6];
  }
  if (e === "\n") return ["", 2]; // line continuation
  if (e === "\r") return ["", s[i + 2] === "\n" ? 3 : 2];
  return [s[i] + e, 2];
}

// Contents of a quoted string (quotes excluded) as parseLenient reads them.
function unescapeLenient(body) {
  let out = "";
  let from = 0;
  for (let i = body.indexOf("\\"); i >= 0 && i < body.length - 1; i = body.indexOf("\\", from)) {
    const [decoded, length] = decodeEscape(body, i);
    out += body.slice(from, i) + decoded;
    from = i + length;
  }
  return out + body.slice(from);
}

// Tolerant parser for JSON-like text where keys and/or string values are
// missing quotes (e.g. {status:processando,created_at:2026-08-20T09:01:08Z}).
// Builds the JS value directly instead of trying to patch the text with
// regex, since bare values can themselves contain ':' (timestamps) or
// spaces/accents (free text) that a text-level fix can't disambiguate.
// A missing comma between items is assumed when what follows can only be
// the next item; with `report`, those spots are listed in
// report.missingCommas as { pos, before }: pos is where the comma goes
// (right after the previous value), before shows the item that follows.
export function parseLenient(text, report = null) {
  const VALUE_END = new Set([",", "}", "]"]);
  const KEY_END = new Set([":"]);
  // A bare word that is a whole value by itself.
  const WHOLE_VALUE = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|True|False|None)$/;
  const BARE_KEY = /[A-Za-z_$][\w$-]*/y;
  const s = stripComments(text);
  const missingCommas = report ? (report.missingCommas = []) : null;
  let i = 0;

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++;
  }

  function error(msg, pos = i) {
    const err = new SyntaxError(msg);
    err.pos = pos;
    throw err;
  }

  function found() {
    return i >= s.length ? t("found.end") : `'${s[i]}'`;
  }

  function readQuotedString(quote) {
    const start = i;
    i++; // opening quote
    while (i < s.length && s[i] !== quote) i += s[i] === "\\" ? 2 : 1;
    if (s[i] !== quote) error(t("parse.stringNotClosed"), start);
    i++; // closing quote
    return unescapeLenient(s.slice(start + 1, i - 1));
  }

  function readBareUntil(stopChars) {
    let start = i;
    while (i < s.length && !stopChars.has(s[i])) i++;
    return s.slice(start, i).trim();
  }

  // Does a "key:" start at j? Quoted or a bare name, and not a URL's "://".
  function keyAt(j) {
    const q = s[j];
    let end;
    if (q === '"' || q === "'") {
      end = j + 1;
      while (end < s.length && s[end] !== q && s[end] !== "\n") end += s[end] === "\\" ? 2 : 1;
      if (s[end] !== q) return false;
      end++;
    } else {
      BARE_KEY.lastIndex = j;
      const name = BARE_KEY.exec(s);
      if (!name) return false;
      end = j + name[0].length;
    }
    while (end < s.length && /\s/.test(s[end])) end++;
    return s[end] === ":" && !s.startsWith("//", end + 1);
  }

  // Does something that can only be an array item start at j?
  function itemAt(j) {
    return /^(?:[-\d"'{\[]|(?:true|false|null|True|False|None)\b)/.test(s.slice(j, j + 6));
  }

  // i is at whitespace inside a bare value that started at `start`: is the
  // next item already starting after it (a comma is missing)? In an object,
  // a "key:" on a new line, or after a whole value, or a quoted one; in an
  // array, anything on a new line, or a value after a whole value. Free
  // text like `Total: 5` or `2026-08-20 09:01:08` stays one value.
  function nextItemAfter(start, container) {
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (j >= s.length || VALUE_END.has(s[j])) return false;
    const newLine = s.slice(i, j).includes("\n");
    const whole = WHOLE_VALUE.test(s.slice(start, i));
    if (container === "object") return keyAt(j) && (newLine || whole || s[j] === '"' || s[j] === "'");
    return newLine || (whole && itemAt(j));
  }

  // A bare value runs to the next , } or ], or to where the next item
  // starts when the comma before it is missing (see nextItemAfter).
  function readBareValue(container) {
    const start = i;
    while (i < s.length && !VALUE_END.has(s[i])) {
      if (container && /\s/.test(s[i]) && !/\s/.test(s[i - 1]) && nextItemAfter(start, container)) break;
      i++;
    }
    return s.slice(start, i).trim();
  }

  // The next item starts at i but no comma came before it.
  function assumeComma() {
    if (!missingCommas) return;
    let pos = i;
    while (pos > 0 && /\s/.test(s[pos - 1])) pos--;
    const token = /^(?:"[^"\n]*"|'[^'\n]*'|[^\s,:{}\[\]]{1,30})/.exec(s.slice(i, i + 60));
    missingCommas.push({ pos, before: token ? token[0] : `'${s[i]}'` });
  }

  // container: "object" | "array" | null (top level). Object values may be
  // empty: {texto:,a:1} gives "" instead of failing.
  function parseValue(container) {
    skipWs();
    const c = s[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"' || c === "'") return readQuotedString(c);
    const token = readBareValue(container);
    if (token === "") {
      if (container === "object") return "";
      error(t("parse.valueExpected", { found: found() }));
    }
    return coerceBareToken(token);
  }

  function parseKey() {
    skipWs();
    const c = s[i];
    if (c === '"' || c === "'") return readQuotedString(c);
    const token = readBareUntil(KEY_END);
    if (token === "") error(t("parse.keyExpected", { found: found() }));
    return token;
  }

  function parseObject() {
    const obj = {};
    const open = i;
    i++; // {
    skipWs();
    if (s[i] === "}") { i++; return obj; }
    while (true) {
      const key = parseKey();
      skipWs();
      if (s[i] !== ":") error(t("parse.colonExpected", { found: found() }));
      i++;
      const value = parseValue("object");
      // Plain assignment to "__proto__" would set the prototype instead.
      if (key === "__proto__") {
        Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
      } else {
        obj[key] = value;
      }
      skipWs();
      if (s[i] === ",") { i++; skipWs(); if (s[i] === "}") { i++; break; } continue; }
      if (s[i] === "}") { i++; break; }
      if (keyAt(i)) { assumeComma(); continue; }
      if (i >= s.length) error(t("parse.neverClosed", { open: "{", close: "}" }), open);
      error(t("parse.commaOrClose", { close: "}", found: found() }));
    }
    return obj;
  }

  function parseArray() {
    const arr = [];
    const open = i;
    i++; // [
    skipWs();
    if (s[i] === "]") { i++; return arr; }
    while (true) {
      arr.push(parseValue("array"));
      const end = i;
      skipWs();
      if (s[i] === ",") { i++; skipWs(); if (s[i] === "]") { i++; break; } continue; }
      if (s[i] === "]") { i++; break; }
      if (i < s.length && (itemAt(i) || s.slice(end, i).includes("\n"))) { assumeComma(); continue; }
      if (i >= s.length) error(t("parse.neverClosed", { open: "[", close: "]" }), open);
      error(t("parse.commaOrClose", { close: "]", found: found() }));
    }
    return arr;
  }

  skipWs();
  const result = parseValue(null);
  skipWs();
  if (i < s.length) error(t("parse.extraContent", { found: found() }));
  return result;
}

// text with a comma added at each of parseLenient's missingCommas.
export function insertCommas(text, missingCommas) {
  let out = "";
  let from = 0;
  [...missingCommas].sort((a, b) => a.pos - b.pos).forEach(({ pos }) => {
    out += text.slice(from, pos) + ",";
    from = pos;
  });
  return out + text.slice(from);
}

// Input wrapped in quotes ("{...}") or double-encoded JSON parses as a plain
// string; peel those layers off while the string still looks like an
// object/array. Returns the original value if no layer can be parsed; with
// allowLenient, a layer that fails is reported in `error` ({ source, pos,
// message }, pos relative to that layer's text).
// A layer fixed by repairNestedKeys is returned in `repaired` (with
// `source`, that layer's text).
export function unwrapStringified(value, allowLenient) {
  let unwrapped = false;
  let repaired = null;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value !== "string" || !/^\s*[{\[]/.test(value)) break;
    try {
      value = parseJson(value);
    } catch {
      if (!allowLenient) break;
      const fix = repairNestedKeys(value, true);
      if (fix) {
        repaired = { ...fix, source: value };
        value = fix.value;
      } else {
        try {
          value = parseLenient(value);
        } catch (err) {
          return { value, unwrapped, error: { source: value, pos: err.pos ?? null, message: err.message } };
        }
      }
    }
    unwrapped = true;
  }
  return { value, unwrapped, repaired };
}

const CLOSER = { "{": "}", "[": "]" };

// Brackets outside strings and comments, in order: [{ char, pos }].
// Strings stop at a line break so one missing quote doesn't hide the rest.
export function scanBrackets(text) {
  const found = [];
  for (let i = 0; i < text.length; ) {
    const end = literalEnd(text, i);
    if (end >= 0) {
      i = end;
      continue;
    }
    const c = text[i];
    if (c === "{" || c === "[" || c === "}" || c === "]") found.push({ char: c, pos: i });
    i++;
  }
  return found;
}

// Strings, bare words and comments for the input's syntax colors, with the
// same string/comment rules as scanBrackets: [{ kind, pos, end }], kind
// being key/str/num/bool/null/comment. A string or bare word followed by
// ":" is a key; other bare words (Python-style ones included) are colored
// only when they are numbers or keywords.
const BARE_WORD = /[A-Za-z0-9_$.+-]+/y;
const NUMBER_WORD = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^0[xX][0-9a-fA-F]+$/;
const KEYWORD_KIND = new Map([
  ["true", "bool"], ["false", "bool"], ["True", "bool"], ["False", "bool"],
  ["null", "null"], ["None", "null"],
]);

export function scanTokens(text) {
  const found = [];
  const followedByColon = (end) => {
    while (end < text.length && /\s/.test(text[end])) end++;
    return text[end] === ":";
  };
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    let end = literalEnd(text, i);
    let kind = null;
    if (end >= 0) {
      kind = c === "/" ? "comment" : followedByColon(end) ? "key" : "str";
    } else {
      end = i + 1;
      BARE_WORD.lastIndex = i;
      const word = BARE_WORD.exec(text);
      if (word) {
        end = i + word[0].length;
        if (followedByColon(end)) kind = "key";
        else if (NUMBER_WORD.test(word[0])) kind = "num";
        else kind = KEYWORD_KIND.get(word[0]) ?? null;
      }
    }
    if (kind) found.push({ kind, pos: i, end });
    i = end;
  }
  return found;
}

// Rows copied from a database come as {...} {...} {...} (one object per
// row, no surrounding array). Returns that text as "[{...},{...}]", or null
// unless it is 2+ top-level objects/arrays separated only by spaces/commas.
export function wrapConcatenated(text) {
  const chunks = [];
  let depth = 0;
  let start = 0;
  let last = 0;
  for (const { char, pos } of scanBrackets(text)) {
    if (char === "{" || char === "[") {
      if (depth === 0) {
        if (/[^\s,]/.test(stripComments(text.slice(last, pos)))) return null;
        start = pos;
      }
      depth++;
    } else {
      if (depth === 0) return null;
      depth--;
      if (depth === 0) {
        chunks.push(text.slice(start, pos + 1));
        last = pos + 1;
      }
    }
  }
  if (depth !== 0 || chunks.length < 2) return null;
  if (/[^\s,]/.test(stripComments(text.slice(last)))) return null;
  return "[\n" + chunks.join(",\n") + "\n]";
}

// Pretty-printed input: a bracket that ends its line should be closed by
// the first later line indented no deeper than the bracket's own line. If
// that line doesn't start with the matching closer, the closer is missing
// right before it (at the end of the previous line, before its comma).
function missingClosersByIndent(text, brackets) {
  const lines = text.split("\n");
  if (lines.length < 3) return null;
  const starts = [0];
  lines.forEach((l) => starts.push(starts[starts.length - 1] + l.length + 1));
  const indentOf = (l) => l.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
  const isBlank = (l) => l.trim() === "";

  const inserts = [];
  let ln = 0;
  for (const b of brackets) {
    while (starts[ln + 1] <= b.pos) ln++;
    if (!CLOSER[b.char] || !isBlank(text.slice(b.pos + 1, starts[ln] + lines[ln].length))) continue;

    const base = indentOf(lines[ln]);
    let n = ln + 1;
    while (n < lines.length && (isBlank(lines[n]) || indentOf(lines[n]) > base)) n++;
    const next = n < lines.length ? lines[n].trim() : "";
    if (next[0] === CLOSER[b.char]) continue;

    let last = n - 1;
    while (last > ln && isBlank(lines[last])) last--;
    if (last === ln) continue;
    const content = lines[last].replace(/\s+$/, "");
    const end = starts[last] + content.length;
    const hasComma = content.endsWith(",");
    inserts.push({
      pos: hasComma ? end - 1 : end,
      char: CLOSER[b.char],
      open: b.pos,
      lineIndent: lines[ln].match(/^[ \t]*/)[0],
      comma: !hasComma && next !== "" && next[0] !== "}" && next[0] !== "]",
      where: n < lines.length ? t("where.beforeIndent", { line: n + 1 }) : t("where.end"),
    });
  }
  return inserts.length ? inserts : null;
}

// Bracket matching alone: openers skipped by a closer of an outer bracket
// are closed right before it; openers still open at the end are closed at
// the end. null if nothing is missing or a closer has no opener at all.
function missingClosersByMatching(text, brackets) {
  const lastContentBefore = (pos) => {
    while (pos > 0 && /\s/.test(text[pos - 1])) pos--;
    return pos;
  };
  // Multi-line text with the spot at a line end: the closer gets its own
  // line, indented like the line of its opener.
  const ownLineIndent = (pos, open) => {
    if (!text.includes("\n") || !/^[ \t]*(\n|$)/.test(text.slice(pos))) return undefined;
    return text.slice(text.lastIndexOf("\n", open) + 1).match(/^[ \t]*/)[0];
  };
  const stack = [];
  const inserts = [];
  for (const b of brackets) {
    if (CLOSER[b.char]) {
      stack.push(b);
      continue;
    }
    let depth = stack.length - 1;
    while (depth >= 0 && CLOSER[stack[depth].char] !== b.char) depth--;
    if (depth < 0) return null;
    while (stack.length - 1 > depth) {
      const open = stack.pop();
      const pos = lastContentBefore(b.pos);
      inserts.push({
        pos,
        char: CLOSER[open.char],
        open: open.pos,
        lineIndent: ownLineIndent(pos, open.pos),
        where: t("where.beforeCloser", { char: b.char, line: lineCol(text, b.pos).line }),
      });
    }
    stack.pop();
  }
  while (stack.length) {
    const open = stack.pop();
    const pos = lastContentBefore(text.length);
    inserts.push({
      pos,
      char: CLOSER[open.char],
      open: open.pos,
      lineIndent: ownLineIndent(pos, open.pos),
      where: t("where.end"),
    });
  }
  return inserts.length ? inserts : null;
}

// Inserts the closers (inner ones first when they share a position), each
// on its own line when it has a lineIndent, and returns the new text plus
// a function mapping old positions to new ones.
function applyInserts(text, inserts) {
  const groups = new Map();
  inserts.forEach((ins) => {
    if (!groups.has(ins.pos)) groups.set(ins.pos, []);
    groups.get(ins.pos).push(ins);
  });
  const added = [...groups.entries()]
    .map(([pos, group]) => {
      group.sort((a, b) => b.open - a.open);
      const closers = group.map((g) => (g.lineIndent === undefined ? g.char : "\n" + g.lineIndent + g.char));
      return { pos, str: closers.join("") + (group.some((g) => g.comma) ? "," : "") };
    })
    .sort((a, b) => a.pos - b.pos);

  let out = "";
  let from = 0;
  added.forEach(({ pos, str }) => {
    out += text.slice(from, pos) + str;
    from = pos;
  });
  out += text.slice(from);
  const shift = (pos) => pos + added.filter((a) => a.pos <= pos).reduce((sum, a) => sum + a.str.length, 0);
  return { text: out, shift };
}

// Path (keys / indexes) to the container whose opening bracket is at
// `target`. Keys are read the way the parser that accepted the text reads
// them (JSON.parse, or parseLenient's looser quoting).
function containerPath(text, target, lenient) {
  const keyFrom = (raw) => {
    const t = raw.trim();
    const q = t[0];
    if (q !== '"' && q !== "'") return t;
    if (lenient) return unescapeLenient(t.slice(1, -1));
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  };
  const frames = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = frames[frames.length - 1];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") i++;
        i++;
      }
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (c === "{" || c === "[") {
      if (i === target) return frames.map((f) => (f.array ? f.index : f.key));
      frames.push({ array: c === "[", index: 0, key: null, segStart: i + 1, keyDone: false });
    } else if (c === "}" || c === "]") {
      frames.pop();
    } else if (c === "," && top) {
      if (top.array) top.index++;
      else Object.assign(top, { segStart: i + 1, keyDone: false });
    } else if (c === ":" && top && !top.array && !top.keyDone) {
      top.key = keyFrom(text.slice(top.segStart, i));
      top.keyDone = true;
    }
  }
  return null;
}

// Adds the closers and parses the result: { inserts, fixed, value, marks,
// usedLenient }, or null if there's nothing to add or it still fails.
function tryInserts(text, inserts, lenient) {
  if (!inserts) return null;
  const { text: fixed, shift } = applyInserts(text, inserts);
  let value;
  let usedLenient = false;
  try {
    value = parseJson(fixed);
  } catch {
    if (!lenient) return null;
    try {
      value = parseLenient(fixed);
      usedLenient = true;
    } catch {
      return null;
    }
  }
  const marks = new Map();
  inserts.forEach((ins) => {
    const path = containerPath(fixed, shift(ins.open), usedLenient);
    if (path) marks.set(JSON.stringify(path), { label: t("mark.closerAdded", { char: ins.char }), openAdded: false });
  });
  return { inserts: [...inserts].sort((a, b) => a.open - b.open), fixed, value, marks, usedLenient, shift };
}

// Missing closers fixed automatically: each one is added at the end of the
// text (or right before a closer that skips it). `alternative` is set when
// the indentation points somewhere else and that also parses.
export function autoCloseBrackets(text, lenient) {
  const brackets = scanBrackets(text);
  const closed = tryInserts(text, missingClosersByMatching(text, brackets), lenient);
  if (!closed) return null;
  const byIndent = tryInserts(text, missingClosersByIndent(text, brackets), lenient);
  const spots = (r) => JSON.stringify(r.inserts.map((ins) => [ins.open, ins.pos]));
  closed.alternative = byIndent && spots(byIndent) !== spots(closed) ? byIndent : null;
  return closed;
}

function displayKey(raw) {
  const t = raw.trim();
  return /^["']/.test(t) ? `"${t.slice(1, -1)}"` : `"${t}"`;
}

// First place where an object key gets another key as its value, as in
// `teste: teste1: "teste2"` (should be `teste: {teste1: "teste2"}`).
// Returns { start, end, outerKey, innerKey }: the inner key..value span
// that needs { } around it. A bare inner key only counts when its value is
// quoted or a {...}/[...] (so `msg: Total: 5`, `url: http://...` and times
// like 09:01:08 stay plain text); a quoted one always counts.
function findNestedKey(text) {
  const skipWs = (k) => {
    while (k < text.length && /\s/.test(text[k])) k++;
    return k;
  };
  const endOfQuoted = (k) => {
    const q = text[k];
    k++;
    while (k < text.length && text[k] !== q && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
    return text[k] === q ? k + 1 : -1;
  };
  const endOfBracket = (k) => {
    let depth = 0;
    for (; k < text.length; k++) {
      const c = text[k];
      if (c === '"' || c === "'") {
        const e = endOfQuoted(k);
        if (e < 0) return -1;
        k = e - 1;
      } else if (c === "{" || c === "[") {
        depth++;
      } else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return k + 1;
      }
    }
    return -1;
  };
  const valueEnd = (k) => {
    if (text[k] === "{" || text[k] === "[") return endOfBracket(k);
    if (text[k] === '"' || text[k] === "'") return endOfQuoted(k);
    let e = k;
    while (e < text.length && !",}]\n".includes(text[e])) e++;
    while (e > k && /\s/.test(text[e - 1])) e--;
    return e > k ? e : -1;
  };
  // Is there "key: value" starting at k? Then where does it end.
  const nestedAt = (k) => {
    const quoted = text[k] === '"' || text[k] === "'";
    let keyEnd = -1;
    if (quoted) {
      keyEnd = endOfQuoted(k);
    } else {
      const m = /^[A-Za-z_$][\w$-]*/.exec(text.slice(k, k + 200));
      if (m) keyEnd = k + m[0].length;
    }
    if (keyEnd < 0) return null;
    const colon = skipWs(keyEnd);
    if (text[colon] !== ":") return null;
    const v = skipWs(colon + 1);
    if (text.startsWith("//", v)) return null; // http://...
    const inner = nestedAt(v);
    if (!quoted && !inner && !`"'{[`.includes(text[v] ?? "x")) return null;
    const end = inner ? inner.end : valueEnd(v);
    return end < 0 ? null : { start: k, end, innerKey: displayKey(text.slice(k, keyEnd)) };
  };

  const frames = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = frames[frames.length - 1];
    if (c === '"' || c === "'") {
      const e = endOfQuoted(i);
      const nl = text.indexOf("\n", i);
      i = e >= 0 ? e - 1 : nl < 0 ? text.length : nl;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (c === "{" || c === "[") {
      frames.push({ obj: c === "{", colon: false, keyStart: i + 1 });
    } else if (c === "}" || c === "]") {
      frames.pop();
    } else if (c === "," && top && top.obj) {
      top.colon = false;
      top.keyStart = i + 1;
    } else if (c === ":" && top && top.obj && !top.colon) {
      top.colon = true;
      const spot = nestedAt(skipWs(i + 1));
      if (spot) return { ...spot, outerKey: displayKey(text.slice(top.keyStart, i)) };
    }
  }
  return null;
}

// Wraps every key-valued key in { } (see findNestedKey), then parses,
// adding missing closers too if needed. When a '}' with no opener comes
// after the spot, the '{' is what's missing: only '{' is added and that
// '}' closes the new object (openerOnly). If that reading doesn't parse,
// both braces are tried. Returns { value, usedLenient, fixed, spots,
// closed, marks } or null if there's nothing to wrap or it still fails.
export function repairNestedKeys(text, lenient) {
  return wrapNestedKeys(text, lenient, true) ?? wrapNestedKeys(text, lenient, false);
}

function wrapNestedKeys(text, lenient, allowOpenerOnly) {
  let fixed = text;
  const spots = [];
  for (let n = 0; n < 100; n++) {
    const spot = findNestedKey(fixed);
    if (!spot) break;
    const openerOnly = allowOpenerOnly && classifyBrackets(scanBrackets(fixed))
      .some((b) => b.bad && b.char === "}" && b.pos > spot.start);
    spots.forEach((s) => {
      s.pos += (s.pos >= spot.start ? 1 : 0) + (!openerOnly && s.pos >= spot.end ? 1 : 0);
    });
    fixed = openerOnly
      ? fixed.slice(0, spot.start) + "{" + fixed.slice(spot.start)
      : fixed.slice(0, spot.start) + "{" + fixed.slice(spot.start, spot.end) + "}" + fixed.slice(spot.end);
    spots.push({
      pos: spot.start,
      line: lineCol(fixed, spot.start).line,
      outerKey: spot.outerKey,
      innerKey: spot.innerKey,
      openerOnly,
    });
  }
  if (!spots.length) return null;

  let value;
  let parsed = false;
  let usedLenient = false;
  let closed = null;
  try {
    value = parseJson(fixed);
    parsed = true;
  } catch {
    if (lenient) {
      try {
        value = parseLenient(fixed);
        parsed = true;
        usedLenient = true;
      } catch {
        // fall through to adding missing closers
      }
    }
  }
  if (!parsed) {
    closed = autoCloseBrackets(fixed, lenient);
    if (!closed) return null;
    ({ value, usedLenient } = closed);
  }

  const finalText = closed ? closed.fixed : fixed;
  const shift = closed ? closed.shift : (pos) => pos;
  const marks = closed ? new Map(closed.marks) : new Map();
  spots.forEach((s) => {
    const path = containerPath(finalText, shift(s.pos), usedLenient);
    if (!path) return;
    marks.set(JSON.stringify(path), s.openerOnly
      ? { label: t("mark.openerAdded"), openAdded: true, closeAdded: false }
      : { label: t("mark.bracesAdded"), openAdded: true });
  });
  return { value, usedLenient, fixed: finalText, spots, closed, marks };
}

// `"{...}"` whose inner quotes aren't escaped isn't a valid string; with
// Fix JSON the text inside the outer quotes is read instead.
export function brokenWrapperInner(raw) {
  const start = raw.search(/\S/);
  const text = raw.trim();
  if (!/^(["'])[{\[][\s\S]*[}\]]\1$/.test(text)) return null;
  return { text: text.slice(1, -1), offset: start + 1 };
}

// For the error view, when closing at the end doesn't produce valid JSON
// but the indentation shows where the closer belongs.
export function suggestBracketRepair(text, lenient) {
  const brackets = scanBrackets(text);
  return tryInserts(text, missingClosersByIndent(text, brackets), lenient) ??
    tryInserts(text, missingClosersByMatching(text, brackets), lenient);
}

export function lineCol(text, pos) {
  const before = text.slice(0, pos);
  return { line: before.split("\n").length, col: pos - before.lastIndexOf("\n") };
}

// Strict JSON (RFC 8259) checker, used only after JSON.parse fails, to say
// where and why in Portuguese with the same positions in every browser.
// Returns { pos, message } or null if it finds nothing wrong.
export function findJsonError(text) {
  let i = 0;
  const stack = []; // open brackets: { char, pos }
  const STOP = /[\s,:{}\[\]"]/;

  function Fail(pos, message) {
    this.pos = pos;
    this.message = message;
  }
  const fail = (pos, message) => { throw new Fail(pos, message); };

  function found(pos = i) {
    if (pos >= text.length) return t("found.end");
    if (text[pos] === "\n") return t("found.lineBreak");
    return `'${text[pos]}'`;
  }

  function bareToken() {
    let end = i;
    while (end < text.length && !STOP.test(text[end])) end++;
    const token = text.slice(i, end);
    return token.length > 40 ? token.slice(0, 40) + "…" : token;
  }

  function unexpectedEnd() {
    const open = stack[stack.length - 1];
    if (open) {
      const close = open.char === "{" ? "}" : "]";
      fail(open.pos, t("parse.neverClosed", { open: open.char, close }));
    }
    fail(text.length, t("strict.endedEarly"));
  }

  function skipWs() {
    while (i < text.length && /[ \t\n\r]/.test(text[i])) i++;
    if (text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      fail(i, t("strict.comments"));
    }
  }

  // After a value inside { } or [ ]: what should have come instead.
  function expectedSeparator(close) {
    const c = text[i];
    const open = stack[stack.length - 1];
    if (c === "}" || c === "]") {
      fail(i, t("strict.wrongCloser", { close, open: open.char, line: lineCol(text, open.pos).line, found: c }));
    }
    if (/["'{\[\w-]/.test(c)) fail(i, t("strict.missingComma"));
    fail(i, t("parse.commaOrClose", { close, found: found() }));
  }

  function parseString() {
    const start = i;
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === undefined) break;
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            fail(i, t("strict.badUnicodeEscape"));
          }
          i += 6;
          continue;
        }
        if (!'"\\/bfnrt'.includes(e)) fail(i, t("strict.badEscape", { char: e }));
        i += 2;
        continue;
      }
      if (c === "\n") fail(i, t("strict.newlineInString"));
      if (c < " ") fail(i, t("strict.controlChar"));
      i++;
    }
    fail(start, t("strict.stringNotClosed"));
  }

  function parseValue() {
    skipWs();
    if (i >= text.length) unexpectedEnd();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "'") fail(i, t("strict.singleQuotes"));
    if (c === "," || c === "}" || c === "]") fail(i, t("strict.valueBefore", { char: c }));

    const token = bareToken();
    if (token === "true" || token === "false" || token === "null") { i += token.length; return; }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
    if (number.test(token)) { i += token.length; return; }

    const replacements = { True: "true", False: "false", None: "null", undefined: "null", NULL: "null", TRUE: "true", FALSE: "false" };
    if (replacements[token]) fail(i, t("strict.notJson", { token, replacement: replacements[token] }));
    if (/^-?0\d+(\.\d+)?$/.test(token)) fail(i, t("strict.leadingZero", { token }));
    if (/^[-+.\deE]+$/.test(token)) fail(i, t("strict.badNumber", { token }));
    fail(i, t("strict.unquotedValue", { token }));
  }

  function parseObject() {
    stack.push({ char: "{", pos: i });
    i++;
    skipWs();
    if (text[i] === "}") { i++; stack.pop(); return; }
    let comma = -1;
    while (true) {
      skipWs();
      if (i >= text.length) unexpectedEnd();
      const c = text[i];
      if (c === "}" && comma >= 0) fail(comma, t("strict.trailingComma", { char: "}" }));
      if (c === "'") fail(i, t("strict.singleQuotes"));
      if (c !== '"') {
        fail(i, /[\w$]/.test(c)
          ? t("strict.unquotedKey", { key: bareToken().split(":")[0] })
          : t("strict.keyExpected", { found: found() }));
      }
      parseString();
      skipWs();
      if (i >= text.length) unexpectedEnd();
      if (text[i] !== ":") fail(i, t("parse.colonExpected", { found: found() }));
      i++;
      parseValue();
      skipWs();
      if (i >= text.length) unexpectedEnd();
      if (text[i] === ",") { comma = i; i++; continue; }
      if (text[i] === "}") { i++; stack.pop(); return; }
      expectedSeparator("}");
    }
  }

  function parseArray() {
    stack.push({ char: "[", pos: i });
    i++;
    skipWs();
    if (text[i] === "]") { i++; stack.pop(); return; }
    let comma = -1;
    while (true) {
      skipWs();
      if (text[i] === "]" && comma >= 0) fail(comma, t("strict.trailingComma", { char: "]" }));
      parseValue();
      skipWs();
      if (i >= text.length) unexpectedEnd();
      if (text[i] === ",") { comma = i; i++; continue; }
      if (text[i] === "]") { i++; stack.pop(); return; }
      expectedSeparator("]");
    }
  }

  try {
    skipWs();
    parseValue();
    skipWs();
    if (i < text.length) {
      const c = text[i];
      fail(i, c === "}" || c === "]"
        ? t("strict.strayCloser", { char: c })
        : t("parse.extraContent", { found: found() }));
    }
    return null;
  } catch (err) {
    if (err instanceof Fail) return { pos: err.pos, message: err.message };
    return null; // e.g. nesting too deep for recursion; caller falls back
  }
}

export function strictErrorInfo(text, nativeErr) {
  const info = findJsonError(text);
  if (info) return info;
  const match = /position (\d+)/.exec(nativeErr.message);
  return { pos: match ? Number(match[1]) : null, message: nativeErr.message };
}

// Heuristic conformance checks against the raw (pre-fix) input. What's
// inside strings doesn't count ("http://..." is not a comment).
export function validateSpec(raw, spec) {
  const warnings = [];
  if (spec !== "rfc8259" && spec !== "ecma404" && spec !== "rfc4627") return warnings;

  // raw with each string as "" and each comment as a space.
  let code = "";
  let from = 0;
  let comments = false;
  let singleQuotes = false;
  forEachLiteral(raw, (kind, pos, end) => {
    code += raw.slice(from, pos) + (kind === "comment" ? " " : '""');
    from = end;
    if (kind === "comment") comments = true;
    else if (raw[pos] === "'" && end - pos >= 2 && raw[end - 1] === "'") singleQuotes = true;
  });
  code += raw.slice(from);

  const trimmed = code.trim();
  if (spec === "rfc4627" && trimmed && !/^[{\[]/.test(trimmed)) {
    warnings.push(t("spec.rfc4627TopLevel"));
  }
  if (comments) {
    warnings.push(t("spec.comments"));
  }
  if (/,\s*[}\]]/.test(code)) {
    warnings.push(t("spec.trailingCommas"));
  }
  if (singleQuotes) {
    warnings.push(t("spec.singleQuotes"));
  }
  if (/[{,]\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:/.test(code)) {
    warnings.push(t("spec.unquotedKeys"));
  }
  return warnings;
}

// Depth per bracket as in renderValue; a closer that skips open brackets
// closes its match and the skipped ones (never closed) are marked bad, as
// are closers with nothing to close.
export function classifyBrackets(brackets) {
  const stack = [];
  const out = brackets.map((b) => ({ ...b, depth: 0, bad: false }));
  out.forEach((b) => {
    if (CLOSER[b.char]) {
      b.depth = stack.length;
      stack.push(b);
      return;
    }
    let k = stack.length - 1;
    while (k >= 0 && CLOSER[stack[k].char] !== b.char) k--;
    if (k < 0) {
      b.bad = true;
      return;
    }
    while (stack.length - 1 > k) stack.pop().bad = true;
    b.depth = stack.pop().depth;
  });
  stack.forEach((b) => (b.bad = true));
  return out;
}

// Re-indents text that isn't valid JSON so an error in a one-line input can
// be found and edited. Only whitespace between tokens changes: strings,
// bare values and comments are copied as is, and unbalanced brackets are
// tolerated.
export function formatLoose(text, indent) {
  let out = "";
  let depth = 0;
  let pending = false; // a line break is owed before the next output
  let last = ""; // "open" | "close" | "sep" | "colon" | "token" | "string"
  const frames = []; // per open bracket: { obj, colon }

  const breakLine = () => {
    out += "\n" + indent.repeat(depth);
    pending = false;
  };
  const beforeItem = () => {
    if (pending) breakLine();
    else if (last === "token" || last === "string" || last === "close") out += " ";
  };
  const emitToken = (tok, kind = "token") => {
    beforeItem();
    out += tok;
    last = kind;
  };
  const startsComment = (j) =>
    text[j] === "/" && (text[j + 1] === "*" || (text[j + 1] === "/" && text[j - 1] !== ":"));

  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const top = frames[frames.length - 1];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      j = Math.min(text[j] === c ? j + 1 : j, text.length);
      emitToken(text.slice(i, j), "string");
      i = j;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const j = end < 0 ? text.length : end + 2;
      emitToken(text.slice(i, j));
      i = j;
    } else if (startsComment(i)) {
      const end = text.indexOf("\n", i);
      const j = end < 0 ? text.length : end;
      emitToken(text.slice(i, j).trimEnd());
      pending = true; // whatever follows must not end up inside the comment
      i = j;
    } else if (c === "{" || c === "[") {
      beforeItem();
      out += c;
      depth++;
      frames.push({ obj: c === "{", colon: false });
      pending = true;
      last = "open";
      i++;
    } else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      frames.pop();
      if (last === "open") pending = false;
      else breakLine();
      out += c;
      last = "close";
      i++;
    } else if (c === ",") {
      if (pending && last !== "open") breakLine();
      out += ",";
      if (top && top.obj) top.colon = false;
      pending = true;
      last = "sep";
      i++;
    } else if (c === ":" && top && top.obj && (!top.colon || last === "string")) {
      // After a quoted string it's a key even if a comma is missing before.
      if (pending) breakLine();
      out += ": ";
      top.colon = true;
      last = "colon";
      i++;
    } else {
      // Bare word (unquoted key/value). Keeps inner spaces, and ':' once
      // past the key (timestamps like 09:01:08 are values).
      const stopAtColon = top && top.obj && !top.colon;
      let j = i;
      while (
        j < text.length &&
        !'{}[],"\'\n'.includes(text[j]) &&
        !(stopAtColon && text[j] === ":") &&
        !(j > i && startsComment(j))
      ) j++;
      emitToken(text.slice(i, Math.max(j, i + 1)).trim());
      i = Math.max(j, i + 1);
    }
  }
  return out;
}

// One-line / minified input: some long line packed with brackets/commas.
export function isHardToEdit(text) {
  return text.split("\n").some((line) => {
    if (line.length <= 80) return false;
    const structural = line.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/[{}\[\],]/g);
    return structural !== null && structural.length >= 4;
  });
}
