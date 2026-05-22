// generate.js
// Pipeline complet : CSV -> deck Crawl Overview
//
// Usage:
//   node generate.js \
//     --current crawl_S.csv \
//     [--previous crawl_S-1.csv] \
//     --config config.json \
//     --output deck.pptx \
//     [--state state.json]
//
// Le catalogue ci-dessous définit pour chaque ligne du deck :
//   - où aller chercher la valeur dans le CSV
//   - mode (lowerBetter = problème, higherBetter = positif)
//   - seuils pour décider de la pastille verte / orange / rouge

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const { parseCrawlOverview, getMetric } = require("./parseCrawl");

// =============================================================
// CATALOGUE — source de vérité du deck
// =============================================================
//
// Chaque "row" pointe vers une métrique CSV :
//   section:  (ex. "Page Titles") ou null pour les stats globales
//   metric:  nom exact de la ligne SF (ex. "Duplicate")
//   label:   libellé affiché dans le deck
//   mode:    "lowerBetter" (issue, on veut baisser) | "higherBetter" (positif, on veut monter)
//   thresholds: optionnel. { warnPct: 5, badPct: 20 } ou { warnAbs: 1, badAbs: 10 }
//               Si non fourni, fallback : warnPct=5, badPct=20 pour lowerBetter ;
//               higherBetter reste toujours "ok" sauf chute >5%.

const DEFAULT_THRESHOLDS = {
  lowerBetter: { warnPct: 5, badPct: 20 },
  higherBetter: { warnPct: 0, badPct: 0 },
};

