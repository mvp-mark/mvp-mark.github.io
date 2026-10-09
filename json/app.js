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

  // Blanks out line/block comments before lenient parsing. Comments become
  // spaces (newlines kept) so error positions still match the original text.
  function stripComments(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])(\/\/.*)$/gm, (_, before, comment) => before + " ".repeat(comment.length));
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

    function error(msg, pos = i) {
      const err = new SyntaxError(msg);
      err.pos = pos;
      throw err;
    }

    function found() {
      return i >= s.length ? "o fim do texto" : `'${s[i]}'`;
    }

    function readQuotedString(quote) {
      let out = "";
      const start = i;
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
      if (s[i] !== quote) error("Esta string nunca foi fechada (falta a aspa final).", start);
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
        error(`Valor esperado, mas encontrou ${found()}.`);
      }
      return coerceBareToken(token);
    }

    function parseKey() {
      skipWs();
      const c = s[i];
      if (c === '"' || c === "'") return readQuotedString(c);
      const token = readBareUntil(new Set([":"]));
      if (token === "") error(`Chave esperada, mas encontrou ${found()}.`);
      return token;
    }

    function parseObject() {
      const obj = {};
      const open = i;
      i++; // {
      skipWs();
      if (s[i] === "}") { i++; return obj; }
      while (true) {
        const key = parseKey();
        skipWs();
        if (s[i] !== ":") error(`Esperado ':' depois da chave, mas encontrou ${found()}.`);
        i++;
        const value = parseValue(true);
        obj[key] = value;
        skipWs();
        if (s[i] === ",") { i++; skipWs(); if (s[i] === "}") { i++; break; } continue; }
        if (s[i] === "}") { i++; break; }
        if (i >= s.length) error("Este '{' nunca foi fechado (falta o '}').", open);
        error(`Esperado ',' ou '}', mas encontrou ${found()}.`);
      }
      return obj;
    }

    function parseArray() {
      const arr = [];
      const open = i;
      i++; // [
      skipWs();
      if (s[i] === "]") { i++; return arr; }
      while (true) {
        arr.push(parseValue());
        skipWs();
        if (s[i] === ",") { i++; skipWs(); if (s[i] === "]") { i++; break; } continue; }
        if (s[i] === "]") { i++; break; }
        if (i >= s.length) error("Este '[' nunca foi fechado (falta o ']').", open);
        error(`Esperado ',' ou ']', mas encontrou ${found()}.`);
      }
      return arr;
    }

    skipWs();
    const result = parseValue();
    skipWs();
    if (i < s.length) error(`Conteúdo extra depois do fim do JSON, começando em ${found()}.`);
    return result;
  }

  // Input wrapped in quotes ("{...}") or double-encoded JSON parses as a plain
  // string; peel those layers off while the string still looks like an
  // object/array. Returns the original value if no layer can be parsed; with
  // allowLenient, a layer that fails is reported in `error` ({ source, pos,
  // message }, pos relative to that layer's text).
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
        } catch (err) {
          return { value, unwrapped, error: { source: value, pos: err.pos ?? null, message: err.message } };
        }
      }
      unwrapped = true;
    }
    return { value, unwrapped };
  }

  function lineCol(text, pos) {
    const before = text.slice(0, pos);
    return { line: before.split("\n").length, col: pos - before.lastIndexOf("\n") };
  }

  // Strict JSON (RFC 8259) checker, used only after JSON.parse fails, to say
  // where and why in Portuguese with the same positions in every browser.
  // Returns { pos, message } or null if it finds nothing wrong.
  function findJsonError(text) {
    let i = 0;
    const stack = []; // open brackets: { char, pos }
    const STOP = /[\s,:{}\[\]"]/;

    function Fail(pos, message) {
      this.pos = pos;
      this.message = message;
    }
    const fail = (pos, message) => { throw new Fail(pos, message); };

    function found(pos = i) {
      if (pos >= text.length) return "o fim do texto";
      if (text[pos] === "\n") return "uma quebra de linha";
      return `'${text[pos]}'`;
    }

    function bareToken() {
      let end = i;
      while (end < text.length && !STOP.test(text[end])) end++;
      const token = text.slice(i, end);
      return token.length > 40 ? token.slice(0, 40) + "…" : token;
    }

    function unexpectedEnd() {
      const open = stack[stack.length - 1];
      if (open) {
        const close = open.char === "{" ? "}" : "]";
        fail(open.pos, `Este '${open.char}' nunca foi fechado (falta o '${close}').`);
      }
      fail(text.length, "O texto terminou antes do fim do valor.");
    }

    function skipWs() {
      while (i < text.length && /[ \t\n\r]/.test(text[i])) i++;
      if (text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
        fail(i, "Comentários não são permitidos em JSON.");
      }
    }

    // After a value inside { } or [ ]: what should have come instead.
    function expectedSeparator(close) {
      const c = text[i];
      const open = stack[stack.length - 1];
      if (c === "}" || c === "]") {
        fail(i, `Esperado '${close}' para fechar o '${open.char}' da linha ${lineCol(text, open.pos).line}, mas encontrou '${c}'.`);
      }
      if (/["'{\[\w-]/.test(c)) fail(i, "Falta uma vírgula ',' antes deste item.");
      fail(i, `Esperado ',' ou '${close}', mas encontrou ${found()}.`);
    }

    function parseString() {
      const start = i;
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '"') { i++; return; }
        if (c === "\\") {
          const e = text[i + 1];
          if (e === undefined) break;
          if (e === "u") {
            if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
              fail(i, "Escape \\u inválido: precisa de 4 dígitos hexadecimais (ex.: \\u00e9).");
            }
            i += 6;
            continue;
          }
          if (!'"\\/bfnrt'.includes(e)) fail(i, `Escape inválido '\\${e}' dentro da string.`);
          i += 2;
          continue;
        }
        if (c === "\n") fail(i, "Quebra de linha dentro de uma string: feche as aspas antes ou use \\n.");
        if (c < " ") fail(i, "Caractere de controle (ex.: tab) dentro de uma string; use \\t, \\n etc.");
        i++;
      }
      fail(start, "Esta string nunca foi fechada (falta a aspa dupla final).");
    }

    function parseValue() {
      skipWs();
      if (i >= text.length) unexpectedEnd();
      const c = text[i];
      if (c === "{") return parseObject();
      if (c === "[") return parseArray();
      if (c === '"') return parseString();
      if (c === "'") fail(i, "Aspas simples não são permitidas; use aspas duplas (\").");
      if (c === "," || c === "}" || c === "]") fail(i, `Valor esperado antes de '${c}'.`);

      const token = bareToken();
      if (token === "true" || token === "false" || token === "null") { i += token.length; return; }
      const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
      if (number.test(token)) { i += token.length; return; }

      const replacements = { True: "true", False: "false", None: "null", undefined: "null", NULL: "null", TRUE: "true", FALSE: "false" };
      if (replacements[token]) fail(i, `'${token}' não é válido em JSON; use ${replacements[token]}.`);
      if (/^-?0\d+(\.\d+)?$/.test(token)) fail(i, `Número com zero à esquerda (${token}) não é permitido; coloque entre aspas se for um código.`);
      if (/^[-+.\deE]+$/.test(token)) fail(i, `Número inválido: ${token}. Se for uma data ou texto, coloque entre aspas duplas.`);
      fail(i, `Valor sem aspas: ${token}. Textos precisam estar entre aspas duplas.`);
    }

    function parseObject() {
      stack.push({ char: "{", pos: i });
      i++;
      skipWs();
      if (text[i] === "}") { i++; stack.pop(); return; }
      let comma = -1;
      while (true) {
        skipWs();
        if (i >= text.length) unexpectedEnd();
        const c = text[i];
        if (c === "}" && comma >= 0) fail(comma, "Vírgula sobrando antes de '}'.");
        if (c === "'") fail(i, "Aspas simples não são permitidas; use aspas duplas (\").");
        if (c !== '"') {
          fail(i, /[\w$]/.test(c)
            ? `Chave sem aspas: ${bareToken().split(":")[0]}. Em JSON as chaves precisam estar entre aspas duplas.`
            : `Esperado o nome de uma chave entre aspas, mas encontrou ${found()}.`);
        }
        parseString();
        skipWs();
        if (i >= text.length) unexpectedEnd();
        if (text[i] !== ":") fail(i, `Esperado ':' depois da chave, mas encontrou ${found()}.`);
        i++;
        parseValue();
        skipWs();
        if (i >= text.length) unexpectedEnd();
        if (text[i] === ",") { comma = i; i++; continue; }
        if (text[i] === "}") { i++; stack.pop(); return; }
        expectedSeparator("}");
      }
    }

    function parseArray() {
      stack.push({ char: "[", pos: i });
      i++;
      skipWs();
      if (text[i] === "]") { i++; stack.pop(); return; }
      let comma = -1;
      while (true) {
        skipWs();
        if (text[i] === "]" && comma >= 0) fail(comma, "Vírgula sobrando antes de ']'.");
        parseValue();
        skipWs();
        if (i >= text.length) unexpectedEnd();
        if (text[i] === ",") { comma = i; i++; continue; }
        if (text[i] === "]") { i++; stack.pop(); return; }
        expectedSeparator("]");
      }
    }

    try {
      skipWs();
      parseValue();
      skipWs();
      if (i < text.length) {
        const c = text[i];
        fail(i, c === "}" || c === "]"
          ? `'${c}' sobrando: não há nada aberto para ele fechar.`
          : `Conteúdo extra depois do fim do JSON, começando em ${found()}.`);
      }
      return null;
    } catch (err) {
      if (err instanceof Fail) return { pos: err.pos, message: err.message };
      return null; // e.g. nesting too deep for recursion; caller falls back
    }
  }

  function strictErrorInfo(text, nativeErr) {
    const info = findJsonError(text);
    if (info) return info;
    const match = /position (\d+)/.exec(nativeErr.message);
    return { pos: match ? Number(match[1]) : null, message: nativeErr.message };
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
    outputEl.classList.remove("has-error");
    outputEl.replaceChildren(root);
  }

  function clearOutput() {
    outputText = "";
    outputEl.classList.remove("has-error");
    outputEl.replaceChildren();
  }

  function span(className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  // A few lines around the error with the offending character highlighted
  // and a ^ under it. Very long lines (minified JSON) are cut to a window
  // around the error column.
  function renderErrorContext(source, { line, col }) {
    const WINDOW = 50;
    const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
    const first = Math.max(1, line - 3);
    const last = Math.min(lines.length, line + 2);
    const numWidth = String(last).length;
    const crop = lines[line - 1].length > WINDOW * 2;
    const cropStart = crop ? Math.max(0, col - 1 - WINDOW) : 0;

    const code = document.createElement("div");
    code.className = "jv-error-code";
    for (let n = first; n <= last; n++) {
      const full = lines[n - 1];
      const end = crop ? Math.min(full.length, cropStart + WINDOW * 2) : full.length;
      const shown = full.slice(cropStart, end);
      const lead = cropStart > 0 ? "…" : "";
      const tail = end < full.length ? "…" : "";

      const row = document.createElement("div");
      row.className = "jv-error-row";
      row.appendChild(span("jv-error-num", String(n).padStart(numWidth)));
      if (n !== line) {
        row.append(lead + shown + tail);
        code.appendChild(row);
        continue;
      }

      const at = col - 1 - cropStart;
      const before = lead + shown.slice(0, at);
      row.classList.add("jv-error-line");
      // At end of line/text there is no character to mark; mark a blank.
      row.append(before, span("jv-error-char", shown[at] ?? " "), shown.slice(at + 1) + tail);
      code.appendChild(row);

      const caretRow = document.createElement("div");
      caretRow.className = "jv-error-row";
      // Keep tabs so the ^ lines up with the character above it.
      caretRow.append(
        span("jv-error-num", " ".repeat(numWidth)),
        before.replace(/[^\t]/g, " "),
        span("jv-error-caret", "^")
      );
      code.appendChild(caretRow);
    }
    return code;
  }

  // Scrolls the input so `pos` is mid-view. Measures the text before it in a
  // hidden copy of the textarea so wrapped long lines are accounted for.
  function scrollInputTo(pos) {
    const probe = inputEl.cloneNode();
    probe.removeAttribute("id");
    probe.value = inputEl.value.slice(0, pos);
    Object.assign(probe.style, {
      position: "absolute",
      visibility: "hidden",
      height: "0",
      width: inputEl.offsetWidth + "px",
    });
    inputEl.parentNode.appendChild(probe);
    const y = probe.scrollHeight;
    probe.remove();
    inputEl.scrollTop = Math.max(0, y - inputEl.clientHeight / 2);
  }

  // Shows in the output pane why the text couldn't be parsed. fromInput:
  // positions refer to the input textarea (enables "Mostrar na entrada").
  function showError(source, { pos, message }, fromInput) {
    outputText = "";
    const where = pos == null ? null : lineCol(source, pos);

    const box = document.createElement("div");
    box.className = "jv-error";
    const title = document.createElement("div");
    title.className = "jv-error-title";
    title.textContent = where
      ? `Erro na linha ${where.line}, coluna ${where.col}`
      : "Erro ao interpretar o JSON";
    const msg = document.createElement("div");
    msg.className = "jv-error-msg";
    msg.textContent = message;
    box.append(title, msg);

    if (!fromInput) {
      const note = document.createElement("div");
      note.className = "jv-error-note";
      note.textContent = "O erro está no JSON que vinha entre aspas; linha e coluna contam a partir do conteúdo de dentro das aspas.";
      box.appendChild(note);
    }

    if (where) box.appendChild(renderErrorContext(source, where));

    if (where && fromInput) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "copy-btn jv-error-jump";
      jump.textContent = "Mostrar na entrada";
      jump.addEventListener("click", () => {
        inputEl.focus({ preventScroll: true });
        inputEl.setSelectionRange(pos, Math.min(pos + 1, inputEl.value.length));
        scrollInputTo(pos);
      });
      box.appendChild(jump);
    }

    outputEl.classList.add("has-error");
    outputEl.replaceChildren(box);
    setStatus(
      where ? `Erro na linha ${where.line}, coluna ${where.col}: ${message}` : `Erro ao interpretar o JSON: ${message}`,
      "error"
    );
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
        showError(raw, strictErrorInfo(raw, strictErr), true);
        return;
      }
      try {
        parsed = parseLenient(raw);
        usedFix = true;
      } catch (lenientErr) {
        showError(raw, { pos: lenientErr.pos ?? null, message: lenientErr.message }, true);
        return;
      }
    }

    const { value: inner, unwrapped, error } = unwrapStringified(parsed, shouldFix);
    if (error) {
      // When the quoted text appears verbatim in the input (no escapes),
      // point at the real spot in the input instead of inside the string.
      const offset = error.pos == null ? -1 : raw.indexOf(error.source);
      if (offset >= 0) showError(raw, { ...error, pos: offset + error.pos }, true);
      else showError(error.source, error, false);
      return;
    }
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
