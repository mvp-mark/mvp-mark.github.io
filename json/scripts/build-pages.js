// Builds one static page per language, for search engines and link
// previews (which don't run JavaScript): index.html, written in Portuguese
// and edited by hand, is the source; for every locale in i18n.js this
// writes <code>/index.html with that locale's texts in the body (the
// data-i18n* attributes), <head> (title, description, Open Graph, Twitter,
// JSON-LD) and its own canonical URL, plus the hreflang links between all of
// them (also refreshed in index.html itself) and sitemap.xml.
// `npm run build-pages` writes the files; with --check it only reports,
// exiting with 1 when any is out of date (used by CI and the git hook).
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_LOCALE, LOCALES, tIn } from "../i18n.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "index.html"), "utf8");

// The site's address, from the source page's canonical link.
const SITE = /<link rel="canonical" href="([^"]+)">/.exec(source)[1];
const OG_LOCALE = { pt: "pt_BR", en: "en_US", es: "es_ES", fr: "fr_FR", de: "de_DE", it: "it_IT", ja: "ja_JP", zh: "zh_CN" };
const CODES = Object.keys(LOCALES);

const pathFor = (code) => (code === DEFAULT_LOCALE ? "" : `${code}/`);
const urlFor = (code) => SITE + pathFor(code);

const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");

// Replaces the one match of `pattern` in html (a mistake in the source
// should fail the build, not produce a page without the change).
function replaceOnce(html, pattern, replacement) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.replace("g", "") + "g"));
  if (!matches || matches.length !== 1) throw new Error(`esperava 1 ocorrência de ${pattern}, achei ${matches?.length ?? 0}`);
  return html.replace(pattern, replacement);
}

const setMeta = (html, attr, name, value) =>
  replaceOnce(html, new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), (m, a, b) => a + escapeAttr(value) + b);

// The data-i18n (text), data-i18n-html (markup) and data-i18n-attr
// ("attr=key;...") texts, as the page itself does in translatePage().
function translateBody(html, code) {
  html = html.replace(/<[a-z][^>]*\sdata-i18n-attr="([^"]*)"[^>]*>/g, (tag, spec) => {
    for (const pair of spec.split(";")) {
      const [attr, key] = pair.split("=");
      tag = replaceOnce(tag, new RegExp(`(\\s${attr}=")[^"]*(")`), (m, a, b) => a + escapeAttr(tIn(code, key)) + b);
    }
    return tag;
  });
  return html.replace(
    /(<([a-z][a-z0-9]*)\b[^>]*\sdata-i18n(-html)?="([^"]*)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (m, open, tag, isHtml, key, inner, close) => open + (isHtml ? tIn(code, key) : escapeText(tIn(code, key))) + close
  );
}

// hreflang links (x-default: the Portuguese page at the root) and the
// other languages for Open Graph.
function alternates(code) {
  const lines = CODES.map((c) => `<link rel="alternate" hreflang="${LOCALES[c].tag}" href="${urlFor(c)}">`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="${urlFor(DEFAULT_LOCALE)}">`);
  CODES.filter((c) => c !== code).forEach((c) => lines.push(`<meta property="og:locale:alternate" content="${OG_LOCALE[c]}">`));
  return `<!-- i18n:alternates (scripts/build-pages.js) -->\n${lines.join("\n")}\n<!-- /i18n:alternates -->`;
}

function buildPage(code) {
  const t = (key) => tIn(code, key);
  const sub = code !== DEFAULT_LOCALE;
  let html = source;

  html = replaceOnce(html, /<html [^>]*>/, `<html lang="${LOCALES[code].tag}" data-locale="${code}" data-root="${sub ? "../" : "./"}">`);
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeText(t("page.title"))}</title>`);
  html = setMeta(html, "name", "description", t("page.description"));
  html = replaceOnce(html, /(<link rel="canonical" href=")[^"]*(">)/, (m, a, b) => a + urlFor(code) + b);

  const block = /<!-- i18n:alternates[\s\S]*?<!-- \/i18n:alternates -->/;
  html = block.test(html)
    ? html.replace(block, alternates(code))
    : replaceOnce(html, /(<link rel="canonical" [^>]*>)/, (m) => `${m}\n${alternates(code)}`);

  html = setMeta(html, "property", "og:locale", OG_LOCALE[code]);
  html = setMeta(html, "property", "og:title", t("page.title"));
  html = setMeta(html, "property", "og:description", t("page.shareDescription"));
  html = setMeta(html, "property", "og:url", urlFor(code));
  html = setMeta(html, "property", "og:image:alt", t("page.imageAlt"));
  html = setMeta(html, "name", "twitter:title", t("page.title"));
  html = setMeta(html, "name", "twitter:description", t("page.shareDescription"));

  html = replaceOnce(html, /(<script type="application\/ld\+json">\n)([\s\S]*?)(\n<\/script>)/, (m, open, json, close) => {
    const data = JSON.parse(json);
    data.url = urlFor(code);
    data.description = t("page.shareDescription");
    data.inLanguage = LOCALES[code].tag;
    data.featureList = ["indent", "specs", "fix", "colors", "search", "diff", "convert", "share", "offline"]
      .map((feature) => t(`seo.feature.${feature}`));
    return open + JSON.stringify(data, null, 2) + close;
  });

  // The language list, with this page's language selected.
  html = replaceOnce(html, /(<select id="language">)[\s\S]*?(<\/select>)/, (m, open, close) => open +
    CODES.map((c) => `\n          <option value="${c}"${c === code ? " selected" : ""}>${LOCALES[c].name}</option>`).join("") +
    "\n        " + close);

  html = translateBody(html, code);

  if (sub) {
    // Files are one level up from <code>/index.html.
    html = html.replace(/(\s(?:href|src)=")(?!https?:|\/|#|data:)(?:\.\/)?/g, "$1../");
    html = replaceOnce(html, /new URL\("\.\/sw\.js"/, 'new URL("../sw.js"');
  }
  return html;
}

function buildSitemap() {
  const links = CODES.map((c) => `    <xhtml:link rel="alternate" hreflang="${LOCALES[c].tag}" href="${urlFor(c)}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor(DEFAULT_LOCALE)}"/>`)
    .join("\n");
  const urls = CODES.map((c) => `  <url>\n    <loc>${urlFor(c)}</loc>\n${links}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

const outputs = new Map(CODES.map((code) => [join(root, pathFor(code), "index.html"), buildPage(code)]));
outputs.set(join(root, "sitemap.xml"), buildSitemap());

const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const stale = [...outputs].filter(([path, text]) => read(path) !== text).map(([path]) => path.slice(root.length + 1));

if (process.argv.includes("--check")) {
  if (stale.length) {
    console.error(`Páginas por idioma desatualizadas: ${stale.join(", ")}. Rode "npm run build-pages".`);
    process.exitCode = 1;
  } else {
    console.log(`Páginas por idioma em dia (${CODES.length} idiomas).`);
  }
} else {
  for (const [path, text] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  console.log(stale.length ? `Atualizado: ${stale.join(", ")}.` : "Nada a atualizar.");
}
