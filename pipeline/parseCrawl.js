// parseCrawl.js
// Parses Screaming Frog "Crawl Overview" CSV export into a nested object:
//   data[section][metric] = { count: number, percent: number, total: number }
//
// Also extracts top-level metadata (site, dates, elapsed time).

const fs = require("fs");

function parseCsvLine(line) {
  // Minimal CSV split: handles quoted fields including escaped quotes
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parsePercent(s) {
  if (!s) return null;
  const m = s.replace(",", ".").replace("%", "").trim();
  const n = parseFloat(m);
  return isNaN(n) ? null : n;
}

function parseNum(s) {
  if (s === "" || s === undefined || s === null) return null;
  const n = parseInt(String(s).replace(/\s/g, ""), 10);
  return isNaN(n) ? null : n;
}

// Section headers look like "Page Titles,,,," — non-empty first cell, all other cells empty.
function isSectionHeader(cells) {
  if (!cells[0] || !cells[0].trim()) return false;
  if (cells.length < 2) return false;
  return cells.slice(1).every(c => !c || !c.trim());
}

// Separator lines: ",,,," — all cells empty
function isSeparator(cells) {
  return cells.every(c => !c || !c.trim());
}

function parseCrawlOverview(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8");
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);

  const meta = {};
  const summary = {};         // Top metrics with no explicit section
  const data = {};            // Sectioned metrics
  let currentSection = null;
  let inMetaBlock = true;
  let pastFirstSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const cells = parseCsvLine(raw);

    if (isSeparator(cells)) {
      inMetaBlock = false;
      pastFirstSeparator = true;
      currentSection = null;
      continue;
    }

    // Metadata block at top: "key,value,,,"
    if (inMetaBlock) {
      const key = (cells[0] || "").replace(/"/g, "").trim();
      const val = (cells[1] || "").replace(/"/g, "").trim();
      if (key) meta[key] = val;
      continue;
    }

    // Section header: "Page Titles,,,,"
    if (isSectionHeader(cells)) {
      currentSection = cells[0].trim();
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }

    // Column header rows (e.g. "Summary,URLs,% of Total,...") — second cell is non-numeric label
    if (cells[1] && isNaN(parseInt(cells[1].replace(/\s/g, ""), 10))) {
      continue;
    }

    const metric = (cells[0] || "").trim();
    if (!metric) continue;
    const count = parseNum(cells[1]);
    const percent = parsePercent(cells[2]);
    const total = parseNum(cells[3]);

    if (count === null) continue;

    const target = currentSection ? data[currentSection] : summary;
    target[metric] = { count, percent, total };
  }

  return { meta, summary, data };
}

// Safe lookup: tries data[section][metric], falls back to summary[metric] if section is null
function getMetric(parsed, section, metric, fallback = null) {
  if (section && parsed.data[section] && parsed.data[section][metric]) {
    return parsed.data[section][metric];
  }
  if (parsed.summary && parsed.summary[metric]) {
    return parsed.summary[metric];
  }
  return fallback;
}

module.exports = { parseCrawlOverview, getMetric };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node parseCrawl.js <csv> [section] [metric]");
    process.exit(1);
  }
  const parsed = parseCrawlOverview(args[0]);
  if (args.length === 1) {
    console.log("=== META ===");
    console.log(parsed.meta);
    console.log("\n=== SUMMARY (no section) ===");
    Object.keys(parsed.summary).forEach(m => {
      const v = parsed.summary[m];
      console.log(`  ${m}: ${v.count} (${v.percent}%)`);
    });
    console.log("\n=== SECTIONS ===");
    Object.keys(parsed.data).forEach(s => console.log(`  ${s} (${Object.keys(parsed.data[s]).length} metrics)`));
  } else if (args.length === 2) {
    console.log(parsed.data[args[1]] || `Section "${args[1]}" not found`);
  } else {
    console.log(getMetric(parsed, args[1], args[2]));
  }
}
