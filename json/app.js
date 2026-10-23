import {
  RawNumber,
  autoCloseBrackets,
  brokenWrapperInner,
  classifyBrackets,
  formatLoose,
  insertCommas,
  isHardToEdit,
  lineCol,
  parseJson,
  parseLenient,
  repairNestedKeys,
  scanBrackets,
  scanTokens,
  strictErrorInfo,
  stringify,
  suggestBracketRepair,
  unwrapStringified,
  validateSpec,
  wrapConcatenated,
} from "./parser.js";

(function () {
  const inputEl = document.getElementById("input");
  const inputHighlightEl = document.getElementById("inputHighlight");
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
  const syntaxThemeEl = document.getElementById("syntaxTheme");
  const rainbowEl = document.getElementById("rainbowBrackets");

  const HISTORY_KEY = "jsonFormatter.history";
  const HISTORY_LIMIT = 30;
  const THEME_KEY = "jsonFormatter.theme";
  const SYNTAX_KEY = "jsonFormatter.syntax";
  const RAINBOW_KEY = "jsonFormatter.rainbow";
  const BRACKET_COLOR_COUNT = 6;

  // Plain-text version of what the output view shows (used by copy).
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

  // Syntax colors ("Cores do JSON") and rainbow brackets are pure CSS,
  // switched by data-syntax / data-rainbow on <body>.
  function readSetting(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function storeSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable; ignore
    }
  }

  function applySyntaxTheme(name) {
    const known = [...syntaxThemeEl.options].some((o) => o.value === name);
    const selected = known ? name : "default";
    document.body.dataset.syntax = selected;
    syntaxThemeEl.value = selected;
    storeSetting(SYNTAX_KEY, selected);
  }

  function applyRainbow(on) {
    document.body.dataset.rainbow = on ? "on" : "off";
    rainbowEl.checked = on;
    storeSetting(RAINBOW_KEY, on ? "on" : "off");
  }

  applySyntaxTheme(readSetting(SYNTAX_KEY, "default"));
  applyRainbow(readSetting(RAINBOW_KEY, "on") !== "off");
  syntaxThemeEl.addEventListener("change", () => applySyntaxTheme(syntaxThemeEl.value));
  rainbowEl.addEventListener("change", () => applyRainbow(rainbowEl.checked));

  // Colored input: the textarea's text is transparent and a <pre> behind it
  // shows the same text with brackets colored by depth (unmatched ones in
  // red) plus keys/values colored by kind. Scroll and size are kept in sync.
  const HIGHLIGHT_MAX_CHARS = 300000;
  // Above this, only brackets are colored (one span per token gets slow).
  const TOKEN_HIGHLIGHT_MAX_CHARS = 100000;
  let highlightQueued = false;

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function syncHighlightBox() {
    // clientWidth/Height exclude the textarea's scrollbar, so the text wraps
    // at the same width in both layers.
    inputHighlightEl.style.width = inputEl.clientWidth + "px";
    inputHighlightEl.style.height = inputEl.clientHeight + "px";
    inputHighlightEl.scrollTop = inputEl.scrollTop;
    inputHighlightEl.scrollLeft = inputEl.scrollLeft;
  }

  function renderInputHighlight() {
    highlightQueued = false;
    const text = inputEl.value;
    // A trailing space keeps a final empty line the same height as in the textarea.
    if (text.length > HIGHLIGHT_MAX_CHARS) {
      inputHighlightEl.textContent = text + " ";
    } else {
      const brackets = classifyBrackets(scanBrackets(text)).map((b) => ({
        pos: b.pos,
        end: b.pos + 1,
        cls: b.bad ? "hl-bad" : `jv-depth-${b.depth % BRACKET_COLOR_COUNT}`,
      }));
      const tokens = text.length > TOKEN_HIGHLIGHT_MAX_CHARS
        ? []
        : scanTokens(text).map((t) => ({ pos: t.pos, end: t.end, cls: `jv-${t.kind}` }));
      // Brackets are never inside a token, so the two lists don't overlap.
      let html = "";
      let from = 0;
      [...brackets, ...tokens].sort((a, b) => a.pos - b.pos).forEach((m) => {
        html += escapeHtml(text.slice(from, m.pos)) + `<span class="${m.cls}">${escapeHtml(text.slice(m.pos, m.end))}</span>`;
        from = m.end;
      });
      inputHighlightEl.innerHTML = html + escapeHtml(text.slice(from)) + " ";
    }
    syncHighlightBox();
  }

  function queueInputHighlight() {
    if (highlightQueued) return;
    highlightQueued = true;
    requestAnimationFrame(renderInputHighlight);
  }

  // The value is also set from code (history, file, clear, fixes); hook the
  // setter so every change is highlighted without touching each call site.
  const textareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  Object.defineProperty(inputEl, "value", {
    get() {
      return textareaValue.get.call(this);
    },
    set(text) {
      textareaValue.set.call(this, text);
      queueInputHighlight();
    },
  });

  inputEl.addEventListener("input", queueInputHighlight);
  inputEl.addEventListener("scroll", syncHighlightBox);
  new ResizeObserver(syncHighlightBox).observe(inputEl);
  queueInputHighlight();

  function loadHistory() {
    try {
      const entries = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  }

  // False when storage is unavailable (private mode) or full.
  function saveHistory(entries) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  // Most recent first, one entry per input (formatting the same text again,
  // e.g. after changing the indentation, just moves it to the top). When
  // storage is full the oldest entries are dropped; an input too big to fit
  // even alone is left out rather than wiping the rest.
  function addToHistory(entry) {
    const entries = [entry, ...loadHistory().filter((e) => e.input !== entry.input)].slice(0, HISTORY_LIMIT);
    for (let n = entries.length; n > 0; n--) {
      if (saveHistory(entries.slice(0, n))) break;
    }
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
      // The output isn't stored (it would double the size); formatting the
      // input again with the same settings gives it back.
      li.addEventListener("click", () => {
        inputEl.value = entry.input;
        templateEl.value = entry.template;
        specEl.value = entry.spec;
        fixEl.checked = entry.fix;
        format();
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

  // Syntax color class suffix (jv-str, jv-num...) for a non-container value.
  function primitiveKind(value) {
    if (value === null) return "null";
    if (value instanceof RawNumber) return "num";
    if (typeof value === "string") return "str";
    if (typeof value === "boolean") return "bool";
    return "num";
  }

  function bracket(char, depth) {
    const span = document.createElement("span");
    span.className = `jv-bracket jv-depth-${depth % BRACKET_COLOR_COUNT}`;
    span.textContent = char;
    return span;
  }

  // Renders value so its text matches stringify(value, indent) exactly
  // (selecting and copying from the view yields the same JSON), with each
  // non-empty object/array wrapped in a collapsible .jv-node.
  // marks (optional): Map of JSON.stringify(path) -> { label, openAdded,
  // closeAdded }, for containers whose brackets were added by an automatic
  // fix: the added brackets are highlighted (an existing opener only
  // outlined). The label goes next to the opener when only the opener was
  // added; otherwise it's returned for the caller to place at the end of the
  // closer's line (after any comma).
  function renderValue(parent, value, indent, depth, path = [], marks = null) {
    if (value === null || typeof value !== "object" || value instanceof RawNumber) {
      parent.append(span(`jv-${primitiveKind(value)}`, stringify(value)));
      return null;
    }

    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v) => [null, v]) : Object.entries(value);
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    const mark = marks === null ? undefined : marks.get(JSON.stringify(path));
    const openEl = bracket(open, depth);
    const closeEl = bracket(close, depth);
    if (mark) {
      openEl.classList.add(mark.openAdded ? "jv-missing" : "jv-unclosed");
      if (mark.closeAdded !== false) closeEl.classList.add("jv-missing");
    }
    const label = mark ? span("jv-missing-label", mark.label) : null;
    const labelAtOpen = mark !== undefined && mark.closeAdded === false;

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
    if (labelAtOpen) node.appendChild(label);

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
        line.append(span("jv-key", JSON.stringify(key)), pretty ? ": " : ":");
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
    return labelAtOpen ? null : label;
  }

  // marks: see renderValue (closers that were added automatically).
  function showOutput(value, indent, marks = null) {
    outputText = stringify(value, indent);
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

  // Shows the output of an automatically fixed text (key-valued keys wrapped
  // in { }, missing closers or commas added) with a warning above it listing
  // what was changed. fix: { value, marks?, fixed, spots?, closed?, commas? }
  // (commas: parseLenient's missingCommas); source/offset as in
  // showBracketRepair. Returns the summary for the status box.
  function showFixedOutput(fix, source, offset) {
    const spots = fix.spots ?? [];
    const closed = fix.closed ?? null;
    const commas = fix.commas ?? [];
    const input = inputEl.value;
    const shown = offset >= 0 ? input : source;
    const toShown = (pos) => (offset >= 0 ? offset + pos : pos);
    const lineShift = offset > 0 ? lineCol(input, offset).line - 1 : 0;
    const opener = (ins) => (ins.char === "}" ? "{" : "[");
    const openAt = (ins) => lineCol(shown, toShown(ins.open));
    // An indentation-based alternative only makes sense for closers alone.
    const alternative = spots.length ? null : closed?.alternative ?? null;

    const items = [];
    const summary = [];
    spots.forEach((sp) => {
      items.push(sp.openerOnly
        ? `A chave ${sp.outerKey} (linha ${sp.line + lineShift}) recebia outra chave como valor (${sp.innerKey}) ` +
          `e faltava abrir o '{': coloquei o '{' antes de ${sp.innerKey} (o '}' que fecha já estava lá).`
        : `A chave ${sp.outerKey} (linha ${sp.line + lineShift}) recebia outra chave como valor (${sp.innerKey}) ` +
          `sem '{ }': ficou ${sp.outerKey}: { ${sp.innerKey}: … }.`);
    });
    if (spots.length === 1) {
      const sp = spots[0];
      summary.push(sp.openerOnly
        ? `Faltava abrir o '{' no valor da chave ${sp.outerKey} (linha ${sp.line + lineShift}), que recebia outra chave; coloquei o '{'.`
        : `A chave ${sp.outerKey} (linha ${sp.line + lineShift}) recebia outra chave como valor; coloquei '{ }' em volta.`);
    } else if (spots.length) {
      summary.push(`${spots.length} chaves recebiam outra chave como valor; coloquei as chaves que faltavam.`);
    }
    if (closed) {
      closed.inserts.forEach((ins) => {
        const at = openAt(ins);
        items.push(`O '${opener(ins)}' da linha ${at.line}, coluna ${at.col} não tinha fechamento; ` +
          `o '${ins.char}' foi adicionado ${ins.where}.`);
      });
      const first = closed.inserts[0];
      summary.push(closed.inserts.length === 1
        ? `Faltava fechar o '${opener(first)}' da linha ${openAt(first).line}: o '${first.char}' foi adicionado ${first.where}.`
        : `Faltavam ${closed.inserts.length} fechamentos; foram adicionados automaticamente.`);
    }

    if (commas.length) {
      commas.forEach((c) => {
        const at = lineCol(shown, toShown(c.pos));
        items.push(`Faltava uma vírgula na linha ${at.line}, coluna ${at.col}, antes de ${c.before}; foi adicionada.`);
      });
      const at = lineCol(shown, toShown(commas[0].pos));
      summary.push(commas.length === 1
        ? `Faltava uma vírgula na linha ${at.line}, antes de ${commas[0].before}; foi adicionada.`
        : `Faltavam ${commas.length} vírgulas (a primeira na linha ${at.line}); foram adicionadas.`);
    }

    let titleText;
    if ([spots.length, closed, commas.length].filter(Boolean).length > 1) titleText = "Corrigi o JSON automaticamente";
    else if (commas.length === 1) titleText = "Faltava uma vírgula: adicionei";
    else if (commas.length) titleText = `Faltavam ${commas.length} vírgulas: adicionei`;
    else if (spots.length === 1 && spots[0].openerOnly) titleText = `Faltava abrir um '{': a chave ${spots[0].outerKey} recebia outra chave como valor`;
    else if (spots.length === 1) titleText = "Uma chave recebia outra chave como valor: coloquei as '{ }'";
    else if (spots.length) titleText = `${spots.length} chaves recebiam outra chave como valor: corrigi as chaves`;
    else if (closed.inserts.length === 1) titleText = `Faltava fechar um '${opener(closed.inserts[0])}': fechei automaticamente`;
    else titleText = `Faltavam ${closed.inserts.length} fechamentos: fechei automaticamente`;

    showOutput(fix.value, indentFor(templateEl.value), fix.marks);

    const banner = document.createElement("div");
    banner.className = "jv-warning";
    const title = document.createElement("div");
    title.className = "jv-warning-title";
    title.textContent = titleText;
    banner.appendChild(title);

    const list = document.createElement("ul");
    list.className = "jv-error-list";
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
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
    note.textContent = "Confira se a correção ficou certa (destacada abaixo). A entrada não foi alterada.";
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
    addButton("Aplicar a correção na entrada", fix.fixed);
    if (alternative) addButton("Inserir onde a indentação indica", alternative.fixed);
    banner.appendChild(actions);

    outputEl.prepend(banner);
    return summary.join(" ") + (alternative ? " Pela indentação, o lugar certo parece ser outro (veja na saída)." : " Confira na saída.");
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

    const FIX_NOTE = "Correções automáticas aplicadas (Fix JSON): chaves/valores sem aspas, comentários, vírgulas sobrando ou faltando etc.";

    // Output shown: status notes, then history.
    const finish = (notes, ok) => {
      setStatus(notes.length ? notes.join("\n") : "JSON válido.", ok && !notes.length ? "ok" : "error");
      addToHistory({
        timestamp: Date.now(),
        input: raw,
        template: templateEl.value,
        spec,
        fix: shouldFix,
        preview: raw.trim().slice(0, 80).replace(/\s+/g, " "),
      });
    };

    const fail = (source, info, offset) => {
      const closed = autoCloseBrackets(source, shouldFix);
      if (closed) {
        const summary = showFixedOutput({ value: closed.value, marks: closed.marks, fixed: closed.fixed, closed }, source, offset);
        finish([summary, ...(closed.usedLenient || source !== raw ? [FIX_NOTE] : []), ...warnings], false);
        return;
      }
      if (!reformatted && reformatInputForEditing(raw, source, offset)) {
        format({ unwrapped: source !== raw });
        return;
      }
      reportError(source, info, offset);
      if (reformatted) addReformatNote(reformatted.unwrapped);
    };

    // Reads `source` (the input, or the text inside quotes wrapping it).
    // Returns { value, usedFix, repaired? } or null after reporting the error.
    const read = (source, offset) => {
      try {
        return { value: parseJson(source), usedFix: source !== raw };
      } catch (strictErr) {
        const list = shouldFix ? wrapConcatenated(source) : null;
        if (list) {
          try {
            return { value: parseJson(list), usedFix: true, joined: true };
          } catch {
            try {
              return { value: parseLenient(list), usedFix: true, joined: true };
            } catch {
              // fall through: report the error against the original text
            }
          }
        }
        const repaired = repairNestedKeys(source, shouldFix);
        if (repaired) {
          return { value: repaired.value, usedFix: repaired.usedLenient || source !== raw, repaired: { ...repaired, source, offset } };
        }
        if (!shouldFix) {
          fail(source, strictErrorInfo(source, strictErr), offset);
          return null;
        }
        try {
          const report = {};
          const value = parseLenient(source, report);
          const commas = report.missingCommas;
          if (!commas.length) return { value, usedFix: true };
          return { value, usedFix: true, repaired: { commas, fixed: insertCommas(source, commas), source, offset } };
        } catch (lenientErr) {
          const wrapped = source === raw ? brokenWrapperInner(raw) : null;
          if (wrapped) return read(wrapped.text, wrapped.offset);
          fail(source, { pos: lenientErr.pos ?? null, message: lenientErr.message }, offset);
          return null;
        }
      }
    };

    const result = read(raw, 0);
    if (!result) return;
    let parsed = result.value;
    let usedFix = result.usedFix;
    let repaired = result.repaired ?? null;

    const { value: inner, unwrapped, error, repaired: layerRepair } = unwrapStringified(parsed, shouldFix);
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
    if (layerRepair) repaired = { ...layerRepair, value: parsed, offset: raw.indexOf(layerRepair.source) };

    const notes = [];
    if (result.joined) notes.push(`${parsed.length} objetos separados foram agrupados em um array.`);
    if (repaired) {
      notes.push(showFixedOutput({ ...repaired, value: parsed }, repaired.source, repaired.offset));
    } else {
      showOutput(parsed, indentFor(templateEl.value));
    }
    if (usedFix) notes.push(FIX_NOTE);
    notes.push(...warnings);
    finish(notes, !repaired);
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
