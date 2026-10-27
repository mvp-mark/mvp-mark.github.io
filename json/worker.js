// Runs analyze() off the page for big inputs (see analyzeInWorker in app.js).
import { analyze, pack } from "./analyze.js";

self.addEventListener("message", ({ data }) => {
  const { id, raw, options } = data;
  try {
    self.postMessage({ id, packed: pack(analyze(raw, options)) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
});
