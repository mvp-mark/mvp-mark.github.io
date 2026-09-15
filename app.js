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

  // Strips line/block comments before lenient parsing.
  function stripComments(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const JSON_NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  function coerceBareToken(raw) {
    const token = raw.trim();
    if (token === "true" || token === "True") return true;
    if (token === "false" || token === "False") return false;
    if (token === "null" || token === "None") return null;
    if (JSON_NUMBER_RE.test(token)) return Number(token);
    return token; // leading zeros, dates, free text, etc. stay as strings
  }

  // Tolerant parser for JSON-like text where keys and/or string values are
  // missing quotes (e.g. {status:processando,created_at:2026-08-20T09:01:08Z}).
  // Builds the JS value directly instead of trying to patch the text with
  // regex, since bare values can themselves contain ':' (timestamps) or
  // spaces/accents (free text) that a text-level fix can't disambiguate.
  function parseLenient(text) {
    const s = stripComments(text);
    let i = 0;

    function skipWs() {
      while (i < s.length && /\s/.test(s[i])) i++;
    }

    function error(msg) {
      throw new SyntaxError(`${msg} (posição ${i})`);
    }

    function readQuotedString(quote) {
      let out = "";
      i++; // opening quote
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\" && i + 1 < s.length) {
          out += s[i + 1] === quote ? quote : s[i] + s[i + 1];
          i += 2;
        } else {
          out += s[i];
          i++;
        }
      }
      if (s[i] !== quote) error("String não terminada");
      i++; // closing quote
      return out;
    }

    function readBareUntil(stopChars) {
      let start = i;
      while (i < s.length && !stopChars.has(s[i])) i++;
      return s.slice(start, i).trim();
    }

    function parseValue() {
      skipWs();
      const c = s[i];
      if (c === "{") return parseObject();
      if (c === "[") return parseArray();
      if (c === '"' || c === "'") return readQuotedString(c);
      const token = readBareUntil(new Set([",", "}", "]"]));
      if (token === "") error("Valor esperado");
      return coerceBareToken(token);
    }

    function parseKey() {
      skipWs();
      const c = s[i];
      if (c === '"' || c === "'") return readQuotedString(c);
      const token = readBareUntil(new Set([":"]));
      if (token === "") error("Chave esperada");
      return token;
    }

    function parseObject() {
      const obj = {};
      i++; // {
      skipWs();
      if (s[i] === "}") { i++; return obj; }
      while (true) {
        const key = parseKey();
        skipWs();
        if (s[i] !== ":") error("Esperado ':' após a chave");
        i++;
        const value = parseValue();
        obj[key] = value;
        skipWs();
        if (s[i] === ",") { i++; skipWs(); if (s[i] === "}") { i++; break; } continue; }
        if (s[i] === "}") { i++; break; }
        error("Esperado ',' ou '}'");
      }
      return obj;
    }

    function parseArray() {
      const arr = [];
      i++; // [
      skipWs();
      if (s[i] === "]") { i++; return arr; }
      while (true) {
        arr.push(parseValue());
        skipWs();
        if (s[i] === ",") { i++; skipWs(); if (s[i] === "]") { i++; break; } continue; }
        if (s[i] === "]") { i++; break; }
        error("Esperado ',' ou ']'");
      }
      return arr;
    }

    skipWs();
    const result = parseValue();
    skipWs();
    if (i < s.length) error("Conteúdo inesperado após o valor principal");
    return result;
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

    let parsed;
    let usedFix = false;
    try {
      parsed = JSON.parse(raw);
    } catch (strictErr) {
      if (!shouldFix) {
        outputEl.value = "";
        setStatus("Erro ao interpretar o JSON: " + strictErr.message, "error");
        return;
      }
      try {
        parsed = parseLenient(raw);
        usedFix = true;
      } catch (lenientErr) {
        outputEl.value = "";
        setStatus("Erro ao interpretar o JSON: " + lenientErr.message, "error");
        return;
      }
    }

    const indent = indentFor(templateEl.value);
    outputEl.value = indent === null
      ? JSON.stringify(parsed)
      : JSON.stringify(parsed, null, indent);

    const notes = [];
    if (usedFix) {
      notes.push("Correções automáticas aplicadas (Fix JSON): chaves/valores sem aspas, comentários, vírgulas finais etc.");
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
