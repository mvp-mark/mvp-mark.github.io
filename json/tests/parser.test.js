// Tests for parser.js. Run with `npm test` (or `node tests/parser.test.js`)
// from the json/ folder; no dependencies.
import { strict as assert } from "assert";
import { run, test } from "./harness.js";
import {
  RawNumber,
  autoCloseBrackets,
  findJsonError,
  formatLoose,
  insertCommas,
  parseJson,
  parseLenient,
  repairNestedKeys,
  scanBrackets,
  stringify,
  stripComments,
  unwrapStringified,
  validateSpec,
  wrapConcatenated,
} from "../parser.js";

// Formatted text of what the lenient parser read, compact.
const lenient = (text) => stringify(parseLenient(text));

test("stringify matches JSON.stringify for every indentation", () => {
  const value = { a: [1, "x", null, true, { b: [] }, {}], "c\"d": { e: -0.5, f: "é\n" }, g: [] };
  for (const indent of [null, " ", "  ", "   ", "    ", "\t"]) {
    assert.equal(stringify(value, indent), JSON.stringify(value, null, indent ?? undefined));
  }
  assert.equal(stringify("só texto"), '"só texto"');
  assert.equal(stringify([]), "[]");
});

test("parseJson returns plain values when no number would change", () => {
  const value = parseJson('{"a": 1, "b": [2.5, -3, 4e-7], "c": "12345678901234567890"}');
  assert.deepEqual(value, { a: 1, b: [2.5, -3, 4e-7], c: "12345678901234567890" });
});

test("parseJson keeps numbers JavaScript would change", () => {
  const text = '{"id": 12345678901234567890, "price": 1.50, "one": 1.0, "exp": 1E5, "huge": 1e400, "n": 2}';
  const value = parseJson(text);
  assert.ok(value.id instanceof RawNumber);
  assert.equal(value.n, 2);
  assert.equal(stringify(value), '{"id":12345678901234567890,"price":1.50,"one":1.0,"exp":1E5,"huge":1e400,"n":2}');
});

test("parseJson throws like JSON.parse on invalid JSON", () => {
  assert.throws(() => parseJson("{a: 1}"), SyntaxError);
  assert.throws(() => parseJson('{"a": 1,}'), SyntaxError);
});

test("parseLenient reads valid JSON exactly like JSON.parse", () => {
  const text = '{"s": "a\\"b\\\\c\\/d\\b\\f\\n\\r\\t\\u00e9\\ud83d\\ude00", "n": [0, -1.5, 2e-7, true, false, null], "k": {"": {}}}';
  assert.deepEqual(parseLenient(text), JSON.parse(text));
});

test("parseLenient accepts unquoted keys and values", () => {
  assert.equal(
    lenient("{status:processando, created_at:2026-08-20T09:01:08Z, url: http://x.com/a, msg: Olá mundo, zip: 01234}"),
    '{"status":"processando","created_at":"2026-08-20T09:01:08Z","url":"http://x.com/a","msg":"Olá mundo","zip":"01234"}'
  );
});

test("parseLenient accepts Python keywords, trailing commas and empty values", () => {
  assert.equal(lenient("{a: True, b: False, c: None, d: [1, 2,], e:,}"), '{"a":true,"b":false,"c":null,"d":[1,2],"e":""}');
});

test("parseLenient decodes escapes in single and double quotes", () => {
  assert.deepEqual(parseLenient(`{'a': 'it\\'s', "b": "x\\ny", "c": "\\u00e9\\t"}`), { a: "it's", b: "x\ny", c: "é\t" });
});

test("parseLenient keeps unknown escapes as written (Windows paths)", () => {
  assert.deepEqual(parseLenient(`{path: 'C:\\Users\\ana', bad: "\\u12"}`), { path: "C:\\Users\\ana", bad: "\\u12" });
});

test("parseLenient ignores comments but not comment-like text in strings", () => {
  const value = parseLenient(`{
    // comentário
    a: "foo // bar", /* bloco */
    b: 'src/**/*.js',
    c: 1 // fim
  }`);
  assert.deepEqual(value, { a: "foo // bar", b: "src/**/*.js", c: 1 });
});

