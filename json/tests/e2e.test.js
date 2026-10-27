// Browser tests of the page itself (output tree, worker, search, keyboard,
// big input, files, share links, diff, history), in headless Chrome.
// Run with `npm run test:e2e` from the json/ folder after `npm install`;
// needs Node 18+ and Chrome (set CHROME_PATH if it isn't found).
import { strict as assert } from "assert";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import http from "http";
import { dirname, extname, join, sep } from "path";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";
import { run, test } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));
if (!CHROME) {
  console.error("Chrome não encontrado; defina CHROME_PATH.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

// Serves json/ at the root, as the site does.
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });

// A page in its own browser context (fresh storage), failing the test on
// any page error. Downloads are captured in window.__downloads.
async function open(url = ORIGIN + "/") {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument(() => {
    window.__downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return click.call(this);
      window.__downloads.push(fetch(this.href).then((r) => r.text()).then((text) => ({ name: this.download, text })));
    };
  });
  await page.goto(url, { waitUntil: "networkidle0" });
  page.done = async () => {
    await context.close();
    assert.deepEqual(errors, [], "erros na página");
  };
  return page;
}

const setInput = (page, text) => page.evaluate((t) => { document.getElementById("input").value = t; }, text);
const status = (page) => page.$eval("#statusBox", (el) => el.textContent);
const pathShown = (page) => page.$eval("#pathText", (el) => el.textContent);
const waitFormatted = (page) => page.waitForFunction(() => {
  const text = document.getElementById("statusBox").textContent;
  return text && !text.startsWith("Processando");
}, { timeout: 60000 });
// The button moves as the status and history below it change height, so
// it's clicked through the DOM rather than at screen coordinates.
const clickFormat = (page) => page.$eval("#formatBtn", (btn) => btn.click());
const lastDownload = (page) => page.evaluate(async () => window.__downloads[window.__downloads.length - 1]);

async function format(page, text) {
  await setInput(page, text);
  await clickFormat(page);
  await waitFormatted(page);
}

async function search(page, query) {
  await page.$eval("#searchInput", (el) => { el.value = ""; });
  await page.type("#searchInput", query);
  await page.waitForFunction(() => /\d\/\d/.test(document.getElementById("searchCount").textContent));
}

const BIG = JSON.stringify({
  rows: Array.from({ length: 30000 }, (_, i) => ({ id: i, name: "item" + i, tags: ["x", "y"], nested: { deep: { v: i } } })),
  huge: "__RAW__",
}, null, 2).replace('"__RAW__"', "12345678901234567890.50");

test("Ctrl+Enter formata e o clique mostra o caminho", async () => {
  const page = await open();
  await setInput(page, '{"a": [1, {"b": "texto"}], "c d": 2}');
  await page.focus("#input");
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  assert.equal(await status(page), "JSON válido.");
  await page.evaluate(() => [...document.querySelectorAll("#output .jv-val")].find((el) => el.textContent === '"texto"').click());
  assert.equal(await pathShown(page), "$.a[1].b");
  await page.evaluate(() => [...document.querySelectorAll("#output .jv-key")].find((el) => el.textContent === '"c d"').click());
  assert.equal(await pathShown(page), '$["c d"]');
  await page.done();
});

test("setas navegam pela árvore", async () => {
  const page = await open();
  await format(page, '{"a": {"b": 1, "c": [true]}, "d": null}');
  await page.focus("#output");
  const press = async (...keys) => {
    for (const key of keys) await page.keyboard.press(key);
    return pathShown(page);
  };
  assert.equal(await press("ArrowDown"), "$");
  assert.equal(await press("ArrowDown", "ArrowDown"), "$.a.b");
  assert.equal(await press("ArrowDown", "ArrowRight"), "$.a.c[0]");
  assert.equal(await press("ArrowLeft"), "$.a.c");
  assert.equal(await press("ArrowLeft"), "$.a.c");
  assert.equal(await page.$eval(".jv-cursor > .jv-node", (n) => n.classList.contains("jv-collapsed")), true);
  assert.equal(await press("End"), "$.d");
  assert.equal(await press("ArrowUp"), "$.a.c");
  assert.equal(await press("Home", "Enter"), "$");
  assert.equal(await page.$eval("#output > .jv-line > .jv-node", (n) => n.classList.contains("jv-collapsed")), true);
  await page.done();
});

