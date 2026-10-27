import { analyze, unpack } from "./analyze.js";
import {
  RawNumber,
  classifyBrackets,
  lineCol,
  scanBrackets,
  scanTokens,
  stringify,
} from "./parser.js";
import { formatPath, searchValue } from "./tree.js";

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
  const downloadBtn = document.getElementById("downloadBtn");
  const searchInput = document.getElementById("searchInput");
  const searchCount = document.getElementById("searchCount");
  const searchPrevBtn = document.getElementById("searchPrevBtn");
  const searchNextBtn = document.getElementById("searchNextBtn");
  const pathBar = document.getElementById("pathBar");
  const pathText = document.getElementById("pathText");
  const copyPathBtn = document.getElementById("copyPathBtn");
  const outputNote = document.getElementById("outputNote");
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
  // The value the output tree shows (searched by "Buscar"); undefined while
  // the output is empty or shows an error.
  let outputValue;
  // Name of the file last opened, reused when downloading the output.
  let fileName = null;

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

  // The output tree is built lazily so big JSON doesn't freeze the page:
  // about EAGER_LINES lines are built up front, blocks reached after that
  // start collapsed and are built when first opened, and a block gets at
  // most CHUNK_SIZE lines at a time (a "Mostrar mais" line adds the next).
  const EAGER_LINES = 5000;
  const CHUNK_SIZE = 2000;
  // "Expandir" (and Alt+click) stops building after this many lines.
  const EXPAND_ALL_LINES = 50000;
  // Compact output is one line of inline spans with nothing to collapse, so
  // it can't be built lazily; above this size it's shown as plain text.
  const COMPACT_TREE_MAX_CHARS = 500000;

  // Blocks with lines not built yet: .jv-node -> fill(budget), which builds
  // the next CHUNK_SIZE lines (or, with budget.all, every line, until
  // budget.left runs out). budget.left counts the lines left to build up
  // front; blocks met once it's used up start collapsed and unbuilt.
  const pendingBlocks = new WeakMap();

  // Renders value so its text, once fully built, matches stringify(value,
  // indent) exactly (selecting and copying from the view yields the same
  // JSON), with each non-empty object/array wrapped in a collapsible
  // .jv-node. Primitive values get .jv-val.
  // marks (optional): Map of JSON.stringify(path) -> { label, openAdded,
  // closeAdded }, for containers whose brackets were added by an automatic
  // fix: the added brackets are highlighted (an existing opener only
  // outlined). The label goes next to the opener when only the opener was
  // added; otherwise it's returned for the caller to place at the end of the
  // closer's line (after any comma).
  function renderValue(parent, value, indent, depth, path = [], marks = null, budget = { left: EAGER_LINES }) {
    if (value === null || typeof value !== "object" || value instanceof RawNumber) {
      parent.append(span(`jv-${primitiveKind(value)} jv-val`, stringify(value)));
      return null;
    }

    const isArray = Array.isArray(value);
    const keys = isArray ? null : Object.keys(value);
    const n = isArray ? value.length : keys.length;
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

    if (n === 0) {
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

    const summary = document.createElement("span");
    summary.className = "jv-summary";
    summary.textContent = isArray
      ? `${n} ${n === 1 ? "item" : "itens"}`
      : `${n} ${n === 1 ? "chave" : "chaves"}`;
    node.appendChild(summary);

    const children = document.createElement(pretty ? "div" : "span");
    children.className = "jv-children";
    node.appendChild(children);

    const renderLine = (idx, lineBudget) => {
      const key = isArray ? idx : keys[idx];
      const line = document.createElement(pretty ? "div" : "span");
      line.className = "jv-line";
      if (pretty) line.append(indent.repeat(depth + 1));
      if (!isArray) {
        line.append(span("jv-key", JSON.stringify(key)), pretty ? ": " : ":");
      }
      lineBudget.left--;
      const childPath = marks === null ? path : [...path, key];
      const childLabel = renderValue(line, value[key], indent, depth + 1, childPath, marks, lineBudget);
      if (idx < n - 1) line.append(",");
      if (childLabel) line.append(childLabel);
      return line;
    };

    let next = 0;
    let moreLine = null;
    const fill = (fillBudget) => {
      do {
        const end = pretty ? Math.min(n, next + CHUNK_SIZE) : n;
        for (; next < end; next++) children.insertBefore(renderLine(next, fillBudget), moreLine);
      } while (fillBudget.all && next < n && fillBudget.left > 0);
      if (next === n) {
        moreLine?.remove();
        pendingBlocks.delete(node);
        return;
      }
      if (!moreLine) {
        moreLine = document.createElement("div");
        moreLine.className = "jv-line jv-more";
        moreLine.append(indent.repeat(depth + 1));
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "jv-more-btn";
        moreLine.appendChild(btn);
        children.appendChild(moreLine);
      }
      const left = n - next;
      moreLine.lastChild.textContent = left <= CHUNK_SIZE
        ? `Mostrar ${left === 1 ? "o último" : `os ${left} restantes`}`
        : `Mostrar mais ${CHUNK_SIZE} (faltam ${left})`;
    };
    pendingBlocks.set(node, fill);
    if (pretty && depth > 0 && budget.left <= 0) {
      setCollapsed(node, true);
    } else {
      fill(budget);
    }

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
    if (indent === null && outputText.length > COMPACT_TREE_MAX_CHARS) {
      root.textContent = outputText;
    } else {
      const rootLabel = renderValue(root, value, indent, 0, [], marks);
      if (rootLabel) root.appendChild(rootLabel);
    }
    outputEl.classList.remove("has-error");
    outputEl.replaceChildren(root);
    outputChanged(value);
  }

  // Also drops the result of any format() still running in the worker.
  function clearOutput() {
    formatSeq++;
    outputText = "";
    outputEl.classList.remove("has-error");
    outputEl.replaceChildren();
    outputChanged(undefined);
  }

  // Called whenever the output view is replaced.
  function outputChanged(value) {
    outputValue = value;
    pathBar.hidden = true;
    outputNote.hidden = true;
    runSearch(false);
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
    outputChanged(undefined);

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

  // Missing-bracket errors get the repair view (repair: analyze()'s
  // suggestion); anything else the plain one.
  function reportError(source, info, offset, repair) {
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
    outputChanged(undefined);
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

  function builtLines(node) {
    const children = node.querySelector(":scope > .jv-children");
    return children.childElementCount - (children.lastElementChild?.classList.contains("jv-more") ? 1 : 0);
  }

  // Opens a block, building its first lines if it was never opened (all of
  // its lines with budget.all).
  function expandBlock(node, budget = { left: EAGER_LINES }) {
    const fill = pendingBlocks.get(node);
    if (fill && (budget.all || builtLines(node) === 0)) fill(budget);
    setCollapsed(node, false);
  }

  // Opens every block in `scope` (the output, or a block on Alt+click),
  // building at most EXPAND_ALL_LINES lines. False if some were left
  // unbuilt (and their blocks collapsed).
  function expandAll(scope) {
    const budget = { left: EXPAND_ALL_LINES, all: true };
    let complete = true;
    const nodes = scope.classList.contains("jv-node") ? [scope, ...scope.querySelectorAll(".jv-node")] : scope.querySelectorAll(".jv-node");
    nodes.forEach((node) => {
      if (budget.left <= 0 && pendingBlocks.has(node)) {
        complete = false;
        return;
      }
      expandBlock(node, budget);
    });
    // Blocks met after the budget ran out were left collapsed.
    return complete && budget.left > 0;
  }

  function showNote(text) {
    outputNote.textContent = text;
    outputNote.hidden = false;
  }

  function noteIfPartial(complete) {
    if (complete) return;
    showNote(`O JSON é grande demais para expandir tudo de uma vez: parei após ${EXPAND_ALL_LINES.toLocaleString("pt-BR")} linhas. ` +
      "Os blocos que ficaram recolhidos abrem com um clique.");
  }

  // Keys/indices from the root to the value on `line`, read from the view.
  function pathOfLine(line) {
    const keys = [];
    for (let el = line; el?.parentElement.classList.contains("jv-children"); el = el.parentElement.closest(".jv-line")) {
      const keyEl = el.querySelector(":scope > .jv-key");
      keys.unshift(keyEl ? JSON.parse(keyEl.textContent) : Array.prototype.indexOf.call(el.parentElement.children, el));
    }
    return keys;
  }

  function showPath(keys) {
    pathText.textContent = formatPath(keys);
    pathBar.hidden = false;
  }

  // Click the arrow, a bracket or the "N chaves" summary to fold/unfold.
  // Alt+click applies the same state to every nested block. Clicking a key
  // or a value shows its path.
  outputEl.addEventListener("click", (e) => {
    const more = e.target.closest(".jv-more-btn");
    if (more) {
      const node = more.closest(".jv-node");
      pendingBlocks.get(node)?.({ left: EAGER_LINES });
      return;
    }

    const item = e.target.closest(".jv-key, .jv-val");
    if (item && outputValue !== undefined && window.getSelection().isCollapsed) {
      showPath(pathOfLine(item.closest(".jv-line")));
      return;
    }

    const target = e.target.closest(".jv-toggle, .jv-bracket, .jv-summary");
    if (!target) return;
    // Empty {} / [] brackets sit directly in a line, not in their own node.
    const node = target.parentElement;
    if (!node.classList.contains("jv-node")) return;
    // Don't fold when the user is drag-selecting text across a bracket.
    if (!target.classList.contains("jv-toggle") && !window.getSelection().isCollapsed) return;

    const collapsed = !node.classList.contains("jv-collapsed");
    if (collapsed) {
      setCollapsed(node, true);
      if (e.altKey) node.querySelectorAll(".jv-node").forEach((child) => setCollapsed(child, true));
    } else if (e.altKey) {
      noteIfPartial(expandAll(node));
    } else {
      expandBlock(node);
    }
  });

  expandAllBtn.addEventListener("click", () => noteIfPartial(expandAll(outputEl)));

  // Keeps the root open so the top-level keys stay visible.
  collapseAllBtn.addEventListener("click", () => {
    outputEl.querySelectorAll(".jv-node").forEach((node) => setCollapsed(node, node.dataset.depth !== "0"));
  });

  // "Buscar" searches the shown value (not the DOM, which may not be fully
  // built) and opens the blocks on the way to the current match.
  const SEARCH_LIMIT = 1000;
  let search = { matches: [], truncated: false, current: -1 };
  let searchTimer = null;

  // Opens the blocks down to a match and returns its key or value element,
  // or null when the output isn't a tree (compact plain text).
  function revealMatch({ steps, on }) {
    let line = outputEl.querySelector(":scope > .jv-line");
    for (const step of steps) {
      const node = line.querySelector(":scope > .jv-node");
      if (!node) return null;
      expandBlock(node);
      while (pendingBlocks.has(node) && builtLines(node) <= step) pendingBlocks.get(node)({ left: EAGER_LINES });
      line = node.querySelector(":scope > .jv-children").children[step];
    }
    return line.querySelector(on === "key" ? ":scope > .jv-key" : ":scope > .jv-val");
  }

  function updateSearchCount() {
    const { matches, truncated, current } = search;
    if (!searchInput.value) searchCount.textContent = "";
    else if (outputValue === undefined) searchCount.textContent = "sem saída";
    else if (!matches.length) searchCount.textContent = "nada encontrado";
    else searchCount.textContent = `${current < 0 ? "–" : current + 1}/${matches.length}${truncated ? "+" : ""}`;
  }

  function goToMatch(index) {
    const n = search.matches.length;
    if (!n) return;
    search.current = (index + n) % n;
    const match = search.matches[search.current];
    outputEl.querySelector(".jv-match")?.classList.remove("jv-match");
    const el = revealMatch(match);
    if (el) {
      el.classList.add("jv-match");
      el.scrollIntoView({ block: "center", inline: "nearest" });
    }
    showPath(match.keys);
    updateSearchCount();
  }

  // jump: go to the first match (when the query changes; not when the
  // output does).
  function runSearch(jump) {
    clearTimeout(searchTimer);
    searchTimer = null;
    outputEl.querySelector(".jv-match")?.classList.remove("jv-match");
    const query = searchInput.value;
    search = outputValue === undefined
      ? { matches: [], truncated: false, current: -1 }
      : { ...searchValue(outputValue, query, SEARCH_LIMIT), current: -1 };
    if (jump && search.matches.length) goToMatch(0);
    else updateSearchCount();
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(true), 200);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      runSearch(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchTimer !== null) runSearch(true);
      else stepMatch(e.shiftKey ? -1 : 1);
    }
  });

  // Next (+1) / previous (-1) match; before any, the first / last one.
  function stepMatch(delta) {
    goToMatch(search.current < 0 ? (delta > 0 ? 0 : -1) : search.current + delta);
  }

  searchNextBtn.addEventListener("click", () => stepMatch(1));
  searchPrevBtn.addEventListener("click", () => stepMatch(-1));

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

  // Inputs this long are analyzed in worker.js, so the page stays usable
  // (and shows "Processando…") while big or broken JSON is worked through.
  const WORKER_MIN_CHARS = 200000;
  let worker = null;
  let workerFailed = false;
  let workerJobId = 0;
  const workerJobs = new Map(); // id -> { resolve, reject }

  function stopWorker(reason) {
    worker?.terminate();
    worker = null;
    workerJobs.forEach((job) => job.reject(new Error(reason)));
    workerJobs.clear();
  }

  function startWorker() {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    w.addEventListener("message", ({ data }) => {
      const job = workerJobs.get(data.id);
      if (!job) return;
      workerJobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(unpack(data.packed));
    });
    // Module workers unsupported, or worker.js failed to load: analyze on
    // the page from now on.
    w.addEventListener("error", () => {
      workerFailed = true;
      stopWorker("worker failed");
    });
    return w;
  }

  // analyze() in the worker. A job still running is for an older format()
  // whose result would be dropped anyway, so the worker is restarted
  // instead of making this one wait for it.
  function analyzeInWorker(raw, options) {
    if (workerJobs.size) stopWorker("superseded");
    try {
      if (!worker) worker = startWorker();
    } catch {
      workerFailed = true;
      return Promise.reject(new Error("no worker"));
    }
    const id = ++workerJobId;
    return new Promise((resolve, reject) => {
      workerJobs.set(id, { resolve, reject });
      worker.postMessage({ id, raw, options });
    });
  }

  // Bumped by every format() and clearOutput(); a worker result for an
  // older one is dropped.
  let formatSeq = 0;

  // reformatted: set when the input was just re-indented after an error, so
  // the error is reported on the new text (and not re-indented again).
  function format(reformatted = null) {
    const raw = inputEl.value;
    if (!raw.trim()) {
      clearOutput();
      setStatus("");
      return;
    }

    const seq = ++formatSeq;
    const options = {
      spec: specEl.value,
      fix: fixEl.checked,
      indent: indentFor(templateEl.value) ?? "  ",
      reformatted: reformatted !== null,
    };
    if (raw.length < WORKER_MIN_CHARS || workerFailed) {
      present(raw, options, analyze(raw, options), reformatted);
      return;
    }

    setStatus("Processando…", "busy");
    analyzeInWorker(raw, options)
      .catch(() => (seq === formatSeq ? analyze(raw, options) : null))
      .then((result) => {
        if (seq !== formatSeq) return;
        // Edited while it ran: the positions in the result no longer match.
        if (inputEl.value !== raw) setStatus("");
        else present(raw, options, result, reformatted);
      });
  }

  // Shows analyze()'s result for `raw`, which is still the input.
  function present(raw, options, result, reformatted) {
    const { warnings } = result;
    const FIX_NOTE = "Correções automáticas aplicadas (Fix JSON): chaves/valores sem aspas, comentários, vírgulas sobrando ou faltando etc.";

    // Output shown: status notes, then history.
    const finish = (notes, ok) => {
      setStatus(notes.length ? notes.join("\n") : "JSON válido.", ok && !notes.length ? "ok" : "error");
      addToHistory({
        timestamp: Date.now(),
        input: raw,
        template: templateEl.value,
        spec: options.spec,
        fix: options.fix,
        preview: raw.trim().slice(0, 80).replace(/\s+/g, " "),
      });
    };

    if (result.fail) {
      const { source, info, offset, closed, reformat, repair } = result.fail;
      if (closed) {
        const summary = showFixedOutput({ value: closed.value, marks: closed.marks, fixed: closed.fixed, closed }, source, offset);
        finish([summary, ...(closed.usedLenient || source !== raw ? [FIX_NOTE] : []), ...warnings], false);
      } else if (reformat !== null) {
        replaceInput(reformat);
        format({ unwrapped: source !== raw });
      } else {
        reportError(source, info, offset, repair);
        if (reformatted) addReformatNote(reformatted.unwrapped);
      }
      return;
    }

    const { value, usedFix, joined, repaired } = result.ok;
    const notes = [];
    if (joined) notes.push(`${value.length} objetos separados foram agrupados em um array.`);
    if (repaired) {
      notes.push(showFixedOutput({ ...repaired, value }, repaired.source, repaired.offset));
    } else {
      showOutput(value, indentFor(templateEl.value));
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

  // Ctrl+Enter (⌘+Enter on Mac) formats from anywhere on the page.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      format();
    }
  });

  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    fileName = null;
    clearOutput();
    setStatus("");
    inputEl.focus();
  });

  function loadFile(file) {
    file.text().then((text) => {
      fileName = file.name;
      inputEl.value = text;
      format();
    }, () => setStatus(`Não consegui ler o arquivo ${file.name}.`, "error"));
  }

  openFileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) loadFile(file);
    fileInput.value = "";
  });

  // Dropping a file on the input opens it (dragged text keeps the
  // textarea's normal behavior).
  const inputWrap = inputEl.parentElement;
  const dragsFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  inputWrap.addEventListener("dragover", (e) => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    inputWrap.classList.add("dragging");
  });
  inputWrap.addEventListener("dragleave", (e) => {
    if (!inputWrap.contains(e.relatedTarget)) inputWrap.classList.remove("dragging");
  });
  inputWrap.addEventListener("drop", (e) => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    inputWrap.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // Copies text, briefly confirming on the button. False if it failed.
  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      document.body.appendChild(tmp);
      tmp.select();
      const ok = document.execCommand("copy");
      tmp.remove();
      if (!ok) return false;
    }
    const label = button.textContent;
    button.textContent = "Copiado!";
    setTimeout(() => (button.textContent = label), 1200);
    return true;
  }

  copyBtn.addEventListener("click", () => {
    if (outputText) copyText(outputText, copyBtn);
  });

  copyPathBtn.addEventListener("click", () => copyText(pathText.textContent, copyPathBtn));

  // Saves the output as <opened file's name>.json, or formatado.json.
  downloadBtn.addEventListener("click", () => {
    if (!outputText) return;
    const url = URL.createObjectURL(new Blob([outputText], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName ? fileName.replace(/\.[^.]*$/, "") + ".json" : "formatado.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