test("parseLenient keeps __proto__ as an ordinary key", () => {
  const value = parseLenient('{__proto__: {x: 1}, y: 2}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(stringify(value), '{"__proto__":{"x":1},"y":2}');
});

test("parseLenient keeps numbers JavaScript would change", () => {
  assert.equal(lenient("{id: 12345678901234567890, v: 1.0, n: 3}"), '{"id":12345678901234567890,"v":1.0,"n":3}');
});

test("parseLenient reports where an unclosed bracket was opened", () => {
  assert.throws(() => parseLenient('{"a": [1, 2'), (err) => err.pos === 6);
});

// Value read and the text with the assumed commas written in.
const withCommas = (text) => {
  const report = {};
  const value = stringify(parseLenient(text, report));
  return [value, insertCommas(text, report.missingCommas)];
};

test("parseLenient assumes a missing comma before an object key", () => {
  assert.deepEqual(withCommas('{"a": 1 "b": 2}'), ['{"a":1,"b":2}', '{"a": 1, "b": 2}']);
  assert.deepEqual(withCommas("{a: 1 b: true c: 3}"), ['{"a":1,"b":true,"c":3}', "{a: 1, b: true, c: 3}"]);
  assert.deepEqual(withCommas('{a: "x" b: {c: 1} d: 2}'), ['{"a":"x","b":{"c":1},"d":2}', '{a: "x", b: {c: 1}, d: 2}']);
  assert.deepEqual(withCommas("{\n  a: texto livre\n  b: 2 // fim\n  c: 3\n}"), [
    '{"a":"texto livre","b":2,"c":3}',
    "{\n  a: texto livre,\n  b: 2, // fim\n  c: 3\n}",
  ]);
});

test("parseLenient assumes a missing comma between array items", () => {
  assert.deepEqual(withCommas("[1 2 3]"), ["[1,2,3]", "[1, 2, 3]"]);
  assert.deepEqual(withCommas('[{"a":1} {"a":2}]'), ['[{"a":1},{"a":2}]', '[{"a":1}, {"a":2}]']);
  assert.deepEqual(withCommas('[\n  1\n  dois\n  "três"\n]'), ['[1,"dois","três"]', '[\n  1,\n  dois,\n  "três"\n]']);
});

test("parseLenient keeps free text with spaces and colons as one value", () => {
  const text = '{msg: Total: 5, t: 2026-08-20 09:01:08, s: Status ok: sim, q: Ele disse "oi", u: http://x.com/a, l: [Olá mundo]}';
  const report = {};
  assert.equal(
    stringify(parseLenient(text, report)),
    '{"msg":"Total: 5","t":"2026-08-20 09:01:08","s":"Status ok: sim","q":"Ele disse \\"oi\\"","u":"http://x.com/a","l":["Olá mundo"]}'
  );
  assert.deepEqual(report.missingCommas, []);
});

test("stripComments keeps positions and leaves strings alone", () => {
  const text = '{"u": "a//b", /* c */ "v": 1} // fim\n';
  const stripped = stripComments(text);
  assert.equal(stripped.length, text.length);
  assert.equal(stripped, '{"u": "a//b",         "v": 1}       \n');
});

test("validateSpec has no warnings for valid JSON with comment-like strings", () => {
  const text = JSON.stringify({ site: "https://x.com", a: "x, }", b: "it's 'q'", c: "{a: 1}", d: "/* nada */" });
  for (const spec of ["rfc8259", "rfc4627", "ecma404"]) assert.deepEqual(validateSpec(text, spec), []);
});

test("validateSpec flags comments, trailing commas, single quotes and bare keys", () => {
  assert.deepEqual(validateSpec("{a: 'x', // c\n b: [1,],}", "rfc8259"), [
    "Comentários não são permitidos por esta especificação.",
    "Vírgulas finais (trailing commas) não são permitidas.",
    "Aspas simples não são permitidas; use aspas duplas.",
    "Chaves de objeto devem estar entre aspas duplas.",
  ]);
  assert.deepEqual(validateSpec("{a: 'x'}", "json5"), []);
  assert.deepEqual(validateSpec('"texto"', "rfc4627"), ["RFC 4627 exige que o valor de nível superior seja um objeto ou array."]);
});

test("scanBrackets skips brackets inside strings and comments", () => {
  assert.deepEqual(scanBrackets('{"x": "[}", /* { */ "y": []}').map((b) => b.char + b.pos), ["{0", "[25", "]26", "}27"]);
});

test("unwrapStringified peels JSON encoded as a string", () => {
  const { value, unwrapped } = unwrapStringified(parseJson(JSON.stringify(JSON.stringify({ a: [1] }))), false);
  assert.equal(unwrapped, true);
  assert.deepEqual(value, { a: [1] });
});

test("wrapConcatenated groups loose objects into an array", () => {
  assert.deepEqual(JSON.parse(wrapConcatenated('{"a":1} {"a":2},\n{"a":3}')), [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.equal(wrapConcatenated('{"a":1}'), null);
  assert.equal(wrapConcatenated('{"a":1} lixo {"a":2}'), null);
});

test("autoCloseBrackets adds missing closers", () => {
  const closed = autoCloseBrackets('{"a": [1, 2', false);
  assert.equal(closed.fixed, '{"a": [1, 2]}');
  assert.deepEqual(closed.value, { a: [1, 2] });
});

test("repairNestedKeys wraps a key that gets another key as value", () => {
  const fix = repairNestedKeys('{teste: teste1: "teste2"}', true);
  assert.equal(fix.fixed, '{teste: {teste1: "teste2"}}');
  assert.deepEqual(fix.value, { teste: { teste1: "teste2" } });
});

test("findJsonError explains common mistakes", () => {
  assert.deepEqual(findJsonError('{"a": 1,}'), { pos: 7, message: "Vírgula sobrando antes de '}'." });
  assert.equal(findJsonError("{a: 1}").pos, 1);
  assert.match(findJsonError('{"a": True}').message, /use true/);
  assert.equal(findJsonError('{"a": 1}'), null);
});

test("formatLoose re-indents text that isn't valid JSON", () => {
  assert.equal(formatLoose("{a:1,b:[1,2],c:{d:x}}", "  "), "{\n  a: 1,\n  b: [\n    1,\n    2\n  ],\n  c: {\n    d: x\n  }\n}");
});

run();
