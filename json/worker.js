// Runs analyze() off the page for big inputs (see analyzeInWorker in app.js).
// Each job carries the page's locale, for the messages it produces.
import { analyze, pack } from "./analyze.js";
import { setLocale } from "./i18n.js";

self.addEventListener("message", ({ data }) => {
  const { id, raw, options } = data;
  setLocale(options.lang);
  try {
    self.postMessage({ id, packed: pack(analyze(raw, options)) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
});
