# Autopilot — Autonomous SEO Blog Pipeline

A single n8n workflow that turns **one business goal** ("we want to rank for `<keyword>`")
into a **fully optimized, published blog**, orchestrating a chain of specialized agents.
It runs end-to-end with **no human in the loop**.

```
Business Goal ("rank for <keyword>")
      │
      ▼
SEO Agent ──▶ Researcher ──▶ Planner ──▶ Writer ──▶ Humanizer ──▶ Thumbnail ──▶ Deploy ──▶ Published Blog
   (Stage 0)   (Stage 1)     (Stage 2)   (Stage 3)  (Stage 4)     (stub)       (deploy-agent)
      │                                                                              │
      └──────────────────────── one n8n execution ──────────────────────────────────┘
                                                                              Learn & Archive (memory)
```

It **extends** the existing content pipeline rather than replacing it. The manual,
human-reviewed pipeline (`01-pipeline` → `03-review` → `02-memory`) still exists for
hand-briefed content. Autopilot is the autonomous sibling: `00-autopilot.json`.

---

## Why one workflow

The manual pipeline is split across three workflows only because a **human** approves
content hours later — an n8n execution can't stay paused across that gap, so approval
needs its own trigger. Autopilot removes the human gate, so the entire flow is one
continuous execution in one workflow. Memory-learning, which the manual flow runs on the
approve webhook, runs inline as the final node here.

---

## The workflow (`workflows/00-autopilot.json`)

| Node | Type | Responsibility |
|---|---|---|
| **Autopilot Webhook** | webhook (`POST /webhook/seo-autopilot`) | intake: `{ keyword, website_slug, placement?, content_type? }` |
| **Respond to Webhook** | respond | returns `"Autopilot started"` immediately (async) |
| **Config** | code | placeholder secrets + model/site/deploy config (injected by `restore-creds.js`) |
| **Autopilot Runner** | code | Stages 0–4: SEO Agent → Researcher → Planner → Writer → Humanizer. Writes `seo_brief`, `research_brief`, `strategy_brief`, and the `content_versions` row. |
| **Thumbnail Agent (stub)** | code | returns `{ thumbnail_url, thumbnail_alt }`. **Placeholder** until the real generator is delivered — swap the node body only. |
| **Deploy** | code | POSTs to the deploy-agent `/deploy`, feeding the brief's metadata/schema/thumbnail. Marks version + request `published`. |
| **Learn & Archive** | code | extracts positive memory patterns + archives the published article. |

All agent logic lives in code nodes calling the LLM REST API directly (via the shared
`fetch` shim + `parseJSON()`), matching the repo's existing convention.

---

## Agents & data contracts

Every agent communicates through **structured JSON**. The output of each stage is the
complete input of the next — no hidden dependencies, no downstream inference.

### Stage 0 — SEO Agent (Senior SEO Lead)  · prompt: `prompts/seo-agent.md`

- **In:** `keyword`/`goal`, website (slug→name/url), placement, content_type, the site's
  `knowledge_base` (business/site/brand-voice/competitors), the site's real
  `internal_links`, and **live Serper SERP data** (organic, People-Also-Ask, related).
- **Out:** the complete **`seo_brief`** (persisted to `content_requests.seo_brief`).
- Makes *every* strategic decision up front: keyword research, SERP + competitor analysis,
  content gaps, topical authority, internal + outbound linking, full outline + FAQs + CTA,
  metadata (title/description/slug/canonical/OG/Twitter) and schema types.

`seo_brief` shape (full schema in `prompts/seo-agent.md`):

```jsonc
{
  "primary_keyword": "", "placement": "off-page", "content_type": "blog",
  "business": {…}, "website_understanding": {…},
  "keywords": { "primary":"", "secondary":[], "long_tail":[], "semantic":[], "questions":[], "commercial":[], "informational":[] },
  "serp": { "intent":"", "top_competitors":[…], "content_gaps":[], "featured_snippet":{…}, "paa":[], "related_searches":[] },
  "topical_authority": { "pillar":"", "cluster":[], "supporting_articles":[] },
  "links": { "internal":[{url,anchor,placement}], "outbound":[{url,anchor,placement}] },
  "content_plan": { "angle":"", "h1":"", "outline":[{level,text,notes}], "faqs":[{q,a_hint}], "cta":{text,placement} },
  "metadata": { "meta_title":"", "meta_description":"", "slug":"", "canonical":"", "og":{…}, "twitter":{…} },
  "schema": ["Article","BlogPosting","FAQPage","BreadcrumbList"]
}
```

### Stage 1 — Researcher  · `prompts/research-agent.md`
- **In:** topic + `seo_brief.content_plan.outline` (authoritative outline) + business knowledge.
- **Out:** `research_brief` (per-section key points, reader questions, examples, data, writer notes).
- Reused as-is; no SEO work — it only gathers substance for the outline the SEO Agent set.

### Stage 2 — Planner  · `prompts/planner-agent.md`
- **In:** research notes + the brief's outline/angle.
- **Out:** `strategy_brief` (word count, depth, tone, confirmed outline, CTA).
- Confirms/refines content decisions; does **not** re-do SEO.

