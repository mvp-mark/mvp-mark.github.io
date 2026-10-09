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

  const CLOSER = { "{": "}", "[": "]" };

  // Brackets outside strings and comments, in order: [{ char, pos }].
  // Strings stop at a line break so one missing quote doesn't hide the rest.
  function scanBrackets(text) {
    const found = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'") {
        i++;
        while (i < text.length && text[i] !== c && text[i] !== "\n") {
          if (text[i] === "\\") i++;
          i++;
        }
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? text.length : end + 1;
      } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
        const end = text.indexOf("\n", i);
        i = end < 0 ? text.length : end;
      } else if (c === "{" || c === "[" || c === "}" || c === "]") {
        found.push({ char: c, pos: i });
      }
    }
    return found;
  }

  // Pretty-printed input: a bracket that ends its line should be closed by
  // the first later line indented no deeper than the bracket's own line. If
  // that line doesn't start with the matching closer, the closer is missing
  // right before it (at the end of the previous line, before its comma).
  function missingClosersByIndent(text, brackets) {
    const lines = text.split("\n");
    if (lines.length < 3) return null;
    const starts = [0];
    lines.forEach((l) => starts.push(starts[starts.length - 1] + l.length + 1));
    const indentOf = (l) => l.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
    const isBlank = (l) => l.trim() === "";

    const inserts = [];
    let ln = 0;
    for (const b of brackets) {
      while (starts[ln + 1] <= b.pos) ln++;
      if (!CLOSER[b.char] || !isBlank(text.slice(b.pos + 1, starts[ln] + lines[ln].length))) continue;

      const base = indentOf(lines[ln]);
      let n = ln + 1;
      while (n < lines.length && (isBlank(lines[n]) || indentOf(lines[n]) > base)) n++;
      const next = n < lines.length ? lines[n].trim() : "";
      if (next[0] === CLOSER[b.char]) continue;

      let last = n - 1;
      while (last > ln && isBlank(lines[last])) last--;
      if (last === ln) continue;
      const content = lines[last].replace(/\s+$/, "");
      const end = starts[last] + content.length;
      const hasComma = content.endsWith(",");
      inserts.push({
        pos: hasComma ? end - 1 : end,
        char: CLOSER[b.char],
        open: b.pos,
        lineIndent: lines[ln].match(/^[ \t]*/)[0],
        comma: !hasComma && next !== "" && next[0] !== "}" && next[0] !== "]",
        where: n < lines.length ? `antes da linha ${n + 1}, onde a indentação volta ao nível dele` : "no fim do texto",
      });
    }
    return inserts.length ? inserts : null;
  }

  // Bracket matching alone: openers skipped by a closer of an outer bracket
  // are closed right before it; openers still open at the end are closed at
  // the end. null if nothing is missing or a closer has no opener at all.
  function missingClosersByMatching(text, brackets) {
    const lastContentBefore = (pos) => {
      while (pos > 0 && /\s/.test(text[pos - 1])) pos--;
      return pos;
    };
    // Multi-line text with the spot at a line end: the closer gets its own
    // line, indented like the line of its opener.
    const ownLineIndent = (pos, open) => {
      if (!text.includes("\n") || !/^[ \t]*(\n|$)/.test(text.slice(pos))) return undefined;
      return text.slice(text.lastIndexOf("\n", open) + 1).match(/^[ \t]*/)[0];
    };
    const stack = [];
    const inserts = [];
    for (const b of brackets) {
      if (CLOSER[b.char]) {
        stack.push(b);
        continue;
      }
      let depth = stack.length - 1;
      while (depth >= 0 && CLOSER[stack[depth].char] !== b.char) depth--;
      if (depth < 0) return null;
      while (stack.length - 1 > depth) {
        const open = stack.pop();
        const pos = lastContentBefore(b.pos);
        inserts.push({
          pos,
          char: CLOSER[open.char],
          open: open.pos,
          lineIndent: ownLineIndent(pos, open.pos),
          where: `antes do '${b.char}' da linha ${lineCol(text, b.pos).line}`,
        });
      }
      stack.pop();
    }
    while (stack.length) {
      const open = stack.pop();
      const pos = lastContentBefore(text.length);
      inserts.push({
        pos,
        char: CLOSER[open.char],
        open: open.pos,
        lineIndent: ownLineIndent(pos, open.pos),
        where: "no fim do texto",
      });
    }
    return inserts.length ? inserts : null;
  }

  // Inserts the closers (inner ones first when they share a position), each
  // on its own line when it has a lineIndent, and returns the new text plus
  // a function mapping old positions to new ones.
  function applyInserts(text, inserts) {
    const groups = new Map();
    inserts.forEach((ins) => {
      if (!groups.has(ins.pos)) groups.set(ins.pos, []);
      groups.get(ins.pos).push(ins);
    });
    const added = [...groups.entries()]
      .map(([pos, group]) => {
        group.sort((a, b) => b.open - a.open);
        const closers = group.map((g) => (g.lineIndent === undefined ? g.char : "\n" + g.lineIndent + g.char));
        return { pos, str: closers.join("") + (group.some((g) => g.comma) ? "," : "") };
      })
      .sort((a, b) => a.pos - b.pos);

    let out = "";
    let from = 0;
    added.forEach(({ pos, str }) => {
      out += text.slice(from, pos) + str;
      from = pos;
    });
    out += text.slice(from);
    const shift = (pos) => pos + added.filter((a) => a.pos <= pos).reduce((sum, a) => sum + a.str.length, 0);
    return { text: out, shift };
  }

  // Path (keys / indexes) to the container whose opening bracket is at
  // `target`. Keys are read the way the parser that accepted the text reads
  // them (JSON.parse, or parseLenient's looser quoting).
  function containerPath(text, target, lenient) {
    const keyFrom = (raw) => {
      const t = raw.trim();
      const q = t[0];
      if (q !== '"' && q !== "'") return t;
      if (lenient) return t.slice(1, -1).split("\\" + q).join(q);
      try {
        return JSON.parse(t);
      } catch {
        return t.slice(1, -1);
      }
    };
    const frames = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const top = frames[frames.length - 1];
      if (c === '"' || c === "'") {
        i++;
        while (i < text.length && text[i] !== c) {
          if (text[i] === "\\") i++;
          i++;
        }
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? text.length : end + 1;
      } else if (c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
        const end = text.indexOf("\n", i);
        i = end < 0 ? text.length : end;
      } else if (c === "{" || c === "[") {
        if (i === target) return frames.map((f) => (f.array ? f.index : f.key));
        frames.push({ array: c === "[", index: 0, key: null, segStart: i + 1, keyDone: false });
      } else if (c === "}" || c === "]") {
        frames.pop();
      } else if (c === "," && top) {
        if (top.array) top.index++;
        else Object.assign(top, { segStart: i + 1, keyDone: false });
      } else if (c === ":" && top && !top.array && !top.keyDone) {
        top.key = keyFrom(text.slice(top.segStart, i));
        top.keyDone = true;
      }
    }
    return null;
  }

  // Adds the closers and parses the result: { inserts, fixed, value, marks,
  // usedLenient }, or null if there's nothing to add or it still fails.
  function tryInserts(text, inserts, lenient) {
    if (!inserts) return null;
    const { text: fixed, shift } = applyInserts(text, inserts);
    let value;
    let usedLenient = false;
    try {
      value = JSON.parse(fixed);
    } catch {
      if (!lenient) return null;
      try {
        value = parseLenient(fixed);
        usedLenient = true;
      } catch {
        return null;
      }
    }
    const marks = new Map();
    inserts.forEach((ins) => {
      const path = containerPath(fixed, shift(ins.open), usedLenient);
      if (path) marks.set(JSON.stringify(path), ins.char);
    });
    return { inserts: [...inserts].sort((a, b) => a.open - b.open), fixed, value, marks, usedLenient };
  }

  // Missing closers fixed automatically: each one is added at the end of the
  // text (or right before a closer that skips it). `alternative` is set when
  // the indentation points somewhere else and that also parses.
  function autoCloseBrackets(text, lenient) {
    const brackets = scanBrackets(text);
    const closed = tryInserts(text, missingClosersByMatching(text, brackets), lenient);
    if (!closed) return null;
    const byIndent = tryInserts(text, missingClosersByIndent(text, brackets), lenient);
    const spots = (r) => JSON.stringify(r.inserts.map((ins) => [ins.open, ins.pos]));
    closed.alternative = byIndent && spots(byIndent) !== spots(closed) ? byIndent : null;
    return closed;
  }

  // For the error view, when closing at the end doesn't produce valid JSON
  // but the indentation shows where the closer belongs.
  function suggestBracketRepair(text, lenient) {
    const brackets = scanBrackets(text);
    return tryInserts(text, missingClosersByIndent(text, brackets), lenient) ??
      tryInserts(text, missingClosersByMatching(text, brackets), lenient);
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
  // marks (optional): Map of JSON.stringify(path) -> closing char, for
  // containers whose closing bracket was missing in the input; their brackets
  // are highlighted and a label element is returned for the caller to place
  // at the end of the line (after any comma).
  function renderValue(parent, value, indent, depth, path = [], marks = null) {
    if (value === null || typeof value !== "object") {
      parent.append(JSON.stringify(value));
      return null;
    }

    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v) => [null, v]) : Object.entries(value);
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    const missing = marks !== null && marks.has(JSON.stringify(path));
    const openEl = bracket(open, depth);
    const closeEl = bracket(close, depth);
    if (missing) {
      openEl.classList.add("jv-unclosed");
      closeEl.classList.add("jv-missing");
    }
    const label = missing ? span("jv-missing-label", `← '${close}' adicionado (faltava)`) : null;

    if (entries.length === 0) {
      parent.append(openEl, closeEl);
      return label;
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
    node.appendChild(openEl);

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
      const childPath = marks === null ? path : [...path, isArray ? idx : key];
      const childLabel = renderValue(line, child, indent, depth + 1, childPath, marks);
      if (idx < n - 1) line.append(",");
      if (childLabel) line.append(childLabel);
      children.appendChild(line);
    });
    node.appendChild(children);

    if (pretty) {
      const closeIndent = document.createElement("span");
      closeIndent.className = "jv-close-indent";
      closeIndent.textContent = indent.repeat(depth);
      node.appendChild(closeIndent);
    }
    node.appendChild(closeEl);
    parent.appendChild(node);
    return label;
  }

  // marks: see renderValue (closers that were added automatically).
  function showOutput(value, indent, marks = null) {
    outputText = indent === null ? JSON.stringify(value) : JSON.stringify(value, null, indent);
    const root = document.createElement("div");
    root.className = "jv-line";
    const rootLabel = renderValue(root, value, indent, 0, [], marks);
    if (rootLabel) root.appendChild(rootLabel);
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
  // around the error column. With `insert`, that text is shown (highlighted)
  // as if inserted at the position instead of marking an existing character.
  function renderErrorContext(source, { line, col }, insert = null) {
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
      if (insert) {
        row.append(before, span("jv-error-insert", insert), shown.slice(at) + tail);
      } else {
        // At end of line/text there is no character to mark; mark a blank.
        row.append(before, span("jv-error-char", shown[at] ?? " "), shown.slice(at + 1) + tail);
      }
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

  // Puts the fixed text into the input (undoable) and formats again. Skipped
  // if the input changed since the error was shown.
  function applyFixToInput(input, source, offset, fixed) {
    if (inputEl.value === input) {
      replaceInput(offset >= 0 ? input.slice(0, offset) + fixed + input.slice(offset + source.length) : fixed);
    }
    format();
  }

  // Warning shown above the output when missing closers were added
  // automatically. Returns { banner, summary } (summary goes to the status).
  function renderAutoCloseBanner(source, offset, closed) {
    const input = inputEl.value;
    const shown = offset >= 0 ? input : source;
    const toShown = (pos) => (offset >= 0 ? offset + pos : pos);
    const opener = (ins) => (ins.char === "}" ? "{" : "[");
    const openAt = (ins) => lineCol(shown, toShown(ins.open));
    const { inserts, alternative } = closed;

    const banner = document.createElement("div");
    banner.className = "jv-warning";
    const title = document.createElement("div");
    title.className = "jv-warning-title";
    title.textContent = inserts.length === 1
      ? `Faltava fechar um '${opener(inserts[0])}': fechei automaticamente`
      : `Faltavam ${inserts.length} fechamentos: fechei automaticamente`;
    banner.appendChild(title);

    const list = document.createElement("ul");
    list.className = "jv-error-list";
    inserts.forEach((ins) => {
      const at = openAt(ins);
      const li = document.createElement("li");
      li.textContent = `O '${opener(ins)}' da linha ${at.line}, coluna ${at.col} não tinha fechamento; ` +
        `o '${ins.char}' foi adicionado ${ins.where}.`;
      list.appendChild(li);
    });
    banner.appendChild(list);

    if (alternative) {
      const hint = document.createElement("div");
      hint.className = "jv-warning-hint";
      hint.textContent = "Atenção: pela indentação, o lugar certo parece ser outro: " +
        alternative.inserts.map((ins) => `o '${ins.char}' do '${opener(ins)}' da linha ${openAt(ins).line} ${ins.where}`).join("; ") +
        ".";
      banner.appendChild(hint);
    }

    const note = document.createElement("div");
    note.className = "jv-error-note";
    note.textContent = "Confira se o fechamento ficou no lugar certo (destacado abaixo). A entrada não foi alterada.";
    banner.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "jv-error-actions";
    const addButton = (label, fixed) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn jv-error-apply";
      btn.textContent = label;
      btn.addEventListener("click", () => applyFixToInput(input, source, offset, fixed));
      actions.appendChild(btn);
    };
    addButton(inserts.length === 1 ? "Inserir o fechamento na entrada" : "Inserir os fechamentos na entrada", closed.fixed);
    if (alternative) addButton("Inserir onde a indentação indica", alternative.fixed);
    banner.appendChild(actions);

    const first = inserts[0];
    const summary = (inserts.length === 1
      ? `Faltava fechar o '${opener(first)}' da linha ${openAt(first).line}: o '${first.char}' foi adicionado ${first.where}.`
      : `Faltavam ${inserts.length} fechamentos; foram adicionados automaticamente.`) +
      (alternative ? " Pela indentação, o lugar certo parece ser outro (veja na saída)." : " Confira na saída.");
    return { banner, summary };
  }

  // Missing closing bracket(s): explains which bracket was left open and
  // shows the formatted JSON with the closer where it most likely belongs.
  // offset: where `source` sits verbatim in the input (-1 if it doesn't, e.g.
  // the inner text of an escaped string), so positions map to the input.
  function showBracketRepair(source, repair, offset) {
    outputText = "";
    const input = inputEl.value;
    const fromInput = offset >= 0;
    const shown = fromInput ? input : source;
    const toShown = (pos) => (fromInput ? offset + pos : pos);
    const { inserts } = repair;

    const box = document.createElement("div");
    box.className = "jv-error";

    const title = document.createElement("div");
    title.className = "jv-error-title";
    const first = inserts[0];
    const firstOpen = lineCol(shown, toShown(first.open));
    title.textContent = inserts.length === 1
      ? `Falta fechar o '${first.char === "}" ? "{" : "["}' aberto na linha ${firstOpen.line}`
      : `Faltam ${inserts.length} fechamentos de chaves/colchetes`;
    box.appendChild(title);

    const list = document.createElement("ul");
    list.className = "jv-error-list";
    inserts.forEach((ins) => {
      const open = lineCol(shown, toShown(ins.open));
      const li = document.createElement("li");
      li.textContent = `O '${ins.char === "}" ? "{" : "["}' da linha ${open.line}, coluna ${open.col} nunca foi fechado. ` +
        `O '${ins.char}' que falta deveria vir ${ins.where}.`;
      list.appendChild(li);
    });
    box.appendChild(list);

    if (!fromInput) {
      const note = document.createElement("div");
      note.className = "jv-error-note";
      note.textContent = "O erro está no JSON que vinha entre aspas; linha e coluna contam a partir do conteúdo de dentro das aspas.";
      box.appendChild(note);
    }

    const firstInsert = inserts.reduce((a, b) => (b.pos < a.pos ? b : a));
    const sameSpot = inserts.filter((ins) => ins.pos === firstInsert.pos).sort((a, b) => b.open - a.open);
    const insertText = sameSpot.map((ins) => ins.char).join("") + (sameSpot.some((ins) => ins.comma) ? "," : "");
    box.appendChild(renderErrorContext(shown, lineCol(shown, toShown(firstInsert.pos)), insertText));

    const actions = document.createElement("div");
    actions.className = "jv-error-actions";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "copy-btn jv-error-apply";
    applyBtn.textContent = inserts.length === 1 ? `Inserir o '${first.char}' na entrada` : "Inserir os fechamentos na entrada";
    applyBtn.addEventListener("click", () => applyFixToInput(input, source, offset, repair.fixed));
    actions.appendChild(applyBtn);
    if (fromInput) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "copy-btn";
      jump.textContent = "Mostrar na entrada";
      jump.addEventListener("click", () => {
        const pos = toShown(firstInsert.pos);
        inputEl.focus({ preventScroll: true });
        inputEl.setSelectionRange(pos, pos);
        scrollInputTo(pos);
      });
      actions.appendChild(jump);
    }
    box.appendChild(actions);

    const previewTitle = document.createElement("div");
    previewTitle.className = "jv-error-preview-title";
    previewTitle.textContent = "Como fica o JSON com o fechamento no lugar sugerido (destacado):";
    box.appendChild(previewTitle);

    const preview = document.createElement("div");
    preview.className = "jv-error-preview";
    const root = document.createElement("div");
    root.className = "jv-line";
    const rootLabel = renderValue(root, repair.value, indentFor(templateEl.value) ?? "  ", 0, [], repair.marks);
    if (rootLabel) root.appendChild(rootLabel);
    preview.appendChild(root);
    box.appendChild(preview);

    outputEl.classList.add("has-error");
    outputEl.replaceChildren(box);
    outputEl.scrollTop = 0;

    const where = lineCol(shown, toShown(firstInsert.pos));
    setStatus(
      `${title.textContent}: o '${first.char}' que falta deveria vir ${first.where} ` +
        `(linha ${where.line}, coluna ${where.col}). Veja a sugestão na saída.`,
      "error"
    );
  }

  // Re-indents text that isn't valid JSON so an error in a one-line input can
  // be found and edited. Only whitespace between tokens changes: strings,
  // bare values and comments are copied as is, and unbalanced brackets are
  // tolerated.
  function formatLoose(text, indent) {
    let out = "";
    let depth = 0;
    let pending = false; // a line break is owed before the next output
    let last = ""; // "open" | "close" | "sep" | "colon" | "token" | "string"
    const frames = []; // per open bracket: { obj, colon }

    const breakLine = () => {
      out += "\n" + indent.repeat(depth);
      pending = false;
    };
    const beforeItem = () => {
      if (pending) breakLine();
      else if (last === "token" || last === "string" || last === "close") out += " ";
    };
    const emitToken = (tok, kind = "token") => {
      beforeItem();
      out += tok;
      last = kind;
    };
    const startsComment = (j) =>
      text[j] === "/" && (text[j + 1] === "*" || (text[j + 1] === "/" && text[j - 1] !== ":"));

    for (let i = 0; i < text.length; ) {
      const c = text[i];
      const top = frames[frames.length - 1];
      if (/\s/.test(c)) {
        i++;
      } else if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
        j = Math.min(text[j] === c ? j + 1 : j, text.length);
        emitToken(text.slice(i, j), "string");
        i = j;
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        const j = end < 0 ? text.length : end + 2;
        emitToken(text.slice(i, j));
        i = j;
      } else if (startsComment(i)) {
        const end = text.indexOf("\n", i);
        const j = end < 0 ? text.length : end;
        emitToken(text.slice(i, j).trimEnd());
        pending = true; // whatever follows must not end up inside the comment
        i = j;
      } else if (c === "{" || c === "[") {
        beforeItem();
        out += c;
        depth++;
        frames.push({ obj: c === "{", colon: false });
        pending = true;
        last = "open";
        i++;
      } else if (c === "}" || c === "]") {
        depth = Math.max(0, depth - 1);
        frames.pop();
        if (last === "open") pending = false;
        else breakLine();
        out += c;
        last = "close";
        i++;
      } else if (c === ",") {
        if (pending && last !== "open") breakLine();
        out += ",";
        if (top && top.obj) top.colon = false;
        pending = true;
        last = "sep";
        i++;
      } else if (c === ":" && top && top.obj && (!top.colon || last === "string")) {
        // After a quoted string it's a key even if a comma is missing before.
        if (pending) breakLine();
        out += ": ";
        top.colon = true;
        last = "colon";
        i++;
      } else {
        // Bare word (unquoted key/value). Keeps inner spaces, and ':' once
        // past the key (timestamps like 09:01:08 are values).
        const stopAtColon = top && top.obj && !top.colon;
        let j = i;
        while (
          j < text.length &&
          !'{}[],"\'\n'.includes(text[j]) &&
          !(stopAtColon && text[j] === ":") &&
          !(j > i && startsComment(j))
        ) j++;
        emitToken(text.slice(i, Math.max(j, i + 1)).trim());
        i = Math.max(j, i + 1);
      }
    }
    return out;
  }

  // One-line / minified input: some long line packed with brackets/commas.
  function isHardToEdit(text) {
    return text.split("\n").some((line) => {
      if (line.length <= 80) return false;
      const structural = line.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/[{}\[\],]/g);
      return structural !== null && structural.length >= 4;
    });
  }

  // Replaces the input text keeping the browser's undo history (Ctrl+Z)
  // where execCommand is supported.
  function replaceInput(text) {
    inputEl.focus({ preventScroll: true });
    inputEl.select();
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok || inputEl.value !== text) inputEl.value = text;
    inputEl.setSelectionRange(0, 0);
    inputEl.scrollTop = 0;
  }

  // On an error in hard-to-edit input, re-indents the input (dropping the
  // outer quotes when the JSON came wrapped in them). True if it changed.
  function reformatInputForEditing(raw, source, offset) {
    const indent = indentFor(templateEl.value) ?? "  ";
    const trimmed = raw.trim();
    const wrapped = offset > 0 && source !== raw && /^["']/.test(trimmed) &&
      trimmed === trimmed[0] + source + trimmed[0];
    if (!wrapped && source !== raw) return false;
    if (!isHardToEdit(source)) return false;
    const next = formatLoose(source, indent);
    if (next === raw) return false;
    replaceInput(next);
    return true;
  }

  function addReformatNote(unwrapped) {
    const box = outputEl.querySelector(".jv-error");
    if (!box) return;
    const note = document.createElement("div");
    note.className = "jv-error-reformatted";
    note.textContent = (unwrapped
      ? "A entrada estava entre aspas e em uma linha só; tirei as aspas e reorganizei com indentação"
      : "A entrada estava em uma linha só; reorganizei com indentação") +
      " para facilitar a edição. Nada além dos espaços mudou (Ctrl+Z desfaz).";
    box.prepend(note);
  }

  // Missing-bracket errors get the repair view; anything else the plain one.
  function reportError(source, info, offset) {
    const repair = suggestBracketRepair(source, fixEl.checked);
    if (repair) {
      showBracketRepair(source, repair, offset);
    } else if (offset >= 0) {
      showError(inputEl.value, { ...info, pos: info.pos == null ? null : offset + info.pos }, true);
    } else {
      showError(source, info, false);
    }
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

  // reformatted: set when the input was just re-indented after an error, so
  // the error is reported on the new text (and not re-indented again).
  function format(reformatted = null) {
    const raw = inputEl.value;
    if (!raw.trim()) {
      clearOutput();
      setStatus("");
      return;
    }

    const spec = specEl.value;
    const shouldFix = fixEl.checked;
    const warnings = validateSpec(raw, spec);

    const fail = (source, info, offset) => {
      const closed = autoCloseBrackets(source, shouldFix);
      if (closed) {
        showOutput(closed.value, indentFor(templateEl.value), closed.marks);
        const { banner, summary } = renderAutoCloseBanner(source, offset, closed);
        outputEl.prepend(banner);
        const notes = [summary];
        if (closed.usedLenient || source !== raw) {
          notes.push("Correções automáticas aplicadas (Fix JSON): chaves/valores sem aspas, comentários, vírgulas finais etc.");
        }
        setStatus([...notes, ...warnings].join("\n"), "error");
        addToHistory({
          timestamp: Date.now(),
          input: raw,
          output: outputText,
          template: templateEl.value,
          spec,
          fix: shouldFix,
          preview: raw.trim().slice(0, 80).replace(/\s+/g, " "),
        });
        return;
      }
      if (!reformatted && reformatInputForEditing(raw, source, offset)) {
        format({ unwrapped: source !== raw });
        return;
      }
      reportError(source, info, offset);
      if (reformatted) addReformatNote(reformatted.unwrapped);
    };

    let parsed;
    let usedFix = false;
    try {
      parsed = JSON.parse(raw);
    } catch (strictErr) {
      if (!shouldFix) {
        fail(raw, strictErrorInfo(raw, strictErr), 0);
        return;
      }
      try {
        parsed = parseLenient(raw);
        usedFix = true;
      } catch (lenientErr) {
        fail(raw, { pos: lenientErr.pos ?? null, message: lenientErr.message }, 0);
        return;
      }
    }

    const { value: inner, unwrapped, error } = unwrapStringified(parsed, shouldFix);
    if (error) {
      // When the quoted text appears verbatim in the input (no escapes),
      // point at the real spot in the input instead of inside the string.
      fail(error.source, error, raw.indexOf(error.source));
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

  formatBtn.addEventListener("click", () => format());
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
