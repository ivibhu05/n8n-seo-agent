#!/usr/bin/env node
/**
 * Seed the knowledge_base table from the markdown docs in /knowledge-base.
 *
 * Each markdown file maps to one (website_id, category) slot. The pipeline reads
 * the KB as a flat category→content map, so one file owns one category per site.
 *
 *   knowledge-base/global/<name>.md  → website_id NULL,        category=<name>
 *   knowledge-base/grynow/<name>.md  → GRYNOW_WEBSITE_ID,      category=<mapped>
 *   knowledge-base/mywall/<name>.md  → MYWALL_WEBSITE_ID,      category=<mapped>
 *
 * Files that still contain template markers ([PLACEHOLDER], [DESCRIBE…], etc.)
 * are SKIPPED so empty templates never reach the writer. Use --force to seed
 * them anyway. Hand-authored rows leave source_url NULL — that's what keeps them
 * separate from the crawler's site-knowledge / site-overview rows.
 *
 * Usage: node seed-knowledge-base.js
 *        node seed-knowledge-base.js --site grynow
 *        node seed-knowledge-base.js --force          (seed placeholders too)
 *        node seed-knowledge-base.js --dry-run
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const KB_DIR = path.resolve(__dirname, "../../knowledge-base");

// folder → website resolver (null folder = global docs shared across sites)
const FOLDER_WEBSITE_ENV = {
  grynow: "GRYNOW_WEBSITE_ID",
  mywall: "MYWALL_WEBSITE_ID",
};

// filename stem → knowledge_base category (default: the stem itself)
const CATEGORY_MAP = {
  "audience-personas": "audience", // pipeline reads kb['audience']
};

// A file is treated as an unfilled template if it carries fill-in markers:
// explicit tags, "[e.g., ...]" prompts, or bracketed questions like "[What...?]".
const PLACEHOLDER_RE =
  /\[PLACEHOLDER\]|\[DESCRIBE|FILL THIS IN|\[e\.g\.,|\[[^\]]*\?\]|\[Name\]|\[List \d|\[USP\b|\[Service \d|\[Persona|\[Competitor/i;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

function firstHeading(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function categoryFor(stem) {
  return CATEGORY_MAP[stem] || stem;
}

async function seedFolder(folder, opts) {
  const dir = path.join(KB_DIR, folder);
  if (!fs.existsSync(dir)) return { seeded: 0, skipped: 0 };

  let websiteId = null;
  if (folder !== "global") {
    websiteId = process.env[FOLDER_WEBSITE_ENV[folder]];
    if (!websiteId) {
      console.error(
        `  ✗ ${folder}: ${FOLDER_WEBSITE_ENV[folder]} missing from .env — skipping folder`,
      );
      return { seeded: 0, skipped: 0 };
    }
  }

  let seeded = 0;
  let skipped = 0;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    const category = categoryFor(stem);
    const content = fs.readFileSync(path.join(dir, file), "utf-8").trim();
    const title = firstHeading(content, `${folder} — ${stem}`);

    if (!opts.force && PLACEHOLDER_RE.test(content)) {
      console.log(`  ⏭  skip (placeholder) ${folder}/${file} → ${category}`);
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`  • would seed ${folder}/${file} → category=${category}`);
      seeded++;
      continue;
    }

    // Replace any existing hand-authored row for this slot, then insert fresh.
    // Categories here never overlap the crawler's (site-knowledge/site-overview),
    // so this can't touch crawler-written rows.
    const del = supabase
      .from("knowledge_base")
      .delete()
      .eq("category", category);
    const { error: delErr } = websiteId
      ? await del.eq("website_id", websiteId)
      : await del.is("website_id", null);
    if (delErr) {
      console.error(`  ✗ delete ${category}: ${delErr.message}`);
      continue;
    }

    const { error: insErr } = await supabase.from("knowledge_base").insert({
      website_id: websiteId,
      category,
      title,
      content,
      updated_at: new Date().toISOString(),
    });
    if (insErr) {
      console.error(`  ✗ insert ${folder}/${file}: ${insErr.message}`);
      continue;
    }
    console.log(`  ✓ seeded ${folder}/${file} → category=${category}`);
    seeded++;
  }

  return { seeded, skipped };
}

async function run(opts) {
  console.log(`\n=== Seeding knowledge_base from ${KB_DIR} ===`);
  if (opts.force)
    console.log("(--force: placeholder files will be seeded too)");
  if (opts.dryRun) console.log("(--dry-run: no writes)");

  const folders = opts.site ? [opts.site] : ["global", "grynow", "mywall"];

  let totalSeeded = 0;
  let totalSkipped = 0;
  for (const folder of folders) {
    console.log(`\n[${folder}]`);
    const { seeded, skipped } = await seedFolder(folder, opts);
    totalSeeded += seeded;
    totalSkipped += skipped;
  }

  console.log(
    `\nDone. ${totalSeeded} doc(s) seeded, ${totalSkipped} skipped as placeholders.`,
  );
  if (totalSkipped > 0 && !opts.force) {
    console.log(
      "Fill the skipped files with real content (or run the crawler for business knowledge), then re-run.",
    );
  }
}

// CLI
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const opts = {
  site: flag("--site"),
  force: args.includes("--force"),
  dryRun: args.includes("--dry-run"),
};
if (opts.site && !["global", "grynow", "mywall"].includes(opts.site)) {
  console.error("--site must be one of: global | grynow | mywall");
  process.exit(1);
}

run(opts).catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