### Stage 3 — Writer  · `prompts/writer-agent.md`
- **In:** brief + research + plan (keywords, real internal/outbound links, FAQs, CTA, tone).
- **Out:** finished Markdown (H1-first), with the brief's links inserted as real Markdown
  links and an FAQ section.

### Stage 4 — Humanizer  · `prompts/humanizer-agent.md`
- **In:** the draft Markdown + primary keyword + brand voice.
- **Out:** improved Markdown. Removes AI tells, varies rhythm/transitions — **preserving**
  facts, keywords, heading hierarchy, every link, and length (±10%). Editor, not author.
- Safety: if the humanizer returns empty or <50% of the draft, the pipeline ships the draft.

### Thumbnail Agent — **STUB**
- **In:** `{ seo_brief, website_url, topic }`  · **Out:** `{ thumbnail_url, thumbnail_alt }`.
- Currently returns a deterministic URL (`DEFAULT_THUMBNAIL_URL` or the deploy-agent's
  per-slug convention). **Replace only the node body** when the real generator is ready;
  keep the same I/O contract and the pipeline is unaffected.

### Deploy — reuses `deploy-agent` (`POST /deploy`)
- Sends `{ target: slug, markdown, slug, metaTitle, metaDescription, canonical,
  schemaTypes, thumbnail }`. The deploy-agent clones a reference page from the target
  GitHub repo (preserving styling/chrome/SEO tags/analytics), injects the SEO Agent's exact
  metadata + schema + thumbnail, commits the post, and inserts a blog-index card.
- Output HTML/JSX is indistinguishable from a hand-authored post because it mirrors an
  existing published page.

### Learn & Archive — inline memory
- Extracts 3–5 reusable positive patterns (fast model) into `memory_patterns` and archives
  the article into `content_archive` (with `published_url`), feeding future writer samples
  and internal-link suggestions.

---

## State, errors, retries, logging

- **State machine** (`content_requests.status`): `seo_planning → researching → strategizing
  → drafting → humanizing → deploying → published`. Each transition is a Supabase `PATCH`,
  so the dashboard shows live progress. (`review`/`rework`/`approved` remain for the manual pipeline.)
- **State store:** Supabase, not n8n. `seo_brief` / `research_brief` / `strategy_brief` are
  fully auditable JSONB; every version + its `published_url` is persisted.
- **Retries:** every Claude call retries up to 3× with linear backoff. The SEO brief fails
  loud if unparseable (never writes garbage downstream).
- **Graceful degradation:** if Serper has no key or errors, the SEO Agent still runs on LLM
  knowledge (empty SERP data) rather than failing the run.
- **Deploy isolation:** the deploy-agent already isolates blog-index-card failures from the
  post commit — the post still publishes.

---

## Setup / go-live

1. **Schema:** run `setup/supabase-schema.sql` (idempotent; adds `seo_brief`, `goal`, new
   statuses, `published_url`/`thumbnail_url`).
2. **`.env`:** set `SERPER_API_KEY` (present), `ANTHROPIC_API_KEY`, Supabase, website IDs,
   `DEPLOY_WEBHOOK_URL`, `DEPLOY_TOKEN`. Optional: `MODEL_MAIN`, `MODEL_FAST`,
   `DEFAULT_THUMBNAIL_URL`.
3. **Deploy workflows:** `node setup/restore-creds.js` → `node setup/deploy-workflows.js`
   (now includes `00-autopilot.json`) → `node setup/scrub-creds.js` before committing.
4. **Deploy agent:** ensure a target for the site exists in `deploy-agent/deploy.config.json`
   and run `npm run serve` (reachable at `host.docker.internal:7331`).
5. **Frontend:** set `VITE_AUTOPILOT_WEBHOOK`, `npm run build`. The "🚀 Autopilot" tab in the
   New Request modal takes a single keyword.

### Run it

```bash
curl -X POST http://localhost:5678/webhook/seo-autopilot \
  -H 'Content-Type: application/json' \
  -d '{ "keyword": "micro influencer marketing", "website_slug": "grynow" }'
```

Watch `content_requests.status` walk to `published`; the live URL lands in
`content_versions.published_url` and in the target GitHub repo's `blog/`.

---

## Extending it (adding an agent)

The pipeline is a linear chain of code nodes with a JSON hand-off. To add an agent:

1. Add a code node between two existing nodes; read `$json`, return `{ ...$json, <new fields> }`.
2. If it needs persistence, add a JSONB column + (optionally) a `status` value in the schema
   migration block.
3. Add the prompt to `prompts/`.

The **Thumbnail Agent stub is the reference example**: a fixed I/O contract with a swappable
body. Replacing it later requires touching one node and nothing else.

## Adding a website

Same as the existing pipeline: a `websites` row + `<SLUG>_WEBSITE_ID` in `.env` +
`VITE_<SLUG>_ID` in the frontend + a `deploy-agent` target named `<slug>`. The autopilot
`SITE_MAP` and the frontend `SITES` both resolve sites by slug.
