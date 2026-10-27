// Tests for i18n.js and the dictionaries in locales/. Run with `npm test`
// from the json/ folder.
import { strict as assert } from "assert";
import { LOCALES, matchLocale, setLocale, t } from "../i18n.js";
import { findJsonError, validateSpec } from "../parser.js";
import { run, test } from "./harness.js";

const source = LOCALES.pt.messages;

// The {name} placeholders a message uses (all forms of a plural).
const placeholders = (message) =>
  [...new Set([].concat(...(typeof message === "object" ? [message.one, message.other] : [message])
    .map((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))))].sort();

test("every dictionary has the same keys and placeholders as pt", () => {
  for (const [code, { messages }] of Object.entries(LOCALES)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(source).sort(), `chaves de ${code}`);
    for (const key of Object.keys(source)) {
      assert.equal(typeof messages[key], typeof source[key], `${code}: ${key}`);
      assert.deepEqual(placeholders(messages[key]), placeholders(source[key]), `${code}: ${key}`);
    }
  }
});

test("t fills placeholders, picks plurals and falls back", () => {
  setLocale("en");
  assert.equal(t("tree.items", { count: 1 }), "1 item");
  assert.equal(t("tree.items", { count: 3 }), "3 items");
  assert.equal(t("parse.neverClosed", { open: "{", close: "}" }), "This '{' is never closed (the '}' is missing).");
  assert.equal(t("chave.inexistente"), "chave.inexistente");
  assert.equal(setLocale("xx"), "pt");
  assert.equal(t("status.valid"), "JSON válido.");
});

test("matchLocale picks the first supported browser language", () => {
  assert.equal(matchLocale(["ru-RU", "es-AR", "en"]), "es");
  assert.equal(matchLocale(["zh-TW"]), "zh");
  assert.equal(matchLocale(["PT-br"]), "pt");
  assert.equal(matchLocale(["ru"]), null);
});

test("parser messages follow the locale", () => {
  setLocale("en");
  assert.deepEqual(findJsonError('{"a": 1,}'), { pos: 7, message: "Extra comma before '}'." });
  assert.deepEqual(validateSpec("{a: 1}", "rfc8259"), ["Object keys must be in double quotes."]);
  setLocale("es");
  assert.match(findJsonError('{"a": True}').message, /usa true/);
  setLocale("ja");
  assert.equal(findJsonError('{"a": 1,}').message, "'}' の前に余分なカンマがあります。");
  setLocale("pt");
});

run();
