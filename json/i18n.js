// Translations. Every user-visible text comes from t(key, params), looked up
// in the current locale's dictionary (locales/*.js), falling back to
// Portuguese, the language the texts are written in first. Used by the page
// and by parser.js, also inside worker.js (which gets the locale with each
// job). To add a language, add a dictionary with the same keys as
// locales/pt.js and list it in LOCALES (tests check the keys match).
//
// A value is a string, where {name} is replaced by params.name, or
// { one, other } picked by params.count === 1.

import de from "./locales/de.js";
import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import it from "./locales/it.js";
import ja from "./locales/ja.js";
import pt from "./locales/pt.js";
import zh from "./locales/zh.js";

// code -> { name (in that language), tag (for Intl/<html lang>), messages }
export const LOCALES = {
  pt: { name: "Português", tag: "pt-BR", messages: pt },
  en: { name: "English", tag: "en", messages: en },
  es: { name: "Español", tag: "es", messages: es },
  fr: { name: "Français", tag: "fr", messages: fr },
  de: { name: "Deutsch", tag: "de", messages: de },
  it: { name: "Italiano", tag: "it", messages: it },
  ja: { name: "日本語", tag: "ja", messages: ja },
  // Simplified Chinese, also offered to zh-TW/zh-HK browsers for now.
  zh: { name: "简体中文", tag: "zh-CN", messages: zh },
};

export const DEFAULT_LOCALE = "pt";

let current = DEFAULT_LOCALE;

export function setLocale(code) {
  current = Object.prototype.hasOwnProperty.call(LOCALES, code) ? code : DEFAULT_LOCALE;
  return current;
}

export const getLocale = () => current;

// BCP 47 tag of the current locale, for toLocaleString() and <html lang>.
export const localeTag = () => LOCALES[current].tag;

// The supported locale that best matches a list of browser languages
// (navigator.languages), or null.
export function matchLocale(languages) {
  for (const language of languages) {
    const code = String(language).toLowerCase().split("-")[0];
    if (Object.prototype.hasOwnProperty.call(LOCALES, code)) return code;
  }
  return null;
}

// A message in a given locale (the page's other texts stay as they are).
export function tIn(code, key, params = {}) {
  let message = (LOCALES[code] ?? LOCALES[DEFAULT_LOCALE]).messages[key] ?? pt[key];
  if (message === undefined) return key;
  if (typeof message === "object") message = params.count === 1 ? message.one : message.other;
  return message.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export const t = (key, params) => tIn(current, key, params);
