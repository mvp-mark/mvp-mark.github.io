// What the selection bar says about text selected in the input or the
// output (no DOM; used by app.js and by tests/).

import { RawNumber, parseJson } from "./parser.js";

// Longer selections are only counted, not parsed.
const PARSE_MAX_CHARS = 200000;

// Unix timestamps read as dates: in seconds or milliseconds, 2001 to 2286.
const SECONDS = [1e9, 1e10];
const MILLISECONDS = [1e12, 1e13];

// Characters (code points, as people count them), UTF-8 bytes and lines.
function count(text) {
  let chars = 0;
  let bytes = 0;
  let lines = 1;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    chars++;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (ch === "\n") lines++;
  }
  // A selection ending at a line break doesn't take in the next line.
  if (text.endsWith("\n") && lines > 1) lines--;
  return { chars, bytes, lines };
}

const parse = (text) => {
  try {
    return { value: parseJson(text) };
  } catch {
    return null;
  }
};

// Levels of nesting in `value` (0 for a primitive or an empty container).
// A loop rather than recursion: the selection can be nested very deep.
function depthOf(value) {
  let deepest = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (v === null || typeof v !== "object" || v instanceof RawNumber) continue;
    const children = Object.values(v);
    if (children.length) deepest = Math.max(deepest, depth + 1);
    for (const child of children) stack.push([child, depth + 1]);
  }
  return deepest;
}

// { type, count, depth } for a parsed value; count is the keys, items or
// characters of a string; for a string holding JSON, nested is its type.
function describeValue(value) {
  if (value === null) return { type: "null" };
  if (value instanceof RawNumber || typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "string") {
    const info = { type: "string", count: [...value].length };
    const inner = /^\s*[[{]/.test(value) ? parse(value.trim()) : null;
    if (inner && typeof inner.value === "object") info.nested = Array.isArray(inner.value) ? "array" : "object";
    return info;
  }
  const isArray = Array.isArray(value);
  return { type: isArray ? "array" : "object", count: isArray ? value.length : Object.keys(value).length, depth: depthOf(value) };
}

// The JSON in the selection: a whole value (a trailing comma is ignored),
// or else a run of an object's members ("a": 1, "b": 2 -> type "members")
// or of an array's items (1, 2 -> type "items"), whose depth leaves out the
// braces added to read them. Null when it's neither.
function jsonOf(text) {
  const trimmed = text.trim().replace(/,$/, "").trim();
  if (!trimmed) return null;
  const whole = parse(trimmed);
  if (whole) return { ...describeValue(whole.value), value: whole.value };
  const members = parse(`{${trimmed}}`);
  if (members) return { type: "members", count: Object.keys(members.value).length, depth: depthOf(members.value) - 1 };
  const items = parse(`[${trimmed}]`);
  if (items) return { type: "items", count: items.value.length, depth: depthOf(items.value) - 1 };
  return null;
}

// A number that looks like a Unix timestamp, as a Date (else null).
function dateOf(value) {
  if (!(value instanceof RawNumber) && typeof value !== "number") return null;
  const n = Number(value instanceof RawNumber ? value.source : value);
  if (!Number.isInteger(n)) return null;
  if (n >= SECONDS[0] && n < SECONDS[1]) return new Date(n * 1000);
  if (n >= MILLISECONDS[0] && n < MILLISECONDS[1]) return new Date(n);
  return null;
}

// { chars, bytes, lines, json, date } for the selected text; json is
// described above (null when it isn't JSON or is too long to parse) and
// date is set when the selection is a number that looks like a timestamp.
export function describeSelection(text) {
  const info = { ...count(text), json: null, date: null };
  if (info.chars > PARSE_MAX_CHARS) return info;
  const json = jsonOf(text);
  if (json) {
    const { value, ...rest } = json;
    info.json = rest;
    info.date = dateOf(value);
  }
  return info;
}
