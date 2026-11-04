// Tests for selection.js. Run with `npm test` from the json/ folder.
import { strict as assert } from "assert";
import { describeSelection } from "../selection.js";
import { run, test } from "./harness.js";

test("describeSelection counts characters, UTF-8 bytes and lines", () => {
  const info = describeSelection('"ação 😀"\n');
  assert.deepEqual([info.chars, info.bytes, info.lines], [9, 14, 1]);
  assert.equal(describeSelection("a\nb\nc").lines, 3);
});

test("describeSelection describes whole JSON values", () => {
  assert.deepEqual(describeSelection('{"a": {"b": [1]}, "c": 2}').json, { type: "object", count: 2, depth: 3 });
  assert.deepEqual(describeSelection("  [1, 2, 3],").json, { type: "array", count: 3, depth: 1 });
  assert.deepEqual(describeSelection('"olá"').json, { type: "string", count: 3 });
  assert.deepEqual(describeSelection('"{\\"a\\": 1}"').json, { type: "string", count: 8, nested: "object" });
  assert.deepEqual(describeSelection("12345678901234567890.50").json, { type: "number" });
  assert.deepEqual(describeSelection("null").json, { type: "null" });
  assert.equal(describeSelection('{"a": ').json, null);
  assert.equal(describeSelection("abc").json, null);
});

test("describeSelection reads runs of members or items", () => {
  assert.deepEqual(describeSelection('"a": 1,\n  "b": {"c": true},').json, { type: "members", count: 2, depth: 1 });
  assert.deepEqual(describeSelection("1, 2").json, { type: "items", count: 2, depth: 0 });
});

test("describeSelection reads Unix timestamps as dates", () => {
  assert.equal(describeSelection("1700000000").date.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(describeSelection("1700000000123").date.toISOString(), "2023-11-14T22:13:20.123Z");
  assert.equal(describeSelection("42").date, null);
  assert.equal(describeSelection('"1700000000"').date, null);
  assert.equal(describeSelection("1700000000.5").date, null);
});

test("describeSelection handles deep nesting", () => {
  assert.equal(describeSelection("[".repeat(5000) + "]".repeat(5000)).json.depth, 4999);
});

run();
