(function () {
  const inputEl = document.getElementById("input");
  const outputEl = document.getElementById("output");
  const templateEl = document.getElementById("template");
  const specEl = document.getElementById("spec");
  const fixEl = document.getElementById("fixJson");
  const statusEl = document.getElementById("statusBox");
  const formatBtn = document.getElementById("formatBtn");
  const clearBtn = document.getElementById("clearBtn");
  const openFileBtn = document.getElementById("openFileBtn");
  const fileInput = document.getElementById("fileInput");
  const copyBtn = document.getElementById("copyBtn");
  const fixHelpBtn = document.getElementById("fixHelpBtn");
  const fixHelpPopover = document.getElementById("fixHelpPopover");
  const fixHelpClose = document.getElementById("fixHelpClose");

  function indentFor(template) {
    switch (template) {
      case "compact": return null;
      case "tab": return "\t";
      case "1": return " ";
      case "2": return "  ";
      case "3": return "   ";
      case "4": return "    ";
      default: return "   ";
    }
  }

  // Repairs common JSON authoring mistakes so JSON.parse can succeed.
  function fixJsonText(text) {
    let out = text;

    // Strip line and block comments (outside of strings is not tracked
    // precisely, but this covers the vast majority of real-world cases).
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");

    // Python-style literals.
    out = out.replace(/\bTrue\b/g, "true")
             .replace(/\bFalse\b/g, "false")
             .replace(/\bNone\b/g, "null");

    // Single-quoted strings -> double-quoted strings.
    out = out.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => {
      const escaped = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
      return `"${escaped}"`;
    });

    // Unquoted object keys: { key: 1 } -> { "key": 1 }
    out = out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');

    // Trailing commas before a closing bracket.
    out = out.replace(/,(\s*[}\]])/g, "$1");

    return out;
  }

  // Heuristic conformance checks against the raw (pre-fix) input.
  function validateSpec(raw, spec) {
    const warnings = [];
    const trimmed = raw.trim();

    if (spec === "rfc4627") {
      if (trimmed && !/^[{\[]/.test(trimmed)) {
        warnings.push(
          "RFC 4627 exige que o valor de nível superior seja um objeto ou array."
        );
      }
    }

    if (spec === "rfc8259" || spec === "ecma404" || spec === "rfc4627") {
      if (/\/\/|\/\*/.test(raw)) {
        warnings.push("Comentários não são permitidos por esta especificação.");
      }
      if (/,\s*[}\]]/.test(raw)) {
        warnings.push("Vírgulas finais (trailing commas) não são permitidas.");
      }
      if (/'[^']*'/.test(raw)) {
        warnings.push("Aspas simples não são permitidas; use aspas duplas.");
      }
      if (/[{,]\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:/.test(raw)) {
        warnings.push("Chaves de objeto devem estar entre aspas duplas.");
      }
    }

    return warnings;
  }

  function setStatus(message, kind) {
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.className = "status";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = "status " + (kind || "");
  }

  function format() {
    const raw = inputEl.value;
    if (!raw.trim()) {
      outputEl.value = "";
      setStatus("");
      return;
    }

    const spec = specEl.value;
    const shouldFix = fixEl.checked;
    const warnings = validateSpec(raw, spec);
    const textToParse = shouldFix ? fixJsonText(raw) : raw;

    let parsed;
    try {
      parsed = JSON.parse(textToParse);
    } catch (err) {
      outputEl.value = "";
      setStatus("Erro ao interpretar o JSON: " + err.message, "error");
      return;
    }

    const indent = indentFor(templateEl.value);
    outputEl.value = indent === null
      ? JSON.stringify(parsed)
      : JSON.stringify(parsed, null, indent);

    const notes = [];
    if (shouldFix && textToParse !== raw) {
      notes.push("Correções automáticas aplicadas (Fix JSON).");
    }
    notes.push(...warnings);

    setStatus(notes.length ? notes.join("\n") : "JSON válido.", notes.length ? "error" : "ok");
  }

  formatBtn.addEventListener("click", format);
  [templateEl, specEl, fixEl].forEach((el) =>
    el.addEventListener("change", () => {
      if (inputEl.value.trim()) format();
    })
  );

  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    outputEl.value = "";
    setStatus("");
    inputEl.focus();
  });

  openFileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      inputEl.value = String(reader.result);
      format();
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  copyBtn.addEventListener("click", async () => {
    if (!outputEl.value) return;
    try {
      await navigator.clipboard.writeText(outputEl.value);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => (copyBtn.textContent = "Copiar"), 1200);
    } catch {
      outputEl.select();
      document.execCommand("copy");
    }
  });

  fixHelpBtn.addEventListener("click", () => (fixHelpPopover.hidden = false));
  fixHelpClose.addEventListener("click", () => (fixHelpPopover.hidden = true));

  inputEl.addEventListener("input", () => {
    if (!inputEl.value.trim()) {
      outputEl.value = "";
      setStatus("");
    }
  });
})();