test("entrada grande: resumo no lugar do texto, worker e árvore preguiçosa", async () => {
  const page = await open();
  await setInput(page, BIG);
  assert.equal(await page.$eval("#largeInput", (el) => el.hidden), false);
  assert.equal(await page.$eval("#input", (el) => el.clientHeight), 0);
  await clickFormat(page);
  assert.match(await status(page), /^Processando/);
  await waitFormatted(page);
  assert.equal(await status(page), "JSON válido.");
  assert.ok(await page.$$eval("#output .jv-line", (lines) => lines.length) < 20000);
  assert.ok(await page.evaluate(() => document.getElementById("output").textContent.includes("12345678901234567890.50")));

  const rootLines = () => page.$$eval("#output > .jv-line > .jv-node > .jv-children > .jv-line > .jv-node > .jv-children > .jv-line", (l) => l.length);
  const before = await rootLines();
  await page.click("#output .jv-more-btn");
  assert.equal(await rootLines(), before + 2000);

  await search(page, "item29999");
  assert.equal(await page.$eval(".jv-match", (el) => el.textContent), '"item29999"');
  assert.equal(await pathShown(page), "$.rows[29999].name");

  await page.click("#expandAllBtn");
  assert.match(await page.$eval("#outputNote", (el) => el.textContent), /grande demais para expandir/);

  await page.click("#largeShowBtn");
  assert.equal(await page.$eval("#input", (el) => el.value.length), BIG.length);
  assert.equal(await page.$eval("#largeInput", (el) => el.hidden), true);
  await page.done();
});

test("colar um JSON grande vai direto para o resumo e formata", async () => {
  const page = await open();
  await page.focus("#input");
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.getElementById("input").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, BIG);
  await waitFormatted(page);
  assert.equal(await page.$eval("#largeInput", (el) => el.hidden), false);
  assert.equal(await status(page), "JSON válido.");
  await page.done();
});

test("arquivo arrastado, YAML/CSV e Baixar", async () => {
  const page = await open();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['[{"id": 1, "nome": "Ana"}, {"id": 2, "nome": "Bia, B."}]'], "pessoas.txt", { type: "text/plain" }));
    const wrap = document.getElementById("inputWrap");
    wrap.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
    wrap.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.getElementById("statusBox").textContent === "JSON válido.");

  await page.click("#downloadBtn");
  const json = await lastDownload(page);
  assert.equal(json.name, "pessoas.json");
  assert.equal(json.text, '[\n   {\n      "id": 1,\n      "nome": "Ana"\n   },\n   {\n      "id": 2,\n      "nome": "Bia, B."\n   }\n]');

  await page.select("#outputFormat", "csv");
  await waitFormatted(page);
  await page.click("#downloadBtn");
  assert.deepEqual(await lastDownload(page), { name: "pessoas.csv", text: 'id,nome\r\n1,Ana\r\n2,"Bia, B."\r\n' });

  await page.select("#outputFormat", "yaml");
  await waitFormatted(page);
  assert.equal(await page.$eval("#output", (el) => el.textContent), '- id: 1\n  nome: Ana\n- id: 2\n  nome: "Bia, B."\n');

  await format(page, '{"a": 1}');
  await page.select("#outputFormat", "csv");
  await waitFormatted(page);
  assert.match(await page.$eval("#outputNote", (el) => el.textContent), /CSV precisa de um array/);
  await page.done();
});

