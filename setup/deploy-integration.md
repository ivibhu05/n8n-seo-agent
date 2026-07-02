# Deploy Integration — n8n Content Writer → Content Deploy Agent

When a content version is **approved** in the Review Handler, n8n fetches the
approved markdown + the request's website slug and `POST`s it to the
**content-deploy-agent** webhook, which renders style-matched HTML/Next and
commits it live to that site's GitHub repo.

```
Form → 01 Pipeline (writes content_versions.content_markdown)
     → Review → [approve] → 03 Review Handler
                          → Approve: Deploy  ──POST /deploy──▶  deploy-agent
                                                                 (renders + commits to GitHub)
```

The **website slug = the deploy-agent target name**. n8n only sends
`{ target: <slug>, markdown }`; the deploy agent owns each site's repo, token,
and style reference in its `deploy.config.json`, so GitHub tokens never touch n8n.

## One-time wiring (already done in code)

- `deploy-agent/deploy.config.json` — `igygrow` target (repo `GrynowDev/igygrow.com`,
  `blog/` prefix, `tokenEnv: IGYGROW_GITHUB_TOKEN`, pinned `referencePath`).
- `03-review.json` — `Approve: Deploy` node + `DEPLOY_WEBHOOK_URL`/`DEPLOY_TOKEN`
  in the Config node.
- Pipeline/frontend/crawler now resolve websites from a map (N-site ready);
  igygrow added everywhere.

## Manual steps to go live for igygrow

### 1. Supabase — create the website row, grab its id

```sql
INSERT INTO websites (slug, name, url)
VALUES ('igygrow', 'Igygrow', 'https://www.igygrow.com')
ON CONFLICT (slug) DO NOTHING;

SELECT id, slug FROM websites;   -- copy the igygrow UUID
```

### 2. n8n `.env` (this repo) — add:

```
IGYGROW_WEBSITE_ID=<uuid from step 1>
DEPLOY_WEBHOOK_URL=http://host.docker.internal:7331/deploy
DEPLOY_TOKEN=<the deploy-agent's DEPLOY_TOKEN>
```

`DEPLOY_TOKEN` must equal `DEPLOY_TOKEN` in `deploy-agent/.env`.

### 3. frontend `.env` — add `VITE_IGYGROW_ID=<uuid>`, then rebuild:

```
cd frontend && npm run build
```

### 4. Crawl igygrow into the knowledge base (writer context)

```
cd setup/crawler && node distill-site.js --site igygrow
# optional: fill knowledge-base/igygrow/*.md then:
node seed-knowledge-base.js --site igygrow
```

### 5. Push workflows to n8n + restart with new env

```
node setup/restore-creds.js          # injects real values into workflow JSON
node setup/deploy-workflows.js        # update + activate workflows
docker compose up -d                  # restart n8n so new env vars load
node setup/scrub-creds.js             # BEFORE committing — strip secrets back out
```

### 6. Start the deploy agent (on this Mac, reachable at host.docker.internal:7331)

```
cd ../deploy-agent && npm run serve   # uses DEPLOY_TOKEN + IGYGROW_GITHUB_TOKEN
```

### 7. End-to-end test

Create a request in the form for **igygrow.com** → let it draft → **Approve** in
review → confirm a new file lands in `GrynowDev/igygrow.com/blog/`.

## Adding the next website later

1. `websites` row (slug) + `<SLUG>_WEBSITE_ID` in `.env` + `VITE_<SLUG>_ID` in frontend `.env`.
2. Add the site to `frontend/src/config.js` `SITES`, the pipeline/memory Config maps,
   and `setup/crawler/*` `SITES`.
3. Add a target named `<slug>` to `deploy-agent/deploy.config.json` (+ its `tokenEnv`).
4. Crawl, restore-creds, deploy-workflows. Done.
