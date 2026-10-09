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
  const expandAllBtn = document.getElementById("expandAllBtn");
  const collapseAllBtn = document.getElementById("collapseAllBtn");
  const fixHelpBtn = document.getElementById("fixHelpBtn");
  const fixHelpPopover = document.getElementById("fixHelpPopover");
  const fixHelpClose = document.getElementById("fixHelpClose");
  const historyListEl = document.getElementById("historyList");
  const historyClearBtn = document.getElementById("historyClearBtn");
  const themeToggle = document.getElementById("themeToggle");

  const HISTORY_KEY = "jsonFormatter.history";
  const HISTORY_LIMIT = 30;
  const THEME_KEY = "jsonFormatter.theme";
  const BRACKET_COLOR_COUNT = 6;

  // Plain-text version of what the output view shows (used by copy/history).
  let outputText = "";

  function applyTheme(theme) {
    const selected = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = selected;
    themeToggle.textContent = selected === "dark" ? "☀️ Light" : "🌙 Dark";
    themeToggle.setAttribute("aria-label", selected === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try {
      localStorage.setItem(THEME_KEY, selected);
    } catch {
      // storage unavailable; ignore
    }
  }

  const savedTheme = (() => {
    try {
      return localStorage.getItem(THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  })();

  applyTheme(savedTheme);
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(entries) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // storage unavailable (private mode, quota) — history just won't persist
    }
  }

  function addToHistory(entry) {
    const entries = loadHistory();
    entries.unshift(entry);
    saveHistory(entries.slice(0, HISTORY_LIMIT));
    renderHistory();
  }

  function renderHistory() {
    const entries = loadHistory();
    historyListEl.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "Nenhum JSON formatado ainda.";
      historyListEl.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.title = "Clique para recarregar";

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = new Date(entry.timestamp).toLocaleString("pt-BR");

      const preview = document.createElement("span");
      preview.className = "history-preview";
      preview.textContent = entry.preview;

      li.appendChild(time);
      li.appendChild(preview);
      li.addEventListener("click", () => {
        inputEl.value = entry.input;
        templateEl.value = entry.template;
        specEl.value = entry.spec;
        fixEl.checked = entry.fix;
        try {
          showOutput(JSON.parse(entry.output), indentFor(entry.template));
        } catch {
          clearOutput();
        }
        setStatus("Carregado do histórico.", "ok");
      });

      historyListEl.appendChild(li);
    });
  }

  historyClearBtn.addEventListener("click", () => {
    saveHistory([]);
    renderHistory();
  });

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

    // allowEmpty: object values like {texto:,a:1} become "" instead of failing.
    function parseValue(allowEmpty) {
      skipWs();
      const c = s[i];
      if (c === "{") return parseObject();
      if (c === "[") return parseArray();
      if (c === '"' || c === "'") return readQuotedString(c);
      const token = readBareUntil(new Set([",", "}", "]"]));
      if (token === "") {
        if (allowEmpty) return "";
        error("Valor esperado");
      }
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
        const value = parseValue(true);
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

  // Input wrapped in quotes ("{...}") or double-encoded JSON parses as a plain
  // string; peel those layers off while the string still looks like an
  // object/array. Returns the original value if no layer can be parsed.
  function unwrapStringified(value, allowLenient) {
    let unwrapped = false;
    for (let depth = 0; depth < 5; depth++) {
      if (typeof value !== "string" || !/^\s*[{\[]/.test(value)) break;
      try {
        value = JSON.parse(value);
      } catch {
        if (!allowLenient) break;
        try {
          value = parseLenient(value);
        } catch {
          break;
        }
      }
      unwrapped = true;
    }
    return { value, unwrapped };
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

  function bracket(char, depth) {
    const span = document.createElement("span");
    span.className = `jv-bracket jv-depth-${depth % BRACKET_COLOR_COUNT}`;
    span.textContent = char;
    return span;
  }

  // Renders value so its text matches JSON.stringify(value, null, indent)
  // exactly (selecting and copying from the view yields the same JSON), with
  // each non-empty object/array wrapped in a collapsible .jv-node.
  function renderValue(parent, value, indent, depth) {
    if (value === null || typeof value !== "object") {
      parent.append(JSON.stringify(value));
      return;
    }

    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v) => [null, v]) : Object.entries(value);
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) {
      parent.append(bracket(open, depth), bracket(close, depth));
      return;
    }

    const pretty = indent !== null;
    const node = document.createElement("span");
    node.className = "jv-node";
    node.dataset.depth = depth;

    if (pretty) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "jv-toggle";
      toggle.setAttribute("aria-label", "Recolher/expandir bloco");
      toggle.setAttribute("aria-expanded", "true");
      node.appendChild(toggle);
    }
    node.appendChild(bracket(open, depth));

    const n = entries.length;
    const summary = document.createElement("span");
    summary.className = "jv-summary";
    summary.textContent = isArray
      ? `${n} ${n === 1 ? "item" : "itens"}`
      : `${n} ${n === 1 ? "chave" : "chaves"}`;
    node.appendChild(summary);

    const children = document.createElement(pretty ? "div" : "span");
    children.className = "jv-children";
    entries.forEach(([key, child], idx) => {
      const line = document.createElement(pretty ? "div" : "span");
      line.className = "jv-line";
      if (pretty) line.append(indent.repeat(depth + 1));
      if (key !== null) {
        line.append(JSON.stringify(key) + (pretty ? ": " : ":"));
      }
      renderValue(line, child, indent, depth + 1);
      if (idx < n - 1) line.append(",");
      children.appendChild(line);
    });
    node.appendChild(children);

    if (pretty) {
      const closeIndent = document.createElement("span");
      closeIndent.className = "jv-close-indent";
      closeIndent.textContent = indent.repeat(depth);
      node.appendChild(closeIndent);
    }
    node.appendChild(bracket(close, depth));
    parent.appendChild(node);
  }

  function showOutput(value, indent) {
    outputText = indent === null ? JSON.stringify(value) : JSON.stringify(value, null, indent);
    const root = document.createElement("div");
    root.className = "jv-line";
    renderValue(root, value, indent, 0);
    outputEl.replaceChildren(root);
  }

  function clearOutput() {
    outputText = "";
    outputEl.replaceChildren();
  }

  function setCollapsed(node, collapsed) {
    node.classList.toggle("jv-collapsed", collapsed);
    const toggle = node.querySelector(":scope > .jv-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  // Click the arrow, a bracket or the "N chaves" summary to fold/unfold.
  // Alt+click applies the same state to every nested block.
  outputEl.addEventListener("click", (e) => {
    const target = e.target.closest(".jv-toggle, .jv-bracket, .jv-summary");
    if (!target) return;
    // Empty {} / [] brackets sit directly in a line, not in their own node.
    const node = target.parentElement;
    if (!node.classList.contains("jv-node")) return;
    // Don't fold when the user is drag-selecting text across a bracket.
    if (!target.classList.contains("jv-toggle") && !window.getSelection().isCollapsed) return;

    const collapsed = !node.classList.contains("jv-collapsed");
    setCollapsed(node, collapsed);
    if (e.altKey) {
      node.querySelectorAll(".jv-node").forEach((child) => setCollapsed(child, collapsed));
    }
  });

  expandAllBtn.addEventListener("click", () => {
    outputEl.querySelectorAll(".jv-node").forEach((node) => setCollapsed(node, false));
  });

  // Keeps the root open so the top-level keys stay visible.
  collapseAllBtn.addEventListener("click", () => {
    outputEl.querySelectorAll(".jv-node").forEach((node) => setCollapsed(node, node.dataset.depth !== "0"));
  });

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
      clearOutput();
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
        clearOutput();
        setStatus("Erro ao interpretar o JSON: " + strictErr.message, "error");
        return;
      }
      try {
        parsed = parseLenient(raw);
        usedFix = true;
      } catch (lenientErr) {
        clearOutput();
        setStatus("Erro ao interpretar o JSON: " + lenientErr.message, "error");
        return;
      }
    }

    const { value: inner, unwrapped } = unwrapStringified(parsed, shouldFix);
    if (unwrapped) {
      parsed = inner;
      usedFix = true;
    }

    showOutput(parsed, indentFor(templateEl.value));

    const notes = [];
    if (usedFix) {
      notes.push("Correções automáticas aplicadas (Fix JSON): chaves/valores sem aspas, comentários, vírgulas finais etc.");
    }
    notes.push(...warnings);

    setStatus(notes.length ? notes.join("\n") : "JSON válido.", notes.length ? "error" : "ok");

    addToHistory({
      timestamp: Date.now(),
      input: raw,
      output: outputText,
      template: templateEl.value,
      spec,
      fix: shouldFix,
      preview: raw.trim().slice(0, 80).replace(/\s+/g, " "),
    });
  }

  renderHistory();

  formatBtn.addEventListener("click", format);
  [templateEl, specEl, fixEl].forEach((el) =>
    el.addEventListener("change", () => {
      if (inputEl.value.trim()) format();
    })
  );

  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    clearOutput();
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
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => (copyBtn.textContent = "Copiar"), 1200);
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = outputText;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
    }
  });

  fixHelpBtn.addEventListener("click", () => (fixHelpPopover.hidden = false));
  fixHelpClose.addEventListener("click", () => (fixHelpPopover.hidden = true));

  inputEl.addEventListener("input", () => {
    if (!inputEl.value.trim()) {
      clearOutput();
      setStatus("");
    }
  });
})();