const CATALOG = {
  execSummary: [
    { label: "URLS CRAWLÉES",          section: null, metric: "Total URLs Crawled",              mode: "higherBetter", desc: (_, parsed) => `sur ${formatNum(getMetric(parsed, null, "Total URLs Encountered")?.count)} rencontrées` },
    { label: "PAGES INDEXABLES",       section: null, metric: "Total Internal Indexable URLs",   mode: "higherBetter", desc: () => "indexables internes" },
    { label: "RÉPONSES 4XX",           section: "Response Codes", metric: "Client Error (4xx)",  mode: "lowerBetter",  thresholds: { warnAbs: 5, badAbs: 50 }, desc: (_, parsed) => {
        const internal = getMetric(parsed, "Response Codes", "Internal Client Error (4xx)");
        const external = getMetric(parsed, "Response Codes", "External Client Error (4xx)");
        return `${internal?.count ?? 0} internes, ${external?.count ?? 0} externes`;
      } },
    { label: "ERREURS SCHEMA",         section: "Structured Data", metric: "Validation Errors",  mode: "lowerBetter",  thresholds: { warnPct: 10, badPct: 30 }, desc: v => `${formatPct(v?.percent)} des pages HTML` },
    { label: "META DESC. DUPLIQUÉES",  section: "Meta Description", metric: "Duplicate",         mode: "lowerBetter",  thresholds: { warnPct: 10, badPct: 30 }, desc: v => `${formatPct(v?.percent)} des pages` },
    { label: "PAGES LOW CONTENT",      section: "Content", metric: "Low Content Pages",          mode: "lowerBetter",  thresholds: { warnPct: 10, badPct: 25 }, desc: v => `${formatPct(v?.percent)} des pages HTML` },
    { label: "HREFLANG SANS X-DEFAULT",section: "Hreflang", metric: "Missing X-Default",         mode: "lowerBetter",  thresholds: { warnPct: 15, badPct: 40 }, desc: v => `${formatPct(v?.percent)} des pages` },
    { label: "URLS ORPHELINES",        section: "Sitemaps", metric: "Orphan URLs",               mode: "lowerBetter",  thresholds: { warnPct: 5, badPct: 15 }, desc: () => "présentes sitemap, pas crawlées" },
  ],

  slide3_volumetric: {
    donut: {
      section: "Response Codes",
      labels: ["2xx Success", "3xx Redirect", "4xx Client error", "No response", "Blocked"],
      metrics: ["Success (2xx)", "Redirection (3xx)", "Client Error (4xx)", "No Response", "Blocked by Robots.txt"],
    },
    rows: [
      { label: "URLs rencontrées",         section: null, metric: "Total URLs Encountered", mode: "higherBetter" },
      { label: "URLs crawlées",            section: null, metric: "Total URLs Crawled",     mode: "higherBetter" },
      { label: "URLs internes",            section: null, metric: "Total Internal URLs",   mode: "higherBetter" },
      { label: "URLs externes",            section: null, metric: "Total External URLs",   mode: "higherBetter" },
      { label: "Success 2xx",              section: "Response Codes", metric: "Success (2xx)",     mode: "higherBetter" },
      { label: "Redirections 3xx",         section: "Response Codes", metric: "Redirection (3xx)", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Erreurs 4xx (internes)",   section: "Response Codes", metric: "Internal Client Error (4xx)", mode: "lowerBetter", thresholds: { warnAbs: 5, badAbs: 20 } },
      { label: "Erreurs 4xx (externes)",   section: "Response Codes", metric: "External Client Error (4xx)", mode: "lowerBetter", thresholds: { warnAbs: 20, badAbs: 100 } },
      { label: "No response",              section: "Response Codes", metric: "No Response",       mode: "lowerBetter", thresholds: { warnAbs: 5, badAbs: 20 } },
    ],
  },

  slide4_indexability: {
    callouts: [
      { lbl: "PAGES INDEXABLES",     section: null, metric: "Total Internal Indexable URLs",     color: "ok" },
      { lbl: "PAGES NON INDEXABLES", section: null, metric: "Total Internal Non-Indexable URLs", color: "warn" },
      { lbl: "NOINDEX EXPLICITES",   section: "Directives", metric: "Noindex",                   color: "warn" },
    ],
    rows: [
      { label: "URLs en majuscules",            section: "URL",        metric: "Uppercase",              mode: "lowerBetter", thresholds: { warnPct: 20, badPct: 60 } },
      { label: "URLs avec underscores",         section: "URL",        metric: "Underscores",            mode: "lowerBetter" },
      { label: "URLs avec espaces",             section: "URL",        metric: "Contains Space",         mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 5 } },
      { label: "URLs avec paramètres",          section: "URL",        metric: "Parameters",             mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "URLs au-delà de 115 caractères",section: "URL",        metric: "Over 115 Characters",    mode: "lowerBetter" },
      { label: "Pages noindex",                 section: "Directives", metric: "Noindex",                mode: "lowerBetter", thresholds: { warnPct: 3, badPct: 10 } },
      { label: "Bloquées par robots.txt (externes)", section: null,    metric: "Total External blocked by robots.txt", mode: "lowerBetter", thresholds: { warnAbs: 20, badAbs: 100 } },
    ],
  },

  slide5_onPage: {
    titles: [
      { label: "Total titles",       section: "Page Titles", metric: "All",                 mode: "higherBetter" },
      { label: "Manquants",          section: "Page Titles", metric: "Missing",             mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Dupliqués",          section: "Page Titles", metric: "Duplicate",           mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Sous 30 caractères", section: "Page Titles", metric: "Below 30 Characters", mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 25 } },
      { label: "Au-delà de 60 car.", section: "Page Titles", metric: "Over 60 Characters",  mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Identiques au H1",   section: "Page Titles", metric: "Same as H1",          mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 20 } },
    ],
    meta: [
      { label: "Manquantes",         section: "Meta Description", metric: "Missing",          mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Dupliquées",         section: "Meta Description", metric: "Duplicate",        mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "Au-delà 155 car.",   section: "Meta Description", metric: "Over 155 Characters", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Sous 70 caractères", section: "Meta Description", metric: "Below 70 Characters", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
    ],
    h1: [
      { label: "Total H1",           section: "H1", metric: "All",      mode: "higherBetter" },
      { label: "Manquants",          section: "H1", metric: "Missing",  mode: "lowerBetter", thresholds: { warnPct: 3, badPct: 10 } },
      { label: "Dupliqués",          section: "H1", metric: "Duplicate", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Au-delà 70 car.",    section: "H1", metric: "Over 70 Characters", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
    ],
    h2: [
      { label: "Manquants",          section: "H2", metric: "Missing",        mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 25 } },
      { label: "Dupliqués",          section: "H2", metric: "Duplicate",      mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 20 } },
      { label: "Multiples",          section: "H2", metric: "Multiple",       mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Non séquentiels",    section: "H2", metric: "Non-Sequential", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 20 } },
    ],
  },

  slide6_content: {
    content: [
      { label: "Low content pages",       section: "Content", metric: "Low Content Pages",        mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 25 } },
      { label: "Lecture difficile",       section: "Content", metric: "Readability Difficult",    mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "Lecture très difficile",  section: "Content", metric: "Readability Very Difficult", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Duplications exactes",    section: "Content", metric: "Exact Duplicates",         mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Near duplicates",         section: "Content", metric: "Near Duplicates",          mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Lorem ipsum",             section: "Content", metric: "Lorem Ipsum Placeholder",  mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
    ],
    images: [
      { label: "Total images",            section: "Images", metric: "All",                       mode: "higherBetter" },
      { label: "Au-delà de 100 KB",       section: "Images", metric: "Over 100 KB",               mode: "lowerBetter", thresholds: { warnPct: 15, badPct: 30 } },
      { label: "Sans width/height attr.", section: "Images", metric: "Missing Size Attributes",   mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Alt text manquant",       section: "Images", metric: "Missing Alt Text",          mode: "lowerBetter", thresholds: { warnPct: 1, badPct: 5 } },
      { label: "Attribut alt manquant",   section: "Images", metric: "Missing Alt Attribute",     mode: "lowerBetter", thresholds: { warnPct: 1, badPct: 5 } },
      { label: "Alt au-delà 100 car.",    section: "Images", metric: "Alt Text Over 100 Characters", mode: "lowerBetter" },
    ],
  },

  slide7_international: {
    canonicals: [
      { label: "Présence canonical",       section: "Canonicals", metric: "Contains Canonical",   mode: "higherBetter" },
      { label: "Self-referencing",         section: "Canonicals", metric: "Self Referencing",     mode: "higherBetter" },
      { label: "Canonicalised",            section: "Canonicals", metric: "Canonicalised",        mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Non-indexable canonical",  section: "Canonicals", metric: "Non-Indexable Canonical", mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Manquants",                section: "Canonicals", metric: "Missing",              mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Conflits multiples",       section: "Canonicals", metric: "Multiple Conflicting", mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
    ],
    hreflang: [
      { label: "Pages avec hreflang",      section: "Hreflang", metric: "Contains hreflang",      mode: "higherBetter" },
      { label: "x-default manquant",       section: "Hreflang", metric: "Missing X-Default",      mode: "lowerBetter", thresholds: { warnPct: 15, badPct: 40 } },
      { label: "Return links manquants",   section: "Hreflang", metric: "Missing Return Links",   mode: "lowerBetter", thresholds: { warnPct: 3, badPct: 10 } },
      { label: "Self reference manquant",  section: "Hreflang", metric: "Missing Self Reference", mode: "lowerBetter", thresholds: { warnPct: 3, badPct: 10 } },
      { label: "URLs hreflang non-200",    section: "Hreflang", metric: "Non-200 hreflang URLs",  mode: "lowerBetter", thresholds: { warnPct: 2, badPct: 10 } },
      { label: "Hreflang totalement absent",section:"Hreflang", metric: "Missing",                mode: "lowerBetter", thresholds: { warnPct: 1, badPct: 5 } },
    ],
  },

  slide8_schema: {
    bar: {
      labels: ["Validation\nErrors", "Parse\nErrors", "Rich Result\nWarnings", "Rich Result\nErrors", "Rich Result\nDétecté"],
      metrics: ["Validation Errors", "Parse Errors", "Rich Result Validation Warnings", "Rich Result Validation Errors", "Rich Result Feature Detected"],
      section: "Structured Data",
    },
    rows: [
      { label: "Pages avec structured data",  section: "Structured Data", metric: "Contains Structured Data", mode: "higherBetter" },
      { label: "Format JSON-LD",              section: "Structured Data", metric: "JSON-LD URLs",             mode: "higherBetter" },
      { label: "Validation errors",           section: "Structured Data", metric: "Validation Errors",        mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "Parse errors",                section: "Structured Data", metric: "Parse Errors",             mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "Rich result errors",          section: "Structured Data", metric: "Rich Result Validation Errors", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 20 } },
      { label: "Rich result warnings",        section: "Structured Data", metric: "Rich Result Validation Warnings", mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 40 } },
      { label: "Rich result feature détecté", section: "Structured Data", metric: "Rich Result Feature Detected",   mode: "higherBetter" },
    ],
  },

  slide9_architecture: {
    sitemap: [
      { label: "URLs dans sitemap",         section: "Sitemaps", metric: "URLs in Sitemap",          mode: "higherBetter" },
      { label: "URLs hors sitemap",         section: "Sitemaps", metric: "URLs not in Sitemap",      mode: "lowerBetter", thresholds: { warnAbs: 5, badAbs: 50 } },
      { label: "URLs orphelines",           section: "Sitemaps", metric: "Orphan URLs",              mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Non-indexables en sitemap", section: "Sitemaps", metric: "Non-Indexable URLs in Sitemap", mode: "lowerBetter", thresholds: { warnPct: 2, badPct: 10 } },
      { label: "Sitemap > 50k URLs",        section: "Sitemaps", metric: "XML Sitemap with over 50k URLs", mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
    ],
    links: [
      { label: "Outlinks sans anchor text", section: "Links", metric: "Internal Outlinks With No Anchor Text", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Anchor non descriptif",     section: "Links", metric: "Non-Descriptive Anchor Text In Internal Outlinks", mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "Pages profondeur élevée",   section: "Links", metric: "Pages With High Crawl Depth", mode: "lowerBetter", thresholds: { warnPct: 20, badPct: 50 } },
    ],
    depthSection: "Depth (Clicks from Start URL)",
    depthLabels: ["0", "1", "2", "3", "4", "5"],
  },

  slide10_perfSecurity: {
    pagespeed: [
      { label: "Render blocking requests",  section: "PageSpeed", metric: "Render Blocking Requests",  mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Legacy JavaScript",         section: "PageSpeed", metric: "Legacy JavaScript",         mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Layout shift culprits",     section: "PageSpeed", metric: "Layout Shift Culprits",     mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Reduce JS execution time",  section: "PageSpeed", metric: "Reduce JavaScript Execution Time", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Font display",              section: "PageSpeed", metric: "Font Display",              mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Minimize main-thread",      section: "PageSpeed", metric: "Minimize Main-Thread Work", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Reduce unused CSS",         section: "PageSpeed", metric: "Reduce Unused CSS",         mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Optimize DOM size",         section: "PageSpeed", metric: "Optimize DOM Size",         mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Reduce unused JS",          section: "PageSpeed", metric: "Reduce Unused JavaScript",  mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
    ],
    security: [
      { label: "X-Content-Type-Options",    section: "Security", metric: "Missing X-Content-Type-Options Header", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "X-Frame-Options",           section: "Security", metric: "Missing X-Frame-Options Header",        mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Referrer-Policy",           section: "Security", metric: "Missing Secure Referrer-Policy Header", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Content-Security-Policy",   section: "Security", metric: "Missing Content-Security-Policy Header", mode: "lowerBetter", thresholds: { warnPct: 30, badPct: 70 } },
      { label: "Unsafe cross-origin links", section: "Security", metric: "Unsafe Cross-Origin Links",             mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
      { label: "HSTS Header",               section: "Security", metric: "Missing HSTS Header",                   mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 10 } },
      { label: "Mixed content",             section: "Security", metric: "Mixed Content",                         mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
      { label: "URLs HTTP",                 section: "Security", metric: "HTTP URLs",                             mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
    ],
  },

  slide11_gsc: {
    cards: [
      { lbl: "URLS AVEC CLICS",    section: "Search Console", metric: "Clicks Above 0",              color: "ok" },
      { lbl: "URLS AVEC ISSUES",   section: "Search Console", metric: "URL is on Google But Has Issues", color: "bad" },
      { lbl: "URLS NON INDEXÉES",  section: "Search Console", metric: "Indexable URL Not Indexed",   color: "warn" },
    ],
    rows: [
      { label: "URLs avec data Search Console",       section: "Search Console", metric: "All",                          mode: "higherBetter" },
      { label: "Indexable URL non indexée",           section: "Search Console", metric: "Indexable URL Not Indexed",    mode: "lowerBetter", thresholds: { warnPct: 3, badPct: 10 } },
      { label: "URL is on Google but has issues",     section: "Search Console", metric: "URL is on Google But Has Issues", mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "Rich Result Invalid",                 section: "Search Console", metric: "Rich Result Invalid",           mode: "lowerBetter", thresholds: { warnPct: 10, badPct: 30 } },
      { label: "User-Declared Canonical Not Selected",section: "Search Console", metric: "User-Declared Canonical Not Selected", mode: "lowerBetter", thresholds: { warnPct: 1, badPct: 5 } },
      { label: "Pas mobile-friendly",                 section: "Search Console", metric: "Page is Not Mobile Friendly",   mode: "lowerBetter", thresholds: { warnAbs: 1, badAbs: 1 } },
      { label: "URLs orphelines (data GSC)",          section: "Search Console", metric: "Orphan URLs",                   mode: "lowerBetter", thresholds: { warnPct: 5, badPct: 15 } },
    ],
  },
};

// =============================================================
// PALETTE & HELPERS
// =============================================================
const C = {
  ink: "0F172A", ink2: "1E293B", text: "334155", muted: "64748B",
  border: "C9D9F8", surface: "EEF3FD", white: "FFFFFF",
  accent: "3264B4", accent2: "1A48A0",
  yellow: "FFD908", salmon: "FF8A8E",
  ok: "10B981", warn: "F59E0B", bad: "EF4444",
  okBg: "E6EEFD", warnBg: "FDE7C4", badBg: "FFE5E5",
};
const FONT_H = "Rockwell";
const FONT_B = "Gantari";

function formatPct(p) {
  if (p === null || p === undefined) return "n/a";
  return p.toFixed(p < 10 ? 2 : 1) + " %";
}

function formatNum(n) {
  if (n === null || n === undefined) return "n/a";
  return n.toLocaleString("fr-FR");
}

function computeStatus(row, currVal) {
  if (currVal === null || currVal === undefined) return "ok";
  const m = row.mode || "lowerBetter";
  const t = row.thresholds || DEFAULT_THRESHOLDS[m];

  if (m === "higherBetter") return "ok";

  // lowerBetter: higher count/percent = worse
  if (t.warnAbs !== undefined || t.badAbs !== undefined) {
    if (currVal.count >= (t.badAbs ?? Infinity)) return "bad";
    if (currVal.count >= (t.warnAbs ?? Infinity)) return "warn";
    return "ok";
  }
  // Percent-based
  const pct = currVal.percent ?? 0;
  if (pct >= (t.badPct ?? Infinity)) return "bad";
  if (pct >= (t.warnPct ?? Infinity)) return "warn";
  return "ok";
}

function deltaInfo(currVal, prevVal, mode) {
  if (!currVal || !prevVal) return { text: "n/a", color: C.muted };
  const d = currVal.count - prevVal.count;
  if (d === 0) return { text: "=", color: C.muted };
  const sign = d > 0 ? "↑ +" : "↓ ";
  const better = (mode === "lowerBetter" && d < 0) || (mode === "higherBetter" && d > 0);
  return {
    text: sign + Math.abs(d).toLocaleString("fr-FR"),
    color: better ? C.ok : C.bad,
  };
}

function resolveRow(row, currentParsed, previousParsed) {
  const curr = getMetric(currentParsed, row.section, row.metric);
  const prev = previousParsed ? getMetric(previousParsed, row.section, row.metric) : null;
  const stat = computeStatus(row, curr);
  const delta = deltaInfo(curr, prev, row.mode);
  return { row, curr, prev, status: stat, delta };
}

// =============================================================
// DECK BUILDER
// =============================================================

function buildDeck(currentParsed, previousParsed, config, outputPath) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = config.agency || "Alexis Willot";
  pres.title = `Crawl overview ${config.client || ""}`;

  const SITE = config.site || currentParsed.meta["Site Crawled"] || "n/a";
  const CRAWL_DATE = config.crawlDate || formatDateFr(currentParsed.meta["Start Date"]);
  const ELAPSED = formatElapsed(currentParsed.meta["Elapsed"]);
  const COMPARE = previousParsed
    ? `comparaison vs S-1 (${formatDateFr(previousParsed.meta["Start Date"])})`
    : "baseline (première itération)";

  const totalEncountered = getMetric(currentParsed, null, "Total URLs Encountered")?.count ?? 0;

  // Frame helper
  function buildSlide(titleText, sectionLabel) {
    const s = pres.addSlide();
    s.background = { color: C.white };
    s.addText(sectionLabel, {
      x: 0.5, y: 0.35, w: 8, h: 0.3,
      fontFace: FONT_H, fontSize: 10, color: C.accent, bold: true, charSpacing: 4, margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 0.75, w: 0.06, h: 0.55,
      fill: { color: C.accent }, line: { color: C.accent, width: 0 },
    });
    s.addText(titleText, {
      x: 0.65, y: 0.7, w: 11.5, h: 0.65,
      fontFace: FONT_H, fontSize: 28, bold: true, color: C.ink, margin: 0,
    });
    s.addText(`${SITE}  •  ${CRAWL_DATE}`, {
      x: 0.5, y: 7.1, w: 6, h: 0.3,
      fontFace: FONT_B, fontSize: 9, color: C.muted, margin: 0,
    });
    s.addText(`${config.client || ""}  •  Crawl overview`, {
      x: 6.5, y: 7.1, w: 6.3, h: 0.3,
      fontFace: FONT_B, fontSize: 9, color: C.muted, align: "right", margin: 0,
    });
    return s;
  }

  function dot(slide, x, y, color) {
    slide.addShape(pres.shapes.OVAL, {
      x, y, w: 0.18, h: 0.18,
      fill: { color }, line: { color, width: 0 },
    });
  }

  function statusColor(st) {
    return st === "ok" ? C.ok : st === "warn" ? C.warn : C.bad;
  }

  // Comparison table renderer
  function renderTable(slide, x, y, w, resolvedRows, options = {}) {
    const colWidths = options.colWidths || [w * 0.42, w * 0.14, w * 0.14, w * 0.16, w * 0.14];
    const rowH = options.rowH || 0.36;
    const headers = ["Indicateur", "S-1", "S", "Δ S/S-1", "Statut"];
    const headerH = 0.4;

    let cx = x;
    headers.forEach((h, i) => {
      slide.addText(h, {
        x: cx, y, w: colWidths[i], h: headerH,
        fontFace: FONT_H, fontSize: 10, bold: true, color: C.muted,
        align: i === 0 ? "left" : "center", valign: "middle",
        charSpacing: 2, margin: 0,
      });
      cx += colWidths[i];
    });
    slide.addShape(pres.shapes.LINE, {
      x, y: y + headerH, w, h: 0, line: { color: C.border, width: 1 },
    });

    resolvedRows.forEach((r, idx) => {
      const ry = y + headerH + 0.08 + idx * rowH;
      cx = x;
      slide.addText(r.row.label, {
        x: cx, y: ry, w: colWidths[0], h: rowH,
        fontFace: FONT_B, fontSize: 11, color: C.text, valign: "middle", margin: 0,
      });
      cx += colWidths[0];

      slide.addText(r.prev ? formatNum(r.prev.count) : "n/a", {
        x: cx, y: ry, w: colWidths[1], h: rowH,
        fontFace: FONT_B, fontSize: 11, color: C.muted,
        align: "center", valign: "middle", margin: 0,
      });
      cx += colWidths[1];

      slide.addText(r.curr ? formatNum(r.curr.count) : "n/a", {
        x: cx, y: ry, w: colWidths[2], h: rowH,
        fontFace: FONT_B, fontSize: 12, bold: true, color: C.ink,
        align: "center", valign: "middle", margin: 0,
      });
      cx += colWidths[2];

      slide.addText(r.delta.text, {
        x: cx, y: ry, w: colWidths[3], h: rowH,
        fontFace: FONT_B, fontSize: 11, bold: true, color: r.delta.color,
        align: "center", valign: "middle", margin: 0,
      });
      cx += colWidths[3];

      dot(slide, cx + colWidths[4] / 2 - 0.09, ry + rowH / 2 - 0.09, statusColor(r.status));

      if (idx < resolvedRows.length - 1) {
        slide.addShape(pres.shapes.LINE, {
          x, y: ry + rowH, w, h: 0, line: { color: C.border, width: 0.5 },
        });
      }
    });
  }

  // KPI card renderer
  function renderKpiCard(slide, x, y, w, h, opts) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w, h, fill: { color: C.white }, line: { color: C.border, width: 1 },
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h, fill: { color: opts.accentColor || C.accent }, line: { width: 0 },
    });
    slide.addText(opts.label, {
      x: x + 0.25, y: y + 0.18, w: w - 0.4, h: 0.3,
      fontFace: FONT_H, fontSize: 9, bold: true, color: C.muted, charSpacing: 3, margin: 0,
    });
    slide.addText(opts.value, {
      x: x + 0.25, y: y + 0.5, w: w - 0.4, h: 0.7,
      fontFace: FONT_H, fontSize: 34, bold: true, color: C.ink, margin: 0,
    });
    if (opts.desc) {
      slide.addText(opts.desc, {
        x: x + 0.25, y: y + h - 0.6, w: w - 0.4, h: 0.3,
        fontFace: FONT_B, fontSize: 10, color: C.text, margin: 0,
      });
    }
    const sub = opts.prev
      ? `S-1 : ${formatNum(opts.prev)}   ${opts.deltaText || ""}`
      : `S-1 : n/a  (baseline)`;
    slide.addText(sub, {
      x: x + 0.25, y: y + h - 0.32, w: w - 0.4, h: 0.28,
      fontFace: FONT_B, fontSize: 9, italic: true, color: opts.deltaColor || C.muted, margin: 0,
    });
  }

  // ---- SLIDE 1: COVER ----
  {
    const s = pres.addSlide();
    s.background = { color: C.ink };
    s.addShape(pres.shapes.RECTANGLE, {
      x: 11.2, y: 0.6, w: 1.5, h: 1.5,
      fill: { color: C.accent, transparency: 70 }, line: { width: 0 }, rotate: 25,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 11.7, y: 1.0, w: 1.0, h: 1.0,
      fill: { color: C.accent, transparency: 40 }, line: { width: 0 }, rotate: 15,
    });
    s.addText(config.agency || "Alexis Willot", {
      x: 0.7, y: 0.55, w: 6, h: 0.35,
      fontFace: FONT_H, fontSize: 11, color: C.accent, bold: true, charSpacing: 5, margin: 0,
    });
    s.addText("rapport hebdomadaire", {
      x: 0.7, y: 2.2, w: 8, h: 0.4,
      fontFace: FONT_H, fontSize: 13, color: "94A3B8", charSpacing: 3, margin: 0,
    });
    s.addText(`Crawl overview ${config.client || ""}`.trim(), {
      x: 0.7, y: 2.65, w: 11.5, h: 1.0,
      fontFace: FONT_H, fontSize: 52, bold: true, color: C.white, margin: 0,
    });
    s.addText("sanity check et comparaison semaine sur semaine", {
      x: 0.7, y: 3.75, w: 11, h: 0.45,
      fontFace: FONT_B, fontSize: 18, color: "CBD5E1", italic: true, margin: 0,
    });

    const cols = [
      { label: "site", value: SITE },
      { label: "date du crawl", value: CRAWL_DATE },
      { label: "période", value: COMPARE },
    ];
    cols.forEach((c, i) => {
      const cx = 0.7 + i * 4.0;
      s.addShape(pres.shapes.LINE, {
        x: cx, y: 5.0, w: 3.5, h: 0, line: { color: C.accent, width: 1.5 },
      });
      s.addText(c.label, {
        x: cx, y: 5.15, w: 3.5, h: 0.3,
        fontFace: FONT_H, fontSize: 9, color: "94A3B8", bold: true, charSpacing: 3, margin: 0,
      });
      s.addText(c.value, {
        x: cx, y: 5.45, w: 3.8, h: 0.5,
        fontFace: FONT_H, fontSize: 16, bold: true, color: C.white, margin: 0,
      });
    });

    s.addText(`généré automatiquement depuis ${path.basename(config._csvPath || "crawl.csv")}. valeurs S-1 ${previousParsed ? "issues du crawl précédent." : "à venir au prochain crawl."}`, {
      x: 0.7, y: 6.9, w: 12, h: 0.35,
      fontFace: FONT_B, fontSize: 10, color: "94A3B8", italic: true, margin: 0,
    });
  }

  // ---- SLIDE 2: EXEC SUMMARY ----
  {
    const s = buildSlide("Synthèse exécutive", "01  •  vue d'ensemble");
    const cardW = 3.0, cardH = 1.85, gap = 0.15, startX = 0.5;
    CATALOG.execSummary.forEach((row, i) => {
      const r = resolveRow(row, currentParsed, previousParsed);
      const col = i % 4;
      const rowIdx = Math.floor(i / 4);
      const x = startX + col * (cardW + gap);
      const y = 1.6 + rowIdx * (cardH + 0.25);
      const desc = typeof row.desc === "function"
        ? row.desc(r.curr, currentParsed, totalEncountered)
        : (row.desc || "");
      renderKpiCard(s, x, y, cardW, cardH, {
        label: row.label,
        value: formatNum(r.curr?.count),
        desc,
        prev: r.prev?.count,
        deltaText: r.delta.text,
        deltaColor: r.delta.color,
        accentColor: statusColor(r.status),
      });
    });
    s.addText(
      "lecture : chaque carte affiche la valeur S, la S-1 et la variation. les pastilles colorées du bord gauche signalent la sévérité (vert / orange / rouge).",
      { x: 0.5, y: 6.65, w: 12.3, h: 0.35, fontFace: FONT_B, fontSize: 9.5, italic: true, color: C.muted, margin: 0 }
    );
  }

  // ---- SLIDE 3: VOLUMÉTRIE ----
  {
    const s = buildSlide("Volumétrie du crawl et codes réponse", "02  •  santé technique");
    s.addText("répartition des codes réponse", {
      x: 0.5, y: 1.5, w: 5.5, h: 0.35, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    const donutValues = CATALOG.slide3_volumetric.donut.metrics.map(m =>
      getMetric(currentParsed, CATALOG.slide3_volumetric.donut.section, m)?.count ?? 0
    );
    s.addChart(pres.charts.DOUGHNUT, [{
      name: "Codes réponse",
      labels: CATALOG.slide3_volumetric.donut.labels,
      values: donutValues,
    }], {
      x: 0.5, y: 1.9, w: 5.5, h: 4.3,
      chartColors: [C.ok, C.accent, C.bad, C.warn, C.muted],
      chartArea: { fill: { color: C.white } },
      showLegend: true, legendPos: "b", legendFontSize: 10, legendColor: C.text,
      showPercent: false, showValue: false, holeSize: 65,
    });
    s.addText(formatNum(totalEncountered), {
      x: 0.5, y: 3.4, w: 5.5, h: 0.5,
      fontFace: FONT_H, fontSize: 28, bold: true, color: C.ink, align: "center", margin: 0,
    });
    s.addText("URLs au total", {
      x: 0.5, y: 3.85, w: 5.5, h: 0.3,
      fontFace: FONT_B, fontSize: 10, color: C.muted, align: "center", charSpacing: 2, margin: 0,
    });
    s.addText("indicateurs clés", {
      x: 6.5, y: 1.5, w: 6.3, h: 0.35, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    const resolvedVol = CATALOG.slide3_volumetric.rows.map(r => resolveRow(r, currentParsed, previousParsed));
    renderTable(s, 6.5, 1.9, 6.3, resolvedVol, { rowH: 0.36 });
    s.addText(
      `temps de crawl : ${ELAPSED}. couverture : ${formatPct(getMetric(currentParsed, null, "Total URLs Crawled")?.percent)} des URLs rencontrées effectivement crawlées.`,
      { x: 0.5, y: 6.55, w: 12.3, h: 0.35, fontFace: FONT_B, fontSize: 10, italic: true, color: C.muted, margin: 0 }
    );
  }

  // ---- SLIDE 4: INDEXABILITÉ ----
  {
    const s = buildSlide("Indexabilité et directives robots", "03  •  signaux d'indexation");
    const calloutY = 1.5, calloutH = 1.5, calloutW = 4.05, calloutGap = 0.13;
    CATALOG.slide4_indexability.callouts.forEach((c, i) => {
      const x = 0.5 + i * (calloutW + calloutGap);
      const v = getMetric(currentParsed, c.section, c.metric);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: calloutY, w: calloutW, h: calloutH,
        fill: { color: C.surface }, line: { color: C.border, width: 1 },
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: calloutY, w: 0.08, h: calloutH,
        fill: { color: C[c.color] }, line: { width: 0 },
      });
      s.addText(c.lbl, {
        x: x + 0.25, y: calloutY + 0.18, w: calloutW - 0.4, h: 0.3,
        fontFace: FONT_H, fontSize: 10, bold: true, color: C.muted, charSpacing: 3, margin: 0,
      });
      s.addText(formatNum(v?.count), {
        x: x + 0.25, y: calloutY + 0.5, w: calloutW - 0.4, h: 0.7,
        fontFace: FONT_H, fontSize: 44, bold: true, color: C.ink, margin: 0,
      });
      s.addText(v?.percent != null ? `${formatPct(v.percent)} du total` : "", {
        x: x + 0.25, y: calloutY + 1.18, w: calloutW - 0.4, h: 0.3,
        fontFace: FONT_B, fontSize: 10, italic: true, color: C.text, margin: 0,
      });
    });
    s.addText("détail des directives et hygiène URL", {
      x: 0.5, y: 3.2, w: 6, h: 0.35, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    const resolved = CATALOG.slide4_indexability.rows.map(r => resolveRow(r, currentParsed, previousParsed));
    renderTable(s, 0.5, 3.6, 12.3, resolved, { rowH: 0.34 });
  }

  // ---- SLIDE 5: ON-PAGE ----
  {
    const s = buildSlide("Titles, meta descriptions et headings", "04  •  on-page");
    function block(label, y, rows) {
      s.addText(label, {
        x: 0.5, y, w: 6, h: 0.3,
        fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
      });
      const resolved = rows.map(r => resolveRow(r, currentParsed, previousParsed));
      renderTable(s, 0.5, y + 0.35, 6, resolved, { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 });
    }
    function blockRight(label, y, rows) {
      s.addText(label, {
        x: 6.8, y, w: 6, h: 0.3,
        fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
      });
      const resolved = rows.map(r => resolveRow(r, currentParsed, previousParsed));
      renderTable(s, 6.8, y + 0.35, 6, resolved, { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 });
    }
    block("page titles", 1.5, CATALOG.slide5_onPage.titles);
    block("meta descriptions", 4.6, CATALOG.slide5_onPage.meta);
    blockRight("H1", 1.5, CATALOG.slide5_onPage.h1);
    blockRight("H2", 4.0, CATALOG.slide5_onPage.h2);
  }

  // ---- SLIDE 6: CONTENT & IMAGES ----
  {
    const s = buildSlide("Qualité du contenu et optimisation des images", "05  •  contenu");
    s.addText("contenu textuel", {
      x: 0.5, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    const resolvedC = CATALOG.slide6_content.content.map(r => resolveRow(r, currentParsed, previousParsed));
    renderTable(s, 0.5, 1.85, 6, resolvedC, { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 });
    s.addText("images", {
      x: 6.8, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    const resolvedI = CATALOG.slide6_content.images.map(r => resolveRow(r, currentParsed, previousParsed));
    renderTable(s, 6.8, 1.85, 6, resolvedI, { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 });

    // Bottom callout: detect worst image metric
    const missSize = getMetric(currentParsed, "Images", "Missing Size Attributes");
    const heavyImg = getMetric(currentParsed, "Images", "Over 100 KB");
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 5.5, w: 12.3, h: 1.1,
      fill: { color: C.warnBg }, line: { color: C.warn, width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 5.5, w: 0.08, h: 1.1, fill: { color: C.warn }, line: { width: 0 },
    });
    s.addText("point d'attention", {
      x: 0.75, y: 5.6, w: 12, h: 0.3,
      fontFace: FONT_H, fontSize: 10, bold: true, color: C.warn, charSpacing: 3, margin: 0,
    });
    s.addText(
      `${formatPct(missSize?.percent)} des images sont servies sans attributs width/height. impact direct sur CLS et Core Web Vitals. ${formatPct(heavyImg?.percent)} dépassent 100 KB et méritent une revue de compression.`,
      { x: 0.75, y: 5.9, w: 12, h: 0.6, fontFace: FONT_B, fontSize: 11, color: C.ink2, margin: 0 }
    );
  }

  // ---- SLIDE 7: INTERNATIONAL ----
  {
    const s = buildSlide("International : canonicals et hreflang", "06  •  i18n");
    s.addText("canonicals", {
      x: 0.5, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 0.5, 1.85, 6,
      CATALOG.slide7_international.canonicals.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 }
    );
    s.addText("hreflang", {
      x: 6.8, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 6.8, 1.85, 6,
      CATALOG.slide7_international.hreflang.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.34 }
    );

    const xdef = getMetric(currentParsed, "Hreflang", "Missing X-Default");
    const retn = getMetric(currentParsed, "Hreflang", "Missing Return Links");
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 5.5, w: 12.3, h: 1.1, fill: { color: C.badBg }, line: { color: C.bad, width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 5.5, w: 0.08, h: 1.1, fill: { color: C.bad }, line: { width: 0 },
    });
    s.addText("priorité forte", {
      x: 0.75, y: 5.6, w: 12, h: 0.3,
      fontFace: FONT_H, fontSize: 10, bold: true, color: C.bad, charSpacing: 3, margin: 0,
    });
    s.addText(
      `${formatPct(xdef?.percent)} des pages n'ont pas de x-default déclaré. ${retn?.count ?? 0} pages ont des return links manquants, ce qui invalide la grappe hreflang correspondante.`,
      { x: 0.75, y: 5.9, w: 12, h: 0.6, fontFace: FONT_B, fontSize: 11, color: C.ink2, margin: 0 }
    );
  }

  // ---- SLIDE 8: STRUCTURED DATA ----
  {
    const s = buildSlide("Structured data : couverture et validité", "07  •  données structurées");
    s.addText("erreurs et warnings", {
      x: 0.5, y: 1.5, w: 6, h: 0.35, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    const barValues = CATALOG.slide8_schema.bar.metrics.map(m =>
      getMetric(currentParsed, CATALOG.slide8_schema.bar.section, m)?.count ?? 0
    );
    s.addChart(pres.charts.BAR, [{
      name: "Pages concernées",
      labels: CATALOG.slide8_schema.bar.labels,
      values: barValues,
    }], {
      x: 0.5, y: 1.95, w: 6, h: 4.3, barDir: "col", chartColors: [C.bad],
      chartArea: { fill: { color: C.white } },
      catAxisLabelColor: C.muted, catAxisLabelFontSize: 9,
      valAxisLabelColor: C.muted, valAxisLabelFontSize: 9,
      valGridLine: { color: C.border, size: 0.5 }, catGridLine: { style: "none" },
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: C.ink2, dataLabelFontSize: 10,
      showLegend: false,
    });
    s.addText("synthèse", {
      x: 6.8, y: 1.5, w: 6, h: 0.35, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    renderTable(s, 6.8, 1.95, 6,
      CATALOG.slide8_schema.rows.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.36 }
    );
    const valErr = getMetric(currentParsed, "Structured Data", "Validation Errors");
    s.addText(
      `lecture : couverture 100 % en JSON-LD mais ${formatPct(valErr?.percent)} des pages ont au moins une erreur de validation.`,
      { x: 0.5, y: 6.55, w: 12.3, h: 0.35, fontFace: FONT_B, fontSize: 10, italic: true, color: C.muted, margin: 0 }
    );
  }

  // ---- SLIDE 9: ARCHITECTURE ----
  {
    const s = buildSlide("Sitemap, orphelines et profondeur", "08  •  architecture");
    s.addText("sitemap", {
      x: 0.5, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 0.5, 1.85, 6,
      CATALOG.slide9_architecture.sitemap.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.32 }
    );
    s.addText("anchor text et linking interne", {
      x: 0.5, y: 4.4, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 0.5, 4.75, 6,
      CATALOG.slide9_architecture.links.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.32 }
    );

    s.addText("profondeur de clic (depuis l'accueil)", {
      x: 6.8, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    const depthSec = CATALOG.slide9_architecture.depthSection;
    const depthLabels = CATALOG.slide9_architecture.depthLabels;
    const depthValues = depthLabels.map(l => getMetric(currentParsed, depthSec, l)?.count ?? 0);
    s.addChart(pres.charts.BAR, [{
      name: "Pages", labels: depthLabels, values: depthValues,
    }], {
      x: 6.8, y: 1.95, w: 6, h: 4.3, barDir: "col", chartColors: [C.accent],
      chartArea: { fill: { color: C.white } },
      catAxisLabelColor: C.muted, catAxisLabelFontSize: 11,
      valAxisLabelColor: C.muted, valAxisLabelFontSize: 9,
      valGridLine: { color: C.border, size: 0.5 }, catGridLine: { style: "none" },
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: C.ink2, dataLabelFontSize: 10,
      showLegend: false,
    });
    // Find biggest depth bucket
    const maxIdx = depthValues.indexOf(Math.max(...depthValues));
    const maxPct = (depthValues[maxIdx] / depthValues.reduce((a, b) => a + b, 0) * 100).toFixed(1);
    s.addText(
      `${maxPct} % des pages se trouvent à ${depthLabels[maxIdx]} clic${maxIdx > 1 ? "s" : ""}. à surveiller pour la dilution du PageRank interne.`,
      { x: 6.8, y: 6.35, w: 6, h: 0.5, fontFace: FONT_B, fontSize: 10, italic: true, color: C.muted, margin: 0 }
    );
  }

  // ---- SLIDE 10: PERF & SECURITY ----
  {
    const s = buildSlide("Performance PageSpeed et headers de sécurité", "09  •  perf et sécurité");
    s.addText("opportunités PageSpeed", {
      x: 0.5, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 0.5, 1.85, 6,
      CATALOG.slide10_perfSecurity.pagespeed.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.32 }
    );
    s.addText("headers de sécurité manquants", {
      x: 6.8, y: 1.5, w: 6, h: 0.3,
      fontFace: FONT_H, fontSize: 12, bold: true, color: C.accent, charSpacing: 2, margin: 0,
    });
    renderTable(s, 6.8, 1.85, 6,
      CATALOG.slide10_perfSecurity.security.map(r => resolveRow(r, currentParsed, previousParsed)),
      { colWidths: [3.0, 0.7, 0.7, 0.9, 0.7], rowH: 0.32 }
    );
  }

  // ---- SLIDE 11: GSC ----
  {
    const s = buildSlide("Intégration Search Console", "10  •  GSC");
    CATALOG.slide11_gsc.cards.forEach((c, i) => {
      const x = 0.5 + i * 4.1;
      const w = 4.0, h = 1.6;
      const v = getMetric(currentParsed, c.section, c.metric);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: 1.5, w, h, fill: { color: C.white }, line: { color: C.border, width: 1 },
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: 1.5, w: 0.08, h, fill: { color: C[c.color] }, line: { width: 0 },
      });
      s.addText(c.lbl, {
        x: x + 0.25, y: 1.62, w: w - 0.4, h: 0.3,
        fontFace: FONT_H, fontSize: 10, bold: true, color: C.muted, charSpacing: 3, margin: 0,
      });
      s.addText(formatNum(v?.count), {
        x: x + 0.25, y: 1.92, w: w - 0.4, h: 0.7,
        fontFace: FONT_H, fontSize: 38, bold: true, color: C.ink, margin: 0,
      });
      s.addText(v?.percent != null ? `${formatPct(v.percent)} des URLs avec data GSC` : "", {
        x: x + 0.25, y: 2.7, w: w - 0.4, h: 0.3,
        fontFace: FONT_B, fontSize: 10, italic: true, color: C.text, margin: 0,
      });
    });
    s.addText("détail Search Console", {
      x: 0.5, y: 3.4, w: 12, h: 0.3, fontFace: FONT_H, fontSize: 13, bold: true, color: C.ink2, margin: 0,
    });
    renderTable(s, 0.5, 3.75, 12.3,
      CATALOG.slide11_gsc.rows.map(r => resolveRow(r, currentParsed, previousParsed)),
      { rowH: 0.34 }
    );
  }

  // ---- SLIDE 12: ACTION PLAN ----
  // Auto-generate priorities from worst-status rows across the deck
  {
    const s = buildSlide("Plan d'action et priorités semaine", "11  •  next steps");
    const allRows = [
      ...CATALOG.slide3_volumetric.rows,
      ...CATALOG.slide4_indexability.rows,
      ...CATALOG.slide5_onPage.titles, ...CATALOG.slide5_onPage.meta,
      ...CATALOG.slide5_onPage.h1, ...CATALOG.slide5_onPage.h2,
      ...CATALOG.slide6_content.content, ...CATALOG.slide6_content.images,
      ...CATALOG.slide7_international.canonicals, ...CATALOG.slide7_international.hreflang,
      ...CATALOG.slide8_schema.rows,
      ...CATALOG.slide9_architecture.sitemap, ...CATALOG.slide9_architecture.links,
      ...CATALOG.slide10_perfSecurity.pagespeed, ...CATALOG.slide10_perfSecurity.security,
      ...CATALOG.slide11_gsc.rows,
    ];
    const resolved = allRows.map(r => resolveRow(r, currentParsed, previousParsed))
      .filter(r => r.curr && r.row.mode === "lowerBetter");

    const bad = resolved.filter(r => r.status === "bad")
      .sort((a, b) => (b.curr?.count ?? 0) - (a.curr?.count ?? 0))
      .slice(0, 5);
    const warn = resolved.filter(r => r.status === "warn")
      .sort((a, b) => (b.curr?.count ?? 0) - (a.curr?.count ?? 0))
      .slice(0, 5);
    const ok = resolved.filter(r => r.status === "ok" && r.curr.count > 0)
      .sort((a, b) => (b.curr?.count ?? 0) - (a.curr?.count ?? 0))
      .slice(0, 5);

    const cols = [
      { title: "priorité haute",   color: C.bad,    items: bad },
      { title: "priorité moyenne", color: C.warn,   items: warn },
      { title: "à surveiller",     color: C.accent, items: ok },
    ];

    cols.forEach((col, i) => {
      const x = 0.5 + i * 4.15;
      const w = 4.05, h = 4.7;
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: 1.5, w, h, fill: { color: C.surface }, line: { color: C.border, width: 1 },
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: 1.5, w, h: 0.06, fill: { color: col.color }, line: { width: 0 },
      });
      s.addText(col.title, {
        x: x + 0.25, y: 1.7, w: w - 0.4, h: 0.4,
        fontFace: FONT_H, fontSize: 14, bold: true, color: col.color, charSpacing: 2, margin: 0,
      });
      if (col.items.length === 0) {
        s.addText("aucune ligne dans cette catégorie", {
          x: x + 0.25, y: 2.2, w: w - 0.4, h: 0.5,
          fontFace: FONT_B, fontSize: 11, italic: true, color: C.muted, margin: 0,
        });
      } else {
        const lines = col.items.map((r, k) => ({
          text: `${r.row.label} (${formatNum(r.curr.count)}${r.curr.percent != null ? `, ${formatPct(r.curr.percent)}` : ""})`,
          options: { bullet: { code: "25A0" }, breakLine: k < col.items.length - 1, color: C.text },
        }));
        s.addText(lines, {
          x: x + 0.25, y: 2.2, w: w - 0.4, h: h - 0.85,
          fontFace: FONT_B, fontSize: 11, color: C.text, paraSpaceAfter: 8, valign: "top",
        });
      }
    });

    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 6.4, w: 12.3, h: 0.55, fill: { color: C.ink }, line: { width: 0 },
    });
    s.addText(
      previousParsed
        ? "deltas et statuts calculés automatiquement à partir du crawl S-1. pour le crawl S+1 : node generate.js --current S+1.csv --previous S.csv ..."
        : "premier crawl : les pastilles reflètent les seuils absolus. au crawl suivant, repasser le CSV S-1 en --previous pour activer les deltas.",
      { x: 0.7, y: 6.4, w: 12, h: 0.55, fontFace: FONT_B, fontSize: 10, color: C.white, italic: true, valign: "middle", margin: 0 }
    );
  }

  return pres.writeFile({ fileName: outputPath });
}

// =============================================================
// HELPERS FORMAT
// =============================================================
function formatDateFr(d) {
  if (!d) return "n/a";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  const months = ["jan","fév","mars","avr","mai","juin","juil","août","sep","oct","nov","déc"];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function formatElapsed(e) {
  if (!e) return "n/a";
  const m = e.match(/^(\d+):(\d+):(\d+)/);
  if (!m) return e;
  const [_, h, mn, s] = m;
  if (parseInt(h, 10) > 0) return `${parseInt(h, 10)} h ${parseInt(mn, 10)} min`;
  return `${parseInt(mn, 10)} min ${parseInt(s, 10)} s`;
}

// =============================================================
// CLI
// =============================================================
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.current || !args.output) {
    console.error(`
Usage:
  node generate.js --current <csv> [--previous <csv>] [--config <json>] --output <pptx> [--state <json>]

Options:
  --current   chemin vers le CSV Crawl Overview de la semaine
  --previous  chemin vers le CSV de la semaine précédente (active les deltas)
  --config    fichier JSON avec { client, site, agency, crawlDate }
  --output    chemin du fichier .pptx généré
  --state     sauvegarde une copie du CSV S à utiliser comme S-1 au prochain run
`);
    process.exit(1);
  }

  const currentParsed = parseCrawlOverview(args.current);
  const previousParsed = args.previous ? parseCrawlOverview(args.previous) : null;

  let config = {};
  if (args.config && fs.existsSync(args.config)) {
    config = JSON.parse(fs.readFileSync(args.config, "utf8"));
  }
  config._csvPath = args.current;

  console.log(`Génération du deck...`);
  console.log(`  Site:      ${config.site || currentParsed.meta["Site Crawled"]}`);
  console.log(`  Client:    ${config.client || "(non spécifié)"}`);
  console.log(`  Crawl S:   ${args.current}`);
  console.log(`  Crawl S-1: ${args.previous || "(baseline, pas de comparaison)"}`);

  await buildDeck(currentParsed, previousParsed, config, args.output);

  if (args.state) {
    fs.copyFileSync(args.current, args.state);
    console.log(`  État S sauvegardé dans ${args.state} (à utiliser comme --previous au prochain run)`);
  }

  console.log(`OK -> ${args.output}`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildDeck };
