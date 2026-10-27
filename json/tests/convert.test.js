// Tests for convert.js and the sortKeys/diffValues helpers in tree.js. Run
// with `npm test` from the json/ folder.
import { strict as assert } from "assert";
import { toCsv, toYaml } from "../convert.js";
import { RawNumber, parseJson } from "../parser.js";
import { diffValues, sortKeys } from "../tree.js";
import { run, test } from "./harness.js";

test("toYaml writes block YAML, quoting what wouldn't read back as text", () => {
  const value = parseJson('{"nome": "Ana", "idade": 31.0, "ativo": true, "nada": null, "tags": ["a", "yes", "1", ""], ' +
    '"end": {"rua": "R. 1: centro", "linhas": "a\\nb"}, "vazio": {}, "lista": [], "grupos": [{"id": 1, "x": [1, [2, 3]]}, []]}');
  assert.equal(toYaml(value), [
    "nome: Ana",
    "idade: 31.0",
    "ativo: true",
    "nada: null",
    "tags:",
    "  - a",
    '  - "yes"',
    '  - "1"',
    '  - ""',
    "end:",
    '  rua: "R. 1: centro"',
    '  linhas: "a\\nb"',
    "vazio: {}",
    "lista: []",
    "grupos:",
    "  - id: 1",
    "    x:",
    "      - 1",
    "      - - 2",
    "        - 3",
    "  - []",
    "",
  ].join("\n"));
  assert.equal(toYaml("texto"), "texto\n");
  assert.equal(toYaml([]), "[]\n");
  assert.equal(toYaml({ "com espaço": 1, "a:b": 2 }), 'com espaço: 1\n"a:b": 2\n');
});

test("toCsv writes a header from every key of an array of objects", () => {
  const value = parseJson('[{"id": 1, "nome": "Ana, Maria"}, {"id": 2.50, "extra": {"a": "\\"x\\""}, "nome": null}]');
  assert.equal(toCsv(value), 'id,nome,extra\r\n1,"Ana, Maria",\r\n2.50,,"{""a"":""\\""x\\""""}"\r\n');
});

test("toCsv writes arrays of arrays/values as rows and rejects non-arrays", () => {
  assert.equal(toCsv([[1, "a b"], [" x", true]]), '1,a b\r\n" x",true\r\n');
  assert.equal(toCsv(["a", 1, null]), "a\r\n1\r\n\r\n");
  assert.equal(toCsv([]), "");
  assert.equal(toCsv({ a: 1 }), null);
});

test("sortKeys orders object keys at every level and keeps arrays", () => {
  const sorted = sortKeys({ b: 1, a: [{ d: 1, c: new RawNumber("1.0") }], C: null });
  assert.deepEqual(Object.keys(sorted), ["C", "a", "b"]);
  assert.deepEqual(Object.keys(sorted.a[0]), ["c", "d"]);
  assert.ok(sorted.a[0].c instanceof RawNumber);
  const proto = sortKeys(JSON.parse('{"__proto__": {"z": 1, "y": 2}}'));
  assert.deepEqual(Object.keys(proto), ["__proto__"]);
  assert.deepEqual(Object.keys(proto.__proto__), ["y", "z"]);
});

test("diffValues lists added, removed and changed values", () => {
  const before = parseJson('{"a": 1, "b": [1, 2, 3], "c": {"d": "x"}, "e": 1.0, "f": [1]}');
  const after = parseJson('{"a": 1, "b": [1, 5], "c": {"d": "x", "g": true}, "e": 1, "f": {"0": 1}}');
  assert.deepEqual(diffValues(before, after).diffs.map(({ keys, kind }) => [keys, kind]), [
    [["b", 1], "changed"],
    [["b", 2], "removed"],
    [["c", "g"], "added"],
    [["e"], "changed"],
    [["f"], "changed"],
  ]);
  assert.deepEqual(diffValues({ a: [1] }, { a: [1] }).diffs, []);
  assert.equal(diffValues([1, 2, 3], [4, 5, 6], 2).truncated, true);
});

run();
