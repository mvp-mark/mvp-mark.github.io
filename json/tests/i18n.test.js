// Tests for i18n.js and the dictionaries in locales/. Run with `npm test`
// from the json/ folder.
import { strict as assert } from "assert";
import { LOCALES, matchLocale, setLocale, t } from "../i18n.js";
import { findJsonError, validateSpec } from "../parser.js";
import { run, test } from "./harness.js";

const source = LOCALES.pt.messages;

// The {name} placeholders a message uses (all forms of a plural).
const placeholders = (message) =>
  [...new Set([].concat(...(typeof message === "object" ? Object.values(message) : [message])
    .map((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))))].sort();

test("every dictionary has the same keys and placeholders as pt", () => {
  for (const [code, { messages }] of Object.entries(LOCALES)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(source).sort(), `chaves de ${code}`);
    for (const key of Object.keys(source)) {
      assert.equal(typeof messages[key], typeof source[key], `${code}: ${key}`);
      // Every plural has one and other; extra forms only from Intl.PluralRules.
      if (typeof source[key] === "object") {
        const forms = new Intl.PluralRules(LOCALES[code].tag).resolvedOptions().pluralCategories;
        assert.ok("one" in messages[key] && "other" in messages[key], `${code}: ${key}`);
        for (const form of Object.keys(messages[key])) assert.ok(form === "one" || forms.includes(form), `${code}: ${key}.${form}`);
      }
      assert.deepEqual(placeholders(messages[key]), placeholders(source[key]), `${code}: ${key}`);
    }
  }
});

test("t fills placeholders, picks plurals and falls back", () => {
  setLocale("en");
  assert.equal(t("tree.items", { count: 1 }), "1 item");
  assert.equal(t("tree.items", { count: 3 }), "3 items");
  setLocale("pl");
  assert.deepEqual([1, 2, 5, 12, 22, 0].map((count) => t("tree.items", { count })),
    ["1 element", "2 elementy", "5 elementów", "12 elementów", "22 elementy", "0 elementów"]);
  setLocale("pt");
  assert.equal(t("tree.items", { count: 0 }), "0 itens");
  setLocale("en");
  assert.equal(t("parse.neverClosed", { open: "{", close: "}" }), "This '{' is never closed (the '}' is missing).");
  assert.equal(t("chave.inexistente"), "chave.inexistente");
  assert.equal(setLocale("xx"), "pt");
  assert.equal(t("status.valid"), "JSON válido.");
});

test("matchLocale picks the first supported browser language", () => {
  assert.equal(matchLocale(["ru-RU", "es-AR", "en"]), "es");
  assert.equal(matchLocale(["zh-TW"]), "zh");
  assert.equal(matchLocale(["PT-br"]), "pt");
  assert.equal(matchLocale(["pl-PL"]), "pl");
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
