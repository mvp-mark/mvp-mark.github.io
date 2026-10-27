import { analyze, unpack } from "./analyze.js";
import { toCsv, toYaml } from "./convert.js";
import { openHistory } from "./history-store.js";
import { DEFAULT_LOCALE, LOCALES, getLocale, localeTag, matchLocale, setLocale, t, tIn } from "./i18n.js";
import {
  RawNumber,
  classifyBrackets,
  lineCol,
  scanBrackets,
  scanTokens,
  stringify,
} from "./parser.js";
import { SHARE_PREFIX, decodeShare, encodeShare } from "./share.js";
import { diffValues, formatPath, searchValue, sortKeys } from "./tree.js";

(function () {
  const inputEl = document.getElementById("input");
  const inputHighlightEl = document.getElementById("inputHighlight");
  const outputEl = document.getElementById("output");
  const templateEl = document.getElementById("template");
  const specEl = document.getElementById("spec");
  const fixEl = document.getElementById("fixJson");
  const sortEl = document.getElementById("sortKeys");
  const outputFormatEl = document.getElementById("outputFormat");
  const inputWrap = document.getElementById("inputWrap");
  const largeInputEl = document.getElementById("largeInput");
  const largeInputInfo = document.getElementById("largeInputInfo");
  const largeShowBtn = document.getElementById("largeShowBtn");
  const shareBtn = document.getElementById("shareBtn");
  const diffBtn = document.getElementById("diffBtn");
  const diffDialog = document.getElementById("diffDialog");
  const diffInput = document.getElementById("diffInput");
  const diffRunBtn = document.getElementById("diffRunBtn");
  const diffCloseBtn = document.getElementById("diffCloseBtn");
  const diffSummary = document.getElementById("diffSummary");
  const diffList = document.getElementById("diffList");
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
  const languageEl = document.getElementById("language");
  const langHint = document.getElementById("langHint");
  const langHintLink = document.getElementById("langHintLink");
  const langHintClose = document.getElementById("langHintClose");

  const HISTORY_LIMIT = 30;
  const THEME_KEY = "jsonFormatter.theme";
  const SYNTAX_KEY = "jsonFormatter.syntax";
  const RAINBOW_KEY = "jsonFormatter.rainbow";
  const SORT_KEY = "jsonFormatter.sortKeys";
  const OUTPUT_FORMAT_KEY = "jsonFormatter.outputFormat";
  const LANGUAGE_KEY = "jsonFormatter.language";
  const LANGUAGE_HINT_KEY = "jsonFormatter.languageHintDismissed";
  const BRACKET_COLOR_COUNT = 6;

  // Plain-text version of what the output view shows (used by copy).
  let outputText = "";
  // The value the output tree shows (searched by "Buscar"); undefined while
  // the output is empty or shows an error.
  let outputValue;
  // Name of the file last opened, reused when downloading the output.
  let fileName = null;

  // Language. Every language has its own static page, built by
  // scripts/build-pages.js for search engines, whose <html data-locale>
  // says which; the Portuguese one at the site root is also the default
  // (x-default). The page's language is used, except that the root switches
  // to the language picked before (people have one saved, crawlers don't)
  // and ?lang=xx (older links) picks one. The browser's language is only
  // offered (updateLanguageHint), never switched to by itself, so every
  // URL always shows the same language to everyone.
  // The page's own texts are marked with data-i18n (text), data-i18n-html
  // (markup) and data-i18n-attr ("title=key;aria-label=key"); everything
  // else calls t().
  const isLocale = (code) => Object.prototype.hasOwnProperty.call(LOCALES, code ?? "");
  const pageLocale = isLocale(document.documentElement.dataset.locale) ? document.documentElement.dataset.locale : DEFAULT_LOCALE;
  const siteRoot = new URL(document.documentElement.dataset.root ?? "./", location.href);
  const localeUrl = (code) => new URL(code === DEFAULT_LOCALE ? "" : `${code}/`, siteRoot);

  function savedLocale() {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      return isLocale(saved) ? saved : null;
    } catch {
      return null;
    }
  }

  const requestedLocale = new URLSearchParams(location.search).get("lang");
  setLocale(isLocale(requestedLocale) ? requestedLocale
    : pageLocale === DEFAULT_LOCALE && savedLocale() ? savedLocale()
    : pageLocale);

  // Relative links in <head> would resolve against the new address once
  // showLocaleInUrl changes it (the browser fetches the icon again), so
  // they're made absolute first.
  document.querySelectorAll("link[href]").forEach((link) => link.setAttribute("href", link.href));

  // Shows the current language's page address (no reload), so it can be
  // bookmarked and shared.
  function showLocaleInUrl() {
    const url = localeUrl(getLocale());
    url.hash = location.hash;
    if (url.href !== location.href) window.history.replaceState(null, "", url);
  }

  function translatePage() {
    document.documentElement.lang = localeTag();
    document.title = t("page.title");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split("=");
        el.setAttribute(attr, t(key));
      });
    });
  }

  languageEl.value = getLocale();
  if (getLocale() !== pageLocale) {
    translatePage();
    showLocaleInUrl();
  }

  function applyTheme(theme) {
    const selected = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = selected;
    themeToggle.textContent = t(selected === "dark" ? "theme.toLight" : "theme.toDark");
    themeToggle.setAttribute("aria-label", t(selected === "dark" ? "theme.toLightLabel" : "theme.toDarkLabel"));
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

  // "Ordenar chaves" and the output format (JSON/YAML/CSV) are remembered;
  // changing them formats again (see the listeners near the end).
  sortEl.checked = readSetting(SORT_KEY, "off") === "on";
  outputFormatEl.value = readSetting(OUTPUT_FORMAT_KEY, "json");
  if (!outputFormatEl.value) outputFormatEl.value = "json";
  sortEl.addEventListener("change", () => storeSetting(SORT_KEY, sortEl.checked ? "on" : "off"));
  outputFormatEl.addEventListener("change", () => storeSetting(OUTPUT_FORMAT_KEY, outputFormatEl.value));

  // Colored input: the textarea's text is transparent and a <pre> behind it
  // shows the same text with brackets colored by depth (unmatched ones in
  // red) plus keys/values colored by kind. Scroll and size are kept in sync.
  // Above this the <pre> is dropped (.plain) and the textarea shows its own
  // text: laying the text out twice is what makes big inputs slow.
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
    const text = largeText === null ? inputEl.value : "";
    const plain = text.length > HIGHLIGHT_MAX_CHARS;
    inputWrap.classList.toggle("plain", plain);
    // A trailing space keeps a final empty line the same height as in the textarea.
    if (plain) {
      inputHighlightEl.textContent = "";
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

  // Inputs bigger than this aren't put in the textarea at all: laying out a
  // few MB of text there freezes the page for seconds, highlight or not.
  // The text is kept in largeText (inputEl.value returns it) and a summary
  // is shown instead, until the user asks to see it anyway.
  const LARGE_INPUT_CHARS = 500000;
  let largeText = null;
  // Set by "Mostrar o texto mesmo assim"; reset when other text is loaded.
  let showLargeInput = false;

  function updateLargeInput() {
    const large = largeText !== null;
    inputWrap.classList.toggle("large", large);
    largeInputEl.hidden = !large;
    if (!large) return;
    let lines = 1;
    for (let i = largeText.indexOf("\n"); i !== -1; i = largeText.indexOf("\n", i + 1)) lines++;
    const mb = (new Blob([largeText]).size / 1048576).toLocaleString(localeTag(), { maximumFractionDigits: 1 });
    largeInputInfo.textContent = t("large.info", { size: mb, lines: lines.toLocaleString(localeTag()) });
  }

  // The value is also set from code (history, file, clear, fixes); hook the
  // setter so every change is highlighted (and big text kept out of the
  // textarea) without touching each call site.
  const textareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  Object.defineProperty(inputEl, "value", {
    get() {
      return largeText ?? textareaValue.get.call(this);
    },
    set(text) {
      const large = text.length > LARGE_INPUT_CHARS && !showLargeInput;
      largeText = large ? text : null;
      textareaValue.set.call(this, large ? "" : text);
      updateLargeInput();
      queueInputHighlight();
    },
  });

  // Puts big text in the textarea after all (slow, but it can be edited).
  function showFullInput() {
    if (largeText === null) return;
    showLargeInput = true;
    inputEl.value = largeText;
  }

  largeShowBtn.addEventListener("click", () => {
    showFullInput();
    inputEl.focus();
  });

  // Pasting something big goes straight to the summary (and is formatted,
  // since it can't be seen). With the summary shown, pasting anywhere
  // outside a field replaces the input.
  inputEl.addEventListener("paste", (e) => {
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    const current = textareaValue.get.call(inputEl);
    const next = current.slice(0, inputEl.selectionStart) + pasted + current.slice(inputEl.selectionEnd);
    if (next.length <= LARGE_INPUT_CHARS || showLargeInput) return;
    e.preventDefault();
    inputEl.value = next;
    format();
  });

  document.addEventListener("paste", (e) => {
    if (largeText === null || e.target.closest?.("input, textarea, select, dialog")) return;
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    if (!pasted) return;
    e.preventDefault();
    showLargeInput = false;
    inputEl.value = pasted;
    format();
  });

  inputEl.addEventListener("input", queueInputHighlight);
  inputEl.addEventListener("scroll", syncHighlightBox);
  new ResizeObserver(syncHighlightBox).observe(inputEl);
  queueInputHighlight();

  // See history-store.js (IndexedDB, or localStorage where unavailable).
  const historyReady = openHistory(HISTORY_LIMIT);

  // Most recent first, one entry per input (formatting the same text again,
  // e.g. after changing the indentation, just moves it to the top).
  async function addToHistory(entry, input) {
    const history = await historyReady;
    await history.add(entry, input);
    renderHistory();
  }

  async function renderHistory() {
    const history = await historyReady;
    const entries = await history.list();
    historyListEl.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = t("history.empty");
      historyListEl.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.title = t("history.reload");

      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = new Date(entry.timestamp).toLocaleString(localeTag());

      const preview = document.createElement("span");
      preview.className = "history-preview";
      preview.textContent = entry.preview;

      li.appendChild(time);
      li.appendChild(preview);
      // The output isn't stored (it would double the size); formatting the
      // input again with the same settings gives it back.
      li.addEventListener("click", async () => {
        const input = await history.getInput(entry);
        showLargeInput = false;
        inputEl.value = input;
        templateEl.value = entry.template;
        specEl.value = entry.spec;
        fixEl.checked = entry.fix;
        if (entry.sort !== undefined) sortEl.checked = entry.sort;
        format();
      });

      historyListEl.appendChild(li);
    });
  }

  historyClearBtn.addEventListener("click", async () => {
    await (await historyReady).clear();
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
      toggle.setAttribute("aria-label", t("tree.toggle"));
      toggle.setAttribute("aria-expanded", "true");
      node.appendChild(toggle);
    }
    node.appendChild(openEl);
    if (labelAtOpen) node.appendChild(label);

    const summary = document.createElement("span");
    summary.className = "jv-summary";
    summary.textContent = t(isArray ? "tree.items" : "tree.keys", { count: n });
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
        ? t("tree.showRest", { count: left })
        : t("tree.showMore", { chunk: CHUNK_SIZE, left });
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

  // What "Copiar"/"Baixar" give: the output text and its file type, which
  // follow the output format chosen (JSON, YAML or CSV).
  let outputType = { ext: "json", mime: "application/json" };
  const OUTPUT_TYPES = {
    json: { ext: "json", mime: "application/json" },
    yaml: { ext: "yaml", mime: "application/yaml" },
    csv: { ext: "csv", mime: "text/csv" },
  };

  // marks: see renderValue (closers that were added automatically).
  // YAML/CSV output is plain text; search still works on the value (and
  // shows the path of each match).
  function showOutput(value, indent, marks = null) {
    const kind = outputFormatEl.value;
    const converted = kind === "yaml" ? toYaml(value) : kind === "csv" ? toCsv(value) : null;
    const csvFailed = kind === "csv" && converted === null;
    outputType = OUTPUT_TYPES[csvFailed ? "json" : kind];
    outputText = converted ?? stringify(value, indent);

    const root = document.createElement("div");
    root.className = "jv-line";
    if (converted !== null || (indent === null && outputText.length > COMPACT_TREE_MAX_CHARS)) {
      root.textContent = outputText;
    } else {
      const rootLabel = renderValue(root, value, indent, 0, [], marks);
      if (rootLabel) root.appendChild(rootLabel);
    }
    outputEl.classList.remove("has-error");
    outputEl.replaceChildren(root);
    outputChanged(value);
    if (csvFailed) showNote(t("note.csvNeedsArray"));
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
    cursorLine = null;
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
    const spotParams = (sp) => ({ outer: sp.outerKey, inner: sp.innerKey, line: sp.line + lineShift });
    spots.forEach((sp) => {
      items.push(t(sp.openerOnly ? "fix.item.openerOnly" : "fix.item.wrapped", spotParams(sp)));
    });
    if (spots.length === 1) {
      summary.push(t(spots[0].openerOnly ? "fix.summary.openerOnly" : "fix.summary.wrapped", spotParams(spots[0])));
    } else if (spots.length) {
      summary.push(t("fix.summary.manyKeys", { count: spots.length }));
    }
    if (closed) {
      closed.inserts.forEach((ins) => {
        const at = openAt(ins);
        items.push(t("fix.item.closer", { open: opener(ins), line: at.line, col: at.col, char: ins.char, where: ins.where }));
      });
      const first = closed.inserts[0];
      summary.push(closed.inserts.length === 1
        ? t("fix.summary.closer", { open: opener(first), line: openAt(first).line, char: first.char, where: first.where })
        : t("fix.summary.closers", { count: closed.inserts.length }));
    }

    if (commas.length) {
      commas.forEach((c) => {
        const at = lineCol(shown, toShown(c.pos));
        items.push(t("fix.item.comma", { line: at.line, col: at.col, before: c.before }));
      });
      const at = lineCol(shown, toShown(commas[0].pos));
      summary.push(commas.length === 1
        ? t("fix.summary.comma", { line: at.line, before: commas[0].before })
        : t("fix.summary.commas", { count: commas.length, line: at.line }));
    }

    let titleText;
    if ([spots.length, closed, commas.length].filter(Boolean).length > 1) titleText = t("fix.title.many");
    else if (commas.length) titleText = t("fix.title.commas", { count: commas.length });
    else if (spots.length === 1 && spots[0].openerOnly) titleText = t("fix.title.openerOnly", { outer: spots[0].outerKey });
    else if (spots.length) titleText = t("fix.title.keys", { count: spots.length });
    else titleText = t("fix.title.closers", { count: closed.inserts.length, open: opener(closed.inserts[0]) });

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
      hint.textContent = t("fix.alternative", {
        list: alternative.inserts
          .map((ins) => t("fix.alternativeItem", { char: ins.char, open: opener(ins), line: openAt(ins).line, where: ins.where }))
          .join("; "),
      });
      banner.appendChild(hint);
    }

    const note = document.createElement("div");
    note.className = "jv-error-note";
    note.textContent = t("fix.check");
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
    addButton(t("fix.apply"), fix.fixed);
    if (alternative) addButton(t("fix.applyAlternative"), alternative.fixed);
    banner.appendChild(actions);

    outputEl.prepend(banner);
    return [...summary, t(alternative ? "fix.seeAlternative" : "fix.seeOutput")].join(" ");
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
    title.textContent = t("repair.title", { count: inserts.length, open: first.char === "}" ? "{" : "[", line: firstOpen.line });
    box.appendChild(title);

    const list = document.createElement("ul");
    list.className = "jv-error-list";
    inserts.forEach((ins) => {
      const open = lineCol(shown, toShown(ins.open));
      const li = document.createElement("li");
      li.textContent = t("repair.item", { open: ins.char === "}" ? "{" : "[", line: open.line, col: open.col, char: ins.char, where: ins.where });
      list.appendChild(li);
    });
    box.appendChild(list);

    if (!fromInput) {
      const note = document.createElement("div");
      note.className = "jv-error-note";
      note.textContent = t("error.quotedNote");
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
    applyBtn.textContent = t("repair.apply", { count: inserts.length, char: first.char });
    applyBtn.addEventListener("click", () => applyFixToInput(input, source, offset, repair.fixed));
    actions.appendChild(applyBtn);
    if (fromInput) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "copy-btn";
      jump.textContent = t("error.showInInput");
      jump.addEventListener("click", () => {
        const pos = toShown(firstInsert.pos);
        showFullInput();
        inputEl.focus({ preventScroll: true });
        inputEl.setSelectionRange(pos, pos);
        scrollInputTo(pos);
      });
      actions.appendChild(jump);
    }
    box.appendChild(actions);

    const previewTitle = document.createElement("div");
    previewTitle.className = "jv-error-preview-title";
    previewTitle.textContent = t("repair.previewTitle");
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
      t("repair.status", { title: title.textContent, char: first.char, where: first.where, line: where.line, col: where.col }),
      "error"
    );
  }

  // Replaces the input text keeping the browser's undo history (Ctrl+Z)
  // where execCommand is supported (not for text kept out of the textarea).
  function replaceInput(text) {
    if (largeText !== null || (text.length > LARGE_INPUT_CHARS && !showLargeInput)) {
      inputEl.value = text;
      return;
    }
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
    note.textContent = t(unwrapped ? "reformat.unwrapped" : "reformat.oneLine");
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
    title.textContent = where ? t("error.at", { line: where.line, col: where.col }) : t("error.generic");
    const msg = document.createElement("div");
    msg.className = "jv-error-msg";
    msg.textContent = message;
    box.append(title, msg);

    if (!fromInput) {
      const note = document.createElement("div");
      note.className = "jv-error-note";
      note.textContent = t("error.quotedNote");
      box.appendChild(note);
    }

    if (where) box.appendChild(renderErrorContext(source, where));

    if (where && fromInput) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "copy-btn jv-error-jump";
      jump.textContent = t("error.showInInput");
      jump.addEventListener("click", () => {
        showFullInput();
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
      `${title.textContent}: ${message}`,
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
    showNote(t("note.expandPartial", { lines: EXPAND_ALL_LINES.toLocaleString(localeTag()) }));
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
      setCursor(item.closest(".jv-line"));
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

  // Opens the blocks down to the line at `steps` (entry positions, as in
  // searchValue) and returns it, or null when the output isn't a tree
  // (plain text).
  function revealPath(steps) {
    let line = outputEl.querySelector(":scope > .jv-line");
    for (const step of steps) {
      const node = line?.querySelector(":scope > .jv-node");
      if (!node) return null;
      expandBlock(node);
      while (pendingBlocks.has(node) && builtLines(node) <= step) pendingBlocks.get(node)({ left: EAGER_LINES });
      line = node.querySelector(":scope > .jv-children").children[step];
    }
    return line;
  }

  // A match's key or value element, its blocks opened (null if none).
  function revealMatch({ steps, on }) {
    const line = revealPath(steps);
    return line && line.querySelector(on === "key" ? ":scope > .jv-key" : ":scope > .jv-val");
  }

  function updateSearchCount() {
    const { matches, truncated, current } = search;
    if (!searchInput.value) searchCount.textContent = "";
    else if (outputValue === undefined) searchCount.textContent = t("search.noOutput");
    else if (!matches.length) searchCount.textContent = t("search.none");
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

  // Keyboard navigation in the output (focus it, or click a key/value):
  // ↑/↓ move between lines, → opens a block or goes into it, ← closes it or
  // goes to the parent, Enter/Space opens/closes (or loads "Mostrar mais"),
  // Home/End go to the first/last line. The current line's path is shown.
  let cursorLine = null;

  function setCursor(line) {
    cursorLine?.classList.remove("jv-cursor");
    cursorLine = line;
    if (!line) return;
    line.classList.add("jv-cursor");
    line.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!line.classList.contains("jv-more")) showPath(pathOfLine(line));
  }

  const nodeOf = (line) => line.querySelector(":scope > .jv-node");
  const isOpen = (node) => node !== null && !node.classList.contains("jv-collapsed");
  const childLines = (node) => node.querySelector(":scope > .jv-children").children;
  const inBlock = (line) => line.parentElement.classList.contains("jv-children");
  const parentLine = (line) => (inBlock(line) ? line.parentElement.closest(".jv-line") : null);

  // The last line shown inside `line` (itself when it's closed or a value).
  function lastShown(line) {
    for (let node = nodeOf(line); isOpen(node) && childLines(node).length; node = nodeOf(line)) {
      const lines = childLines(node);
      line = lines[lines.length - 1];
    }
    return line;
  }

  function nextLine(line) {
    const node = nodeOf(line);
    if (isOpen(node) && childLines(node).length) return childLines(node)[0];
    for (let el = line; el; el = parentLine(el)) {
      if (inBlock(el) && el.nextElementSibling) return el.nextElementSibling;
    }
    return null;
  }

  function prevLine(line) {
    const prev = inBlock(line) ? line.previousElementSibling : null;
    return prev ? lastShown(prev) : parentLine(line);
  }

  outputEl.addEventListener("keydown", (e) => {
    if (outputValue === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    const root = outputEl.querySelector(":scope > .jv-line");
    if (!root || !nodeOf(root) && e.key !== "Home") return;
    const line = cursorLine?.isConnected ? cursorLine : null;
    const node = line && nodeOf(line);
    let next = line;
    switch (e.key) {
      case "ArrowDown":
        next = line ? nextLine(line) : root;
        break;
      case "ArrowUp":
        next = line ? prevLine(line) : root;
        break;
      case "Home":
        next = root;
        break;
      case "End":
        next = lastShown(root);
        break;
      case "ArrowRight":
        if (!line) next = root;
        else if (node && !isOpen(node)) expandBlock(node);
        else if (node) next = childLines(node)[0];
        break;
      case "ArrowLeft":
        if (!line) next = root;
        else if (isOpen(node)) setCollapsed(node, true);
        else next = parentLine(line) ?? line;
        break;
      case "Enter":
      case " ": {
        // On a focused button the browser already clicks it.
        if (!line || e.target !== outputEl) return;
        if (line.classList.contains("jv-more")) {
          const block = line.closest(".jv-node");
          const index = Array.prototype.indexOf.call(line.parentElement.children, line);
          pendingBlocks.get(block)?.({ left: EAGER_LINES });
          next = childLines(block)[index];
        } else if (node) {
          if (isOpen(node)) setCollapsed(node, true);
          else expandBlock(node);
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    if (next) setCursor(next);
  });

  // "Comparar": differences between the output's value and another JSON,
  // read with the same settings. Clicking one shows it in the output.
  const DIFF_LIMIT = 1000;

  // Entry positions (as revealPath takes) of the longest prefix of `keys`
  // that exists in `value`.
  function stepsFor(value, keys) {
    const steps = [];
    for (const key of keys) {
      if (value === null || typeof value !== "object" || value instanceof RawNumber) break;
      const step = Array.isArray(value) ? (key < value.length ? key : -1) : Object.keys(value).indexOf(key);
      if (step < 0) break;
      steps.push(step);
      value = value[key];
    }
    return steps;
  }

  function shortValue(value) {
    if (value === undefined) return "—";
    const text = stringify(value);
    return text.length > 60 ? text.slice(0, 60) + "…" : text;
  }

  function runDiff() {
    diffList.replaceChildren();
    const text = diffInput.value;
    if (!text.trim()) {
      diffSummary.textContent = t("diff.empty");
      return;
    }
    const result = analyze(text, { spec: "json5", fix: fixEl.checked, indent: "  ", reformatted: true });
    let other;
    if (result.ok) {
      other = result.ok.value;
    } else if (result.fail.closed) {
      other = result.fail.closed.value;
    } else {
      const { source, info } = result.fail;
      diffSummary.textContent = info.pos == null
        ? t("diff.unreadable", { message: info.message })
        : t("diff.unreadableAt", { line: lineCol(source, info.pos).line, message: info.message });
      return;
    }

    const { diffs, truncated } = diffValues(outputValue, other, DIFF_LIMIT);
    const count = (kind) => diffs.filter((d) => d.kind === kind).length;
    diffSummary.textContent = diffs.length === 0
      ? t("diff.none")
      : t("diff.summary", {
        count: diffs.length,
        total: diffs.length + (truncated ? "+" : ""),
        added: count("added"),
        removed: count("removed"),
        changed: count("changed"),
      });

    diffs.forEach((diff) => {
      const li = document.createElement("li");
      li.className = `diff-item diff-${diff.kind}`;
      const button = document.createElement("button");
      button.type = "button";
      button.title = t("diff.showInOutput");
      button.append(span("diff-kind", t(`diff.kind.${diff.kind}`)), span("diff-path", formatPath(diff.keys)));
      const values = document.createElement("span");
      values.className = "diff-values";
      values.textContent = diff.kind === "changed"
        ? `${shortValue(diff.before)} → ${shortValue(diff.after)}`
        : shortValue(diff.kind === "added" ? diff.after : diff.before);
      button.appendChild(values);
      button.addEventListener("click", () => {
        diffDialog.close();
        const line = revealPath(stepsFor(outputValue, diff.keys));
        if (line) setCursor(line);
        else showPath(diff.keys);
        outputEl.focus({ preventScroll: true });
      });
      li.appendChild(button);
      diffList.appendChild(li);
    });
  }

  diffBtn.addEventListener("click", () => {
    if (outputValue === undefined) {
      showNote(t("diff.needOutput"));
      return;
    }
    diffDialog.showModal();
    diffInput.focus();
  });
  diffRunBtn.addEventListener("click", runDiff);
  diffInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      runDiff();
    }
  });
  diffCloseBtn.addEventListener("click", () => diffDialog.close());

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
      sort: sortEl.checked,
    };
    if (raw.length < WORKER_MIN_CHARS || workerFailed) {
      present(raw, options, analyze(raw, options), reformatted);
      return;
    }

    setStatus(t("status.processing"), "busy");
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
    // "Ordenar chaves" applies to what's shown; repair marks are keyed by
    // path, so they still match after sorting.
    const shown = (value) => (options.sort ? sortKeys(value) : value);
    const FIX_NOTE = t("status.fixNote");

    // Output shown: status notes, then history.
    const finish = (notes, ok) => {
      setStatus(notes.length ? notes.join("\n") : t("status.valid"), ok && !notes.length ? "ok" : "error");
      addToHistory({
        timestamp: Date.now(),
        template: templateEl.value,
        spec: options.spec,
        fix: options.fix,
        sort: options.sort,
        preview: raw.trim().slice(0, 80).replace(/\s+/g, " "),
      }, raw);
    };

    if (result.fail) {
      const { source, info, offset, closed, reformat, repair } = result.fail;
      if (closed) {
        const summary = showFixedOutput({ value: shown(closed.value), marks: closed.marks, fixed: closed.fixed, closed }, source, offset);
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
    if (joined) notes.push(t("status.joined", { count: value.length }));
    if (repaired) {
      notes.push(showFixedOutput({ ...repaired, value: shown(value) }, repaired.source, repaired.offset));
    } else {
      showOutput(shown(value), indentFor(templateEl.value));
    }
    if (usedFix) notes.push(FIX_NOTE);
    notes.push(...warnings);
    finish(notes, !repaired);
  }

  renderHistory();

  formatBtn.addEventListener("click", () => format());
  [templateEl, specEl, fixEl, sortEl, outputFormatEl].forEach((el) =>
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
    showLargeInput = false;
    inputEl.value = "";
    fileName = null;
    clearOutput();
    setStatus("");
    inputEl.focus();
  });

  function loadFile(file) {
    file.text().then((text) => {
      fileName = file.name;
      showLargeInput = false;
      inputEl.value = text;
      format();
    }, () => setStatus(t("status.fileError", { name: file.name }), "error"));
  }

  openFileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) loadFile(file);
    fileInput.value = "";
  });

  // Dropping a file on the input opens it (dragged text keeps the
  // textarea's normal behavior).
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
    button.textContent = t("copy.done");
    setTimeout(() => (button.textContent = label), 1200);
    return true;
  }

  copyBtn.addEventListener("click", () => {
    if (outputText) copyText(outputText, copyBtn);
  });

  copyPathBtn.addEventListener("click", () => copyText(pathText.textContent, copyPathBtn));

  // Saves the output as <opened file's name>.<json|yaml|csv>, or
  // formatado.<ext>.
  downloadBtn.addEventListener("click", () => {
    if (!outputText) return;
    const url = URL.createObjectURL(new Blob([outputText], { type: outputType.mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = (fileName ? fileName.replace(/\.[^.]*$/, "") : "formatado") + "." + outputType.ext;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // "Compartilhar": copies a link with the input in its #fragment (see
  // share.js). Opening such a link loads and formats that input.
  const SHARE_MAX_CHARS = 100000;

  shareBtn.addEventListener("click", async () => {
    const text = inputEl.value;
    if (!text.trim()) {
      setStatus(t("share.empty"), "error");
      return;
    }
    let code;
    try {
      code = await encodeShare(text);
    } catch {
      setStatus(t("share.unsupported"), "error");
      return;
    }
    if (code.length > SHARE_MAX_CHARS) {
      setStatus(t("share.tooBig"), "error");
      return;
    }
    const link = location.origin + location.pathname + SHARE_PREFIX + code;
    try {
      await navigator.clipboard.writeText(link);
      setStatus(t("share.copied"), "ok");
    } catch {
      window.prompt(t("share.prompt"), link);
    }
  });

  async function loadSharedInput() {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    const code = location.hash.slice(SHARE_PREFIX.length);
    // The link has done its job; edits would make it stale.
    window.history.replaceState(null, "", location.pathname + location.search);
    try {
      showLargeInput = false;
      inputEl.value = await decodeShare(code);
      format();
    } catch {
      setStatus(t("share.broken"), "error");
    }
  }

  loadSharedInput();
  window.addEventListener("hashchange", loadSharedInput);

  // Switching language (and remembering it) redraws every text in place,
  // formatting again when there's input (messages and the output's labels
  // are built when formatting), and moves to that language's address.
  function switchLocale(code) {
    setLocale(code);
    storeSetting(LANGUAGE_KEY, getLocale());
    languageEl.value = getLocale();
    translatePage();
    showLocaleInUrl();
    applyTheme(document.body.dataset.theme);
    updateLargeInput();
    updateLanguageHint();
    renderHistory();
    if (inputEl.value.trim()) format();
    else updateSearchCount();
  }

  languageEl.addEventListener("change", () => switchLocale(languageEl.value));

  // Offers the browser's language, written in that language, when the page
  // is in another one and no language was picked yet.
  function updateLanguageHint() {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(LANGUAGE_HINT_KEY) === "1";
    } catch {
      // storage unavailable; ignore
    }
    const suggested = matchLocale(navigator.languages ?? [navigator.language]);
    langHint.hidden = dismissed || savedLocale() !== null || suggested === null || suggested === getLocale();
    if (langHint.hidden) return;
    langHintLink.textContent = tIn(suggested, "lang.hint");
    langHintLink.lang = LOCALES[suggested].tag;
    langHintLink.href = localeUrl(suggested).href;
    langHintLink.dataset.locale = suggested;
  }

  langHintLink.addEventListener("click", (e) => {
    e.preventDefault();
    switchLocale(langHintLink.dataset.locale);
  });

  langHintClose.addEventListener("click", () => {
    storeSetting(LANGUAGE_HINT_KEY, "1");
    updateLanguageHint();
  });

  updateLanguageHint();

  fixHelpBtn.addEventListener("click", () => (fixHelpPopover.hidden = false));
  fixHelpClose.addEventListener("click", () => (fixHelpPopover.hidden = true));

  inputEl.addEventListener("input", () => {
    if (!inputEl.value.trim()) {
      clearOutput();
      setStatus("");
    }
  });
})();
