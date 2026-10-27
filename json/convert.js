// Output conversions of a parsed JSON value to YAML and CSV text (no DOM;
// used by app.js and by tests/).

import { RawNumber, stringify } from "./parser.js";

const isContainer = (v) => v !== null && typeof v === "object" && !(v instanceof RawNumber);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Strings left unquoted in YAML: plain words that can't be read back as
// anything else (numbers, booleans, null, dates, YAML syntax).
const YAML_PLAIN = /^[\p{L}_/][\p{L}\p{N}_ ./-]*$/u;
const YAML_RESERVED = /^(?:null|true|false|yes|no|on|off|y|n)$/i;

function yamlScalar(value) {
  if (typeof value !== "string") return stringify(value);
  const plain = YAML_PLAIN.test(value) && !YAML_RESERVED.test(value) && !value.endsWith(" ");
  // A JSON string is also a valid YAML double-quoted string.
  return plain ? value : JSON.stringify(value);
}

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);
const inline = (v) => (!isContainer(v) ? yamlScalar(v) : Array.isArray(v) ? "[]" : "{}");

// Block-style YAML with 2-space indentation.
export function toYaml(value) {
  if (!isContainer(value) || isEmpty(value)) return inline(value) + "\n";
  const lines = [];
  // Writes the entries of a non-empty container, each line starting with pad.
  const write = (v, pad) => {
    if (Array.isArray(v)) {
      v.forEach((item) => {
        if (isContainer(item) && !isEmpty(item)) {
          // The item's first line goes right after the "- ".
          const first = lines.length;
          write(item, pad + "  ");
          lines[first] = pad + "- " + lines[first].slice(pad.length + 2);
        } else {
          lines.push(pad + "- " + inline(item));
        }
      });
      return;
    }
    Object.keys(v).forEach((key) => {
      const item = v[key];
      if (isContainer(item) && !isEmpty(item)) {
        lines.push(pad + yamlScalar(key) + ":");
        write(item, pad + "  ");
      } else {
        lines.push(pad + yamlScalar(key) + ": " + inline(item));
      }
    });
  };
  write(value, "");
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : stringify(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// RFC 4180 CSV of an array: of objects (a header with every key, in order of
// first appearance), of arrays (one row each) or of values (one column).
// Nested values go in a cell as compact JSON. null if value isn't an array.
export function toCsv(value) {
  if (!Array.isArray(value)) return null;
  let rows;
  const isObject = (v) => isContainer(v) && !Array.isArray(v);
  if (value.length && value.every(isObject)) {
    const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
    rows = [columns, ...value.map((row) => columns.map((key) => (hasOwn(row, key) ? row[key] : undefined)))];
  } else {
    rows = value.map((item) => (Array.isArray(item) ? item : [item]));
  }
  return rows.map((row) => row.map(csvCell).join(",") + "\r\n").join("");
}
