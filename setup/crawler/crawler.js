#!/usr/bin/env node
/**
 * Internal link crawler for grynow.in and mywall.me
 * Usage: node crawler.js --site grynow
 *        node crawler.js --site mywall
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
const { URL } = require("url");

const SITES = {
  grynow: { slug: "grynow", baseUrl: "https://grynow.in" },
  mywall: { slug: "mywall", baseUrl: "https://mywall.me" },
};

const CONFIG = {
  maxPages: 500,
  concurrency: 3, // concurrent requests
  delayMs: 800, // ms between requests per worker
  maxDepth: 6,
  skipPatterns: [
    /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|mp3|ico|woff|woff2|ttf)$/i,
    /\?(.*&)?s=/,
    /\/cdn-cgi\//,
    /\/wp-json\//,
    /\/#/,
    /\/page\/[4-9]\d*\//,
    /\/page\/[1-9]\d+\d+\//,
  ],
  userAgent: "SEO-Content-Crawler/1.0 (internal; content research bot)",
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = "";
    // Remove trailing slash inconsistency
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
      headers: {
        "User-Agent": CONFIG.userAgent,
        Accept: "text/html",
      },
      maxRedirects: 3,
    });
    if (!res.headers["content-type"]?.includes("text/html")) return null;
    return res.data;
  } catch (err) {
    console.warn(`  SKIP ${url} — ${err.message}`);
    return null;
  }
}

function extractPageData(html, url) {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || "";
  const h1 = $("h1").first().text().trim() || "";
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";

  const links = [];
  $("a[href]").each((_, el) => {
    const anchor = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href");
    if (
      anchor &&
      href &&
      !href.startsWith("mailto:") &&
      !href.startsWith("tel:")
    ) {
      const normalized = normalizeUrl(href, url);
      if (normalized) links.push({ anchor, href: normalized });
    }
  });

  return { title, h1, meta_description: metaDesc, links_on_page: links };
}

async function crawl(siteKey) {
  const site = SITES[siteKey];
  if (!site) {
    console.error(`Unknown site: ${siteKey}. Use: grynow | mywall`);
    process.exit(1);
  }

  console.log(`\n=== Crawling ${site.baseUrl} ===`);

  // Get website_id from Supabase
  const { data: websites, error: wErr } = await supabase
    .from("websites")
    .select("id")
    .eq("slug", site.slug)
    .limit(1);

  if (wErr) {
    console.error("Supabase error:", wErr.message, wErr.code || "");
    console.error("Check: SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env");
    process.exit(1);
  }
  if (!websites?.length) {
    console.error(
      `No row found for slug="${site.slug}" in the websites table.`,
    );
    console.error(
      "Run setup/supabase-schema.sql in your Supabase SQL Editor first.",
    );
    process.exit(1);
  }
  const websiteId = websites[0].id;

  const robots = await fetchRobots(site.baseUrl);
  const limit = pLimit(CONFIG.concurrency);

  const visited = new Set();
  const queue = [{ url: site.baseUrl, depth: 0 }];
  const results = [];
  let pagesCount = 0;

  while (queue.length > 0 && pagesCount < CONFIG.maxPages) {
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
          const data = extractPageData(html, item.url);
          pagesCount++;
          console.log(`  [${pagesCount}] ${item.url} (depth ${item.depth})`);
          return { ...item, ...data };
        }),
      ),
    );

    for (const page of fetched) {
      if (!page) continue;
      results.push(page);

      if (page.depth < CONFIG.maxDepth) {
        for (const link of page.links_on_page) {
          const normalized = link.href;
          if (
            normalized &&
            isInternal(normalized, site.baseUrl) &&
            !visited.has(normalized) &&
            !shouldSkip(normalized)
          ) {
            queue.push({ url: normalized, depth: page.depth + 1 });
          }
        }
      }
    }
  }

  console.log(`\nCrawled ${results.length} pages. Uploading to Supabase...`);

  // Batch upsert to Supabase (100 at a time)
  let uploaded = 0;
  for (let i = 0; i < results.length; i += 100) {
    const batch = results.slice(i, i + 100).map((p) => ({
      website_id: websiteId,
      url: p.url,
      title: p.title,
      h1: p.h1,
      meta_description: p.meta_description,
      links_on_page: p.links_on_page,
      depth: p.depth,
      crawled_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("internal_links")
      .upsert(batch, { onConflict: "website_id,url", ignoreDuplicates: false });

    if (error) {
      console.error("Supabase upsert error:", error.message);
    } else {
      uploaded += batch.length;
    }
  }

  console.log(`✓ Uploaded ${uploaded} pages for ${site.baseUrl}\n`);
}

// CLI entry point
const args = process.argv.slice(2);
const siteFlag = args.indexOf("--site");
const siteKey = siteFlag >= 0 ? args[siteFlag + 1] : null;

if (!siteKey) {
  console.error("Usage: node crawler.js --site grynow|mywall");
  process.exit(1);
}

crawl(siteKey).catch((err) => {
  console.error("Crawler error:", err);
  process.exit(1);
});
