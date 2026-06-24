#!/usr/bin/env node
/**
 * Site knowledge distiller for grynow.in and mywall.me
 *
 * Crawls a website, extracts the readable content of each meaningful page,
 * asks Claude to distill it into a tight "knowledge nugget" (NOT the raw page
 * text), and stores those nuggets in the knowledge_base table as
 * category='site-knowledge'. A second pass synthesises all nuggets into a
 * site-overview doc for the site (distinct from the curated business-overview).
 *
 * The Research Agent already reads knowledge_base via search_knowledge_base(),
 * so distilled knowledge reaches the writer with no workflow change.
 *
 * Usage: node distill-site.js --site grynow
 *        node distill-site.js --site mywall --max-pages 80
 *        node distill-site.js --site grynow --dry-run   (no DB writes, no synthesis)
 */

// Works whether run from project root or from setup/crawler/
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const axios = require("axios");
const cheerio = require("cheerio");
const pLimit = require("p-limit");
const robotsParser = require("robots-parser");
const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const SITES = {
  grynow: { slug: "grynow", baseUrl: "https://grynow.in" },
  mywall: { slug: "mywall", baseUrl: "https://mywall.me" },
};

const CONFIG = {
  maxPages: 150, // override with --max-pages
  concurrency: 3, // concurrent fetches
  delayMs: 800, // ms between requests per worker
  maxDepth: 6,
  minWords: 120, // pages thinner than this are skipped (nav-only, tag pages, etc.)
  model: "claude-sonnet-4-6",
  distillConcurrency: 4, // concurrent Claude calls
  skipPatterns: [
    /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|mp3|ico|woff|woff2|ttf)$/i,
    /\?(.*&)?s=/,
    /\/cdn-cgi\//,
    /\/wp-json\//,
    /\/#/,
    /\/tag\//,
    /\/category\//,
    /\/author\//,
    /\/page\/[2-9]\d*\//,
  ],
  userAgent: "SEO-Content-Crawler/1.0 (internal; content research bot)",
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = "";
    let normalized = u.toString();
    if (normalized.endsWith("/") && u.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

function isInternal(url, baseUrl) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    return (
      u.hostname === b.hostname ||
      u.hostname === `www.${b.hostname}` ||
      `www.${u.hostname}` === b.hostname
    );
  } catch {
    return false;
  }
}

function shouldSkip(url) {
  return CONFIG.skipPatterns.some((p) => p.test(url));
}

async function fetchRobots(baseUrl) {
  try {
    const res = await axios.get(`${baseUrl}/robots.txt`, { timeout: 5000 });
    return robotsParser(`${baseUrl}/robots.txt`, res.data);
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      headers: { "User-Agent": CONFIG.userAgent, Accept: "text/html" },
      maxRedirects: 3,
    });
    if (!res.headers["content-type"]?.includes("text/html")) return null;
    return res.data;
  } catch (err) {
    console.warn(`  SKIP ${url} — ${err.message}`);
    return null;
  }
}

/**
 * Extract the readable main content of a page as plain text, plus metadata and
 * the internal links found on it (so the crawl can keep expanding).
 */
function extractPage(html, url) {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || "";
  const h1 = $("h1").first().text().trim() || "";
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";

  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.startsWith("mailto:") && !href.startsWith("tel:")) {
      const normalized = normalizeUrl(href, url);
      if (normalized) links.push(normalized);
    }
  });

  // Strip non-content chrome before reading body text.
  $(
    "script, style, noscript, iframe, svg, nav, header, footer, aside, form, " +
      ".nav, .navbar, .menu, .header, .footer, .sidebar, .cookie, .breadcrumb",
  ).remove();

  // Prefer a real main-content container; fall back to <body>.
  let $main = $("main").first();
  if (!$main.length) $main = $("article").first();
  if (!$main.length) $main = $('[role="main"]').first();
  if (!$main.length) $main = $("#content, .content, .entry-content").first();
  if (!$main.length) $main = $("body");

  const text = $main
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

  const wordCount = text ? text.split(/\s+/).length : 0;

  return { title, h1, meta_description: metaDesc, text, wordCount, links };
}

const DISTILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    useful: {
      type: "boolean",
      description:
        "false if the page has no knowledge worth keeping for a content writer (thin, boilerplate, pure navigation, login, cart, etc.)",
    },
    page_type: {
      type: "string",
      enum: [
        "product",
        "service",
        "pricing",
        "about",
        "blog",
        "landing",
        "case-study",
        "other",
      ],
    },
    summary: {
      type: "string",
      description: "1-2 sentences on what this page covers.",
    },
    key_facts: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete, reusable facts: brand claims, stats, offerings, features, numbers. Each a standalone sentence. [] if none.",
    },
    terminology: {
      type: "array",
      items: { type: "string" },
      description:
        "Brand-specific terms / phrasings a writer should mirror. [] if none.",
    },
    audience_signals: {
      type: "string",
      description: "Who this page speaks to, if discernible. '' if unclear.",
    },
  },
  required: [
    "useful",
    "page_type",
    "summary",
    "key_facts",
    "terminology",
    "audience_signals",
  ],
};

function distillPrompt(site, page) {
  // Cap input so a single huge page can't blow up the request.
  const body = page.text.slice(0, 12000);
  return `You are building a knowledge base for an SEO content writer who writes content for ${site.baseUrl}.

Distill the page below into a tight, structured "knowledge nugget" — NOT a copy of the text. Capture only what a writer would actually reuse: what the page is about, concrete brand facts/claims/offerings, brand-specific terminology, and audience signals. Be faithful to the page; do not invent facts. If the page carries nothing worth keeping, set "useful": false.

URL: ${page.url}
Title: ${page.title}
H1: ${page.h1}
Meta description: ${page.meta_description}

--- PAGE CONTENT ---
${body}
--- END PAGE CONTENT ---`;
}

function nuggetToMarkdown(page, d) {
  const lines = [`**Page type:** ${d.page_type}`, `**Summary:** ${d.summary}`];
  if (d.key_facts?.length) {
    lines.push("", "**Key facts:**");
    for (const f of d.key_facts) lines.push(`- ${f}`);
  }
  if (d.terminology?.length) {
    lines.push("", `**Brand terminology:** ${d.terminology.join("; ")}`);
  }
  if (d.audience_signals) {
    lines.push("", `**Audience:** ${d.audience_signals}`);
  }
  lines.push("", `**Source:** ${page.url}`);
  return lines.join("\n");
}

async function distillPage(site, page) {
  const res = await anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 1500,
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DISTILL_SCHEMA },
    },
    messages: [{ role: "user", content: distillPrompt(site, page) }],
  });

  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock) return null;
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    console.warn(`  PARSE FAIL ${page.url}`);
    return null;
  }
  return parsed;
}