test("Ordenar chaves", async () => {
  const page = await open();
  await page.click("#sortKeys");
  await format(page, '{"b": 1, "a": {"d": 1, "c": 2}}');
  await page.click("#copyBtn");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '{\n   "a": {\n      "c": 2,\n      "d": 1\n   },\n   "b": 1\n}');
  await page.done();
});

test("link de compartilhamento leva o JSON", async () => {
  const page = await open();
  await setInput(page, '{"compartilhado": "sim ✓"}');
  await page.click("#shareBtn");
  await page.waitForFunction(() => document.getElementById("statusBox").textContent.startsWith("Link copiado"));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(link.startsWith(ORIGIN + "/#json="));
  await page.done();

  const other = await open(link);
  await other.waitForFunction(() => document.getElementById("statusBox").textContent === "JSON válido.");
  assert.equal(await other.$eval("#input", (el) => el.value), '{"compartilhado": "sim ✓"}');
  assert.equal(await other.evaluate(() => location.hash), "");
  await other.done();
});

test("Comparar lista as diferenças e mostra cada uma na saída", async () => {
  const page = await open();
  await format(page, '{"a": 1, "b": [1, 2], "c": {"d": "x"}}');
  await page.click("#diffBtn");
  await page.type("#diffInput", '{"a": 2, "b": [1], "c": {"d": "x", "e": true}}');
  await page.click("#diffRunBtn");
  assert.match(await page.$eval("#diffSummary", (el) => el.textContent), /^3 diferenças: 1 adicionada\(s\), 1 removida\(s\), 1 alterada\(s\)/);
  assert.deepEqual(await page.$$eval("#diffList .diff-path", (els) => els.map((el) => el.textContent)), ["$.a", "$.b[1]", "$.c.e"]);
  await page.evaluate(() => document.querySelectorAll("#diffList button")[1].click());
  assert.equal(await page.$eval("#diffDialog", (el) => el.open), false);
  assert.equal(await pathShown(page), "$.b[1]");

  await page.click("#diffBtn");
  await page.$eval("#diffInput", (el) => { el.value = "{a: }}"; });
  await page.click("#diffRunBtn");
  assert.match(await page.$eval("#diffSummary", (el) => el.textContent), /^Não consegui ler/);
  await page.done();
});

test("histórico fica no IndexedDB e migra o do localStorage", async () => {
  const page = await open();
  await page.evaluate(() => {
    localStorage.setItem("jsonFormatter.history", JSON.stringify([
      { timestamp: 1000, input: '{"antigo": true}', template: "2", spec: "rfc8259", fix: true, preview: '{"antigo": true}' },
    ]));
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll(".history-item").length === 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("jsonFormatter.history")), null);

  await format(page, '{"novo": 1}');
  await format(page, BIG);
  await format(page, '{"novo": 1}');
  await page.waitForFunction(() => document.querySelectorAll(".history-item").length === 3);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll(".history-item").length === 3);
  assert.deepEqual(await page.$$eval(".history-preview", (els) => els.map((el) => el.textContent.slice(0, 12))),
    ['{"novo": 1}', '{ "rows": [ ', '{"antigo": t']);

  await page.evaluate(() => document.querySelectorAll(".history-item")[1].click());
  await page.waitForFunction((n) => document.getElementById("input").value.length === n, {}, BIG.length);
  await page.evaluate(() => document.querySelectorAll(".history-item")[2].click());
  await page.waitForFunction(() => document.getElementById("input").value === '{"antigo": true}');
  assert.equal(await page.$eval("#template", (el) => el.value), "2");
  await page.done();
});

test("erros e correções continuam funcionando", async () => {
  const page = await open();
  await page.click("#fixJson");
  await format(page, '{"a": 1,}');
  assert.match(await status(page), /^Erro na linha 1, coluna 8/);
  await page.click("#fixJson");
  await format(page, '{"a": [1, 2}');
  assert.match(await status(page), /^Faltava fechar o '\['/);
  await page.done();
});

await run();
await browser.close();
server.close();
