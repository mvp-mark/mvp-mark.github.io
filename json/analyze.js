// What the formatter should show for an input, decided without the DOM:
// app.js runs it on the page for small inputs and through worker.js for big
// ones (so the page doesn't freeze), then draws the result.

import {
  RawNumber,
  autoCloseBrackets,
  brokenWrapperInner,
  formatLoose,
  insertCommas,
  isHardToEdit,
  parseJson,
  parseLenient,
  repairNestedKeys,
  strictErrorInfo,
  suggestBracketRepair,
  unwrapStringified,
  validateSpec,
  wrapConcatenated,
} from "./parser.js";

// The re-indented text to put in the input when the error is in hard-to-edit
// input (minified, possibly wrapped in quotes), or null.
function reformatForEditing(raw, source, offset, indent) {
  const trimmed = raw.trim();
  const wrapped = offset > 0 && source !== raw && /^["']/.test(trimmed) &&
    trimmed === trimmed[0] + source + trimmed[0];
  if (!wrapped && source !== raw) return null;
  if (!isHardToEdit(source)) return null;
  const next = formatLoose(source, indent);
  return next === raw ? null : next;
}

// options: { spec, fix (Fix JSON on), indent (used to re-indent the input),
// reformatted (the input was just re-indented: don't do it again) }.
// Returns { warnings, ok } when there's a value to show, where
//   ok: { value, usedFix, joined, repaired }; repaired (or null) is an
//   automatic fix to point out, with the `source` text it applies to and
//   its `offset` in the input (-1 if it isn't there verbatim);
// or { warnings, fail } when there isn't, where
//   fail: { source, info, offset, closed, reformat, repair }: info is
//   { pos, message } about `source`; closed is autoCloseBrackets' fix (shown
//   instead of the error); reformat the re-indented input to retry with;
//   repair suggestBracketRepair's suggestion for the error view.
export function analyze(raw, { spec, fix: shouldFix, indent, reformatted }) {
  const warnings = validateSpec(raw, spec);

  const fail = (source, info, offset) => {
    const closed = autoCloseBrackets(source, shouldFix);
    const reformat = closed || reformatted ? null : reformatForEditing(raw, source, offset, indent);
    const repair = closed || reformat !== null ? null : suggestBracketRepair(source, shouldFix);
    return { warnings, fail: { source, info, offset, closed, reformat, repair } };
  };

  // Reads `source` (the input, or the text inside quotes wrapping it).
  // Returns { value, usedFix, joined?, repaired? } or fail()'s result.
  const read = (source, offset) => {
    try {
      return { value: parseJson(source), usedFix: source !== raw };
    } catch (strictErr) {
      const list = shouldFix ? wrapConcatenated(source) : null;
      if (list) {
        try {
          return { value: parseJson(list), usedFix: true, joined: true };
        } catch {
          try {
            return { value: parseLenient(list), usedFix: true, joined: true };
          } catch {
            // fall through: report the error against the original text
          }
        }
      }
      const repaired = repairNestedKeys(source, shouldFix);
      if (repaired) {
        return { value: repaired.value, usedFix: repaired.usedLenient || source !== raw, repaired: { ...repaired, source, offset } };
      }
      if (!shouldFix) return fail(source, strictErrorInfo(source, strictErr), offset);
      try {
        const report = {};
        const value = parseLenient(source, report);
        const commas = report.missingCommas;
        if (!commas.length) return { value, usedFix: true };
        return { value, usedFix: true, repaired: { commas, fixed: insertCommas(source, commas), source, offset } };
      } catch (lenientErr) {
        const wrapped = source === raw ? brokenWrapperInner(raw) : null;
        if (wrapped) return read(wrapped.text, wrapped.offset);
        return fail(source, { pos: lenientErr.pos ?? null, message: lenientErr.message }, offset);
      }
    }
  };

  const result = read(raw, 0);
  if (result.fail) return result;
  let { value, usedFix } = result;
  let repaired = result.repaired ?? null;

  const { value: inner, unwrapped, error, repaired: layerRepair } = unwrapStringified(value, shouldFix);
  // When the quoted text appears verbatim in the input (no escapes), errors
  // point at the real spot in the input instead of inside the string.
  if (error) return fail(error.source, error, raw.indexOf(error.source));
  if (unwrapped) {
    value = inner;
    usedFix = true;
  }
  if (layerRepair) repaired = { ...layerRepair, offset: raw.indexOf(layerRepair.source) };

  return { warnings, ok: { value, usedFix, joined: Boolean(result.joined), repaired } };
}

// Sets a property even when it's named __proto__ (valid as a JSON key).
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

// Worker messages are structured clones, which turn RawNumber into a plain
// object and can't carry functions (repair results include a `shift`
// helper). pack() replaces, in place, each RawNumber in `result` with its
// source text, noting where it was, and drops functions; unpack() puts the
// RawNumbers back. Maps (repair marks) hold no values and are left alone.
export function pack(result) {
  const raws = [];
  const seen = new Set();
  const visit = (obj, path) => {
    if (obj === null || typeof obj !== "object" || obj instanceof Map || seen.has(obj)) return;
    seen.add(obj);
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "function") {
        delete obj[key];
      } else if (v instanceof RawNumber) {
        setOwn(obj, key, v.source);
        raws.push([[...path, key], v.source]);
      } else if (v !== null && typeof v === "object") {
        visit(v, [...path, key]);
      }
    }
  };
  visit(result, []);
  return { result, raws };
}

export function unpack({ result, raws }) {
  raws.forEach(([path, source]) => {
    const parent = path.slice(0, -1).reduce((obj, key) => obj[key], result);
    setOwn(parent, path[path.length - 1], new RawNumber(source));
  });
  return result;
}