async function synthesiseOverview(site, nuggets) {
  // Feed every nugget back in so the model can roll them into one overview.
  const corpus = nuggets
    .map(
      (n, i) =>
        `[${i + 1}] (${n.distilled.page_type}) ${n.page.title}\n${n.distilled.summary}\nFacts: ${(
          n.distilled.key_facts || []
        ).join(" | ")}`,
    )
    .join("\n\n")
    .slice(0, 80000);

  const prompt = `Below are distilled knowledge nuggets from every meaningful page on ${site.baseUrl}. Synthesise them into a single, factual business-overview brief for a content writer.

Cover: what the business is and does, its products/services, who it serves, the value propositions and differentiators it claims, and the recurring terminology it uses. Ground every statement in the nuggets — do not invent. Write in clean markdown. Be comprehensive but tight.

--- NUGGETS ---
${corpus}
--- END NUGGETS ---`;

  const res = await anthropic.messages.create({
    model: CONFIG.model,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = res.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text.trim() : "";
}

async function crawlContent(site, robots) {
  const limit = pLimit(CONFIG.concurrency);
  const visited = new Set();
  const queue = [{ url: site.baseUrl, depth: 0 }];
  const pages = [];

  while (queue.length > 0 && pages.length < CONFIG.maxPages) {
    const batch = [];
    while (queue.length > 0 && batch.length < CONFIG.concurrency * 2) {
      const item = queue.shift();
      if (!item || visited.has(item.url)) continue;
      if (shouldSkip(item.url)) continue;
      if (robots && !robots.isAllowed(item.url, CONFIG.userAgent)) continue;
      visited.add(item.url);
      batch.push(item);
    }
    if (!batch.length) break;

    const fetched = await Promise.all(
      batch.map((item) =>
        limit(async () => {
          await sleep(CONFIG.delayMs);
          const html = await fetchPage(item.url);
          if (!html) return null;
          const data = extractPage(html, item.url);
          return { ...item, ...data };
        }),
      ),
    );

    for (const page of fetched) {
      if (!page) continue;

      // Expand the crawl frontier from this page's internal links.
      if (page.depth < CONFIG.maxDepth) {
        for (const link of page.links) {
          if (
            isInternal(link, site.baseUrl) &&
            !visited.has(link) &&
            !shouldSkip(link)
          ) {
            queue.push({ url: link, depth: page.depth + 1 });
          }
        }
      }

      if (page.wordCount < CONFIG.minWords) {
        console.log(`  thin (${page.wordCount}w) — skip ${page.url}`);
        continue;
      }
      pages.push(page);
      console.log(`  [${pages.length}] ${page.url} (${page.wordCount}w)`);
    }
  }

  return pages;
}

function writeMarkdownArtifacts(site, nuggets, overview) {
  // Mirror the distilled knowledge into git-tracked markdown for human reference.
  // Lives in a crawled/ subfolder so it stays separate from hand-authored docs
  // (seed-knowledge-base.js only reads top-level files, so it ignores these).
  const dir = path.resolve(__dirname, `../../knowledge-base/${site.slug}/crawled`);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const banner =
    `<!-- Auto-generated by distill-site.js on ${stamp} from ${site.baseUrl} ` +
    `(${nuggets.length} pages). Do not edit by hand — re-run the crawler to refresh. -->`;

  if (overview) {
    fs.writeFileSync(
      path.join(dir, "site-overview.md"),
      `# ${site.slug} — Site Overview (synthesised from crawl)\n\n${banner}\n\n${overview}\n`,
    );
  }

  const knowledge = nuggets
    .map(
      (n) =>
        `## ${n.page.title || n.page.url}\n\n${nuggetToMarkdown(n.page, n.distilled)}\n`,
    )
    .join("\n---\n\n");
  fs.writeFileSync(
    path.join(dir, "site-knowledge.md"),
    `# ${site.slug} — Site Knowledge (per-page nuggets)\n\n${banner}\n\n${knowledge}\n`,
  );

  console.log(
    `✓ Wrote markdown → knowledge-base/${site.slug}/crawled/ (site-overview.md, site-knowledge.md)`,
  );
}

async function run(siteKey, opts) {
  const site = SITES[siteKey];
  if (!site) {
    console.error(`Unknown site: ${siteKey}. Use: grynow | mywall`);
    process.exit(1);
  }

  console.log(`\n=== Distilling ${site.baseUrl} ===`);

  // Resolve website_id (skip in dry-run so it works without DB access).
  let websiteId = null;
  if (!opts.dryRun) {
    const { data, error } = await supabase
      .from("websites")
      .select("id")
      .eq("slug", site.slug)
      .limit(1);
    if (error) {
      console.error("Supabase error:", error.message, error.code || "");
      console.error("Check SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env");
      process.exit(1);
    }
    if (!data?.length) {
      console.error(`No row for slug="${site.slug}" in the websites table.`);
      console.error("Run setup/supabase-schema.sql first.");
      process.exit(1);
    }
    websiteId = data[0].id;
  }

  const robots = await fetchRobots(site.baseUrl);
  const pages = await crawlContent(site, robots);
  console.log(
    `\nCrawled ${pages.length} content pages. Distilling with ${CONFIG.model}...`,
  );

  // Distill pages with bounded concurrency.
  const dlimit = pLimit(CONFIG.distillConcurrency);
  const nuggets = [];
  let done = 0;
  await Promise.all(
    pages.map((page) =>
      dlimit(async () => {
        let distilled;
        try {
          distilled = await distillPage(site, page);
        } catch (err) {
          console.warn(`  DISTILL ERROR ${page.url} — ${err.message}`);
          return;
        }
        done++;
        if (!distilled || !distilled.useful) {
          console.log(`  [${done}/${pages.length}] drop ${page.url}`);
          return;
        }
        console.log(`  [${done}/${pages.length}] keep ${page.url}`);
        nuggets.push({ page, distilled });
      }),
    ),
  );

  console.log(`\nKept ${nuggets.length} knowledge nuggets.`);

  if (opts.dryRun) {
    console.log("\n--- DRY RUN: sample nuggets ---");
    for (const n of nuggets.slice(0, 5)) {
      console.log(
        `\n# ${n.page.title}\n${nuggetToMarkdown(n.page, n.distilled)}`,
      );
    }
    console.log("\n(dry run: nothing written, synthesis skipped)\n");
    return;
  }

  // Refresh this site's distilled knowledge: clear prior site-knowledge rows for
  // the site, then insert the fresh batch (idempotent, no ON CONFLICT needed).
  const { error: clrErr } = await supabase
    .from("knowledge_base")
    .delete()
    .eq("website_id", websiteId)
    .eq("category", "site-knowledge");
  if (clrErr) console.error("KB clear error:", clrErr.message);

  let inserted = 0;
  for (let i = 0; i < nuggets.length; i += 50) {
    const rows = nuggets.slice(i, i + 50).map((n) => ({
      website_id: websiteId,
      category: "site-knowledge",
      title: n.page.title || n.page.h1 || n.page.url,
      content: nuggetToMarkdown(n.page, n.distilled),
      source_url: n.page.url,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("knowledge_base").insert(rows);
    if (error) console.error("KB insert error:", error.message);
    else inserted += rows.length;
  }
  console.log(`✓ Stored ${inserted} site-knowledge nuggets.`);

  // Site-level synthesis pass → a 'site-overview' doc (synthetic source_url so it
  // upserts in place each run). Kept under its own category so it never collides
  // with the hand-authored 'business-overview' the writer reads.
  let overview = null;
  if (nuggets.length) {
    console.log(`\nSynthesising site overview...`);
    overview = await synthesiseOverview(site, nuggets);
    if (overview) {
      await supabase
        .from("knowledge_base")
        .delete()
        .eq("website_id", websiteId)
        .eq("category", "site-overview");
      const { error } = await supabase.from("knowledge_base").insert({
        website_id: websiteId,
        category: "site-overview",
        title: `${site.slug} — site overview (synthesised from site crawl)`,
        content: overview,
        source_url: `synthesis://${site.slug}/site-overview`,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error("Overview insert error:", error.message);
      else
        console.log(
          `✓ Stored synthesised site overview (category: site-overview).`,
        );
    }
  }

  writeMarkdownArtifacts(site, nuggets, overview);

  console.log(`\nDone for ${site.baseUrl}.\n`);
}

// CLI entry point
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const siteKey = flag("--site");
const maxPages = flag("--max-pages");
const dryRun = args.includes("--dry-run");

if (!siteKey) {
  console.error(
    "Usage: node distill-site.js --site grynow|mywall [--max-pages N] [--dry-run]",
  );
  process.exit(1);
}
if (maxPages) CONFIG.maxPages = parseInt(maxPages, 10);

run(siteKey, { dryRun }).catch((err) => {
  console.error("Distiller error:", err);
  process.exit(1);
});
