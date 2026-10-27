// Tests for analyze.js and tree.js. Run with `npm test` from the json/ folder.
import { strict as assert } from "assert";
import v8 from "v8";
import { analyze, pack, unpack } from "../analyze.js";
import { RawNumber, stringify } from "../parser.js";
import { formatPath, searchValue } from "../tree.js";
import { run, test } from "./harness.js";

const options = (extra = {}) => ({ spec: "rfc8259", fix: true, indent: "  ", reformatted: false, ...extra });

// What a worker message goes through (Node's structured clone).
const clone = (value) => v8.deserialize(v8.serialize(value));

test("analyze returns the value of valid JSON", () => {
  const { ok, fail } = analyze('{"a": [1, 2]}', options());
  assert.equal(fail, undefined);
  assert.deepEqual(ok, { value: { a: [1, 2] }, usedFix: false, joined: false, repaired: null });
});

test("analyze applies Fix JSON and reports missing commas", () => {
  assert.deepEqual(analyze("{a: 'x', // c\n}", options()).ok.value, { a: "x" });
  const { ok } = analyze('{"a": 1 "b": 2}', options());
  assert.equal(ok.repaired.fixed, '{"a": 1, "b": 2}');
  assert.equal(ok.repaired.offset, 0);
});

test("analyze joins loose objects and unwraps stringified JSON", () => {
  const joined = analyze('{"a": 1} {"a": 2}', options()).ok;
  assert.equal(joined.joined, true);
  assert.deepEqual(joined.value, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(analyze('"{\\"a\\": 1}"', options()).ok.value, { a: 1 });
});

test("analyze closes missing brackets instead of failing", () => {
  const { fail } = analyze('{"a": [1, 2}', options());
  assert.ok(fail.closed);
  assert.equal(fail.reformat, null);
});

test("analyze re-indents hard-to-edit input once, then reports the error", () => {
  const raw = '{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8, "i": 9, "j": 10, "k": x}';
  const first = analyze(raw, options({ fix: false })).fail;
  assert.ok(first.reformat.startsWith('{\n  "a": 1,\n'));
  const second = analyze(first.reformat, options({ fix: false, reformatted: true })).fail;
  assert.equal(second.reformat, null);
  assert.match(second.info.message, /sem aspas/);
});

test("pack/unpack keep RawNumber and marks across a structured clone", () => {
  const result = analyze('{"id": 12345678901234567890, "n": [1.0, 2], "a": [1, 2}', options());
  const back = unpack(clone(pack(result)));
  assert.equal(stringify(back.fail.closed.value), '{"id":12345678901234567890,"n":[1.0,2],"a":[1,2]}');
  assert.ok(back.fail.closed.value.id instanceof RawNumber);
  assert.ok(back.fail.closed.marks instanceof Map);
});

test("pack/unpack handle a RawNumber under a __proto__ key", () => {
  const value = JSON.parse('{"__proto__": 0}'); // an own property, as parsed JSON has
  Object.defineProperty(value, "__proto__", { value: new RawNumber("1.0"), enumerable: true, configurable: true, writable: true });
  const back = unpack(clone(pack({ ok: { value } })));
  assert.equal(stringify(back.ok.value), '{"__proto__":1.0}');
});

test("formatPath writes JSONPath-style paths", () => {
  assert.equal(formatPath([]), "$");
  assert.equal(formatPath(["users", 3, "name"]), "$.users[3].name");
  assert.equal(formatPath(["com espaço", "a\"b", "_ok$1"]), '$["com espaço"]["a\\"b"]._ok$1');
});

test("searchValue finds keys and values in document order", () => {
  const value = { Nome: "Ana", tags: ["nomeado", 1], idade: new RawNumber("31.0") };
  const { matches, truncated } = searchValue(value, "nOm");
  assert.equal(truncated, false);
  assert.deepEqual(matches, [
    { keys: ["Nome"], steps: [0], on: "key" },
    { keys: ["tags", 0], steps: [1, 0], on: "value" },
  ]);
  assert.deepEqual(searchValue(value, "31.0").matches[0].steps, [2]);
  assert.deepEqual(searchValue(null, "null").matches, [{ keys: [], steps: [], on: "value" }]);
  assert.deepEqual(searchValue(value, "").matches, []);
});

test("searchValue stops at the limit", () => {
  const { matches, truncated } = searchValue(Array(10).fill("x"), "x", 3);
  assert.equal(matches.length, 3);
  assert.equal(truncated, true);
});

run();
