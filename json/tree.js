// Paths and search over a parsed JSON value, for the output view (no DOM;
// used by app.js and by tests/).

import { RawNumber } from "./parser.js";

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
