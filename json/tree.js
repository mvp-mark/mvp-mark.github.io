// Paths and search over a parsed JSON value, for the output view (no DOM;
// used by app.js and by tests/).

import { RawNumber, stringify } from "./parser.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// JSONPath-style text for a list of object keys / array indices:
// $.users[3].name, $["chave com espaço"].
export function formatPath(keys) {
  return "$" + keys.map((key) => {
    if (typeof key === "number") return `[${key}]`;
    return IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
  }).join("");
}

// What a primitive is searched by: strings by their content, the rest as
// written in the output.
function searchText(value) {
  if (value instanceof RawNumber) return value.source;
  return String(value);
}

// Keys and primitive values containing `query` (ignoring case), in document
// order. Each match is { keys, steps, on: "key" | "value" }: keys are the
// object keys / array indices on the way to it and steps the position of
// each among its container's entries (what the view's lines are indexed
// by). Stops at `limit` matches, with truncated: true (there may be more).
export function searchValue(value, query, limit = 1000) {
  const needle = query.toLowerCase();
  const matches = [];
  if (!needle) return { matches, truncated: false };
  const keys = [];
  const steps = [];
  const add = (on) => matches.push({ keys: [...keys], steps: [...steps], on });

  // True once the limit is reached.
  const visit = (v) => {
    if (v === null || typeof v !== "object" || v instanceof RawNumber) {
      if (searchText(v).toLowerCase().includes(needle)) add("value");
      return matches.length >= limit;
    }
    const isArray = Array.isArray(v);
    const names = isArray ? null : Object.keys(v);
    const n = isArray ? v.length : names.length;
    for (let i = 0; i < n; i++) {
      const key = isArray ? i : names[i];
      keys.push(key);
      steps.push(i);
      if (!isArray && key.toLowerCase().includes(needle)) add("key");
      const done = matches.length >= limit || visit(v[key]);
      keys.pop();
      steps.pop();
      if (done) return true;
    }
    return false;
  };

  return { matches, truncated: visit(value) };
}

const isContainer = (v) => v !== null && typeof v === "object" && !(v instanceof RawNumber);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Copy of value with every object's keys in code-unit order (like jq -S);
// arrays keep their order.
export function sortKeys(value) {
  if (!isContainer(value)) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

// Differences from `before` to `after`: { keys, kind: "added" | "removed" |
// "changed", before, after } (before/after undefined where absent). Objects
// are matched by key and arrays by index; values are compared as written
// (1.0 differs from 1). Stops at `limit`, with truncated: true.
export function diffValues(before, after, limit = 1000) {
  const diffs = [];
  const keys = [];
  const add = (kind, a, b) => diffs.push({ keys: [...keys], kind, before: a, after: b });

  const visit = (a, b) => {
    if (isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b)) {
      const names = Array.isArray(a)
        ? Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i)
        : [...Object.keys(a), ...Object.keys(b).filter((key) => !hasOwn(a, key))];
      for (const key of names) {
        if (diffs.length >= limit) return;
        keys.push(key);
        if (!hasOwn(b, key)) add("removed", a[key], undefined);
        else if (!hasOwn(a, key)) add("added", undefined, b[key]);
        else visit(a[key], b[key]);
        keys.pop();
      }
    } else if (stringify(a) !== stringify(b)) {
      add("changed", a, b);
    }
  };

  visit(before, after);
  return { diffs, truncated: diffs.length >= limit };
}
