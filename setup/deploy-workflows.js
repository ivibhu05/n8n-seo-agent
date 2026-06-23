/**
 * Deploys all 6 workflow JSONs to a running n8n instance via REST API.
 * Creates workflows that don't exist yet, updates ones that do.
 * Activates all of them in the correct order (06 → 01).
 *
 * Usage:
 *   node setup/deploy-workflows.js          # deploy + activate all
 *   node setup/deploy-workflows.js --dry    # show what would happen, no changes
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});
const fs = require("fs");
const path = require("path");
const http = require("http");

const N8N_HOST = process.env.N8N_HOST || "http://localhost:5678";
const API_KEY = process.env.N8N_API_KEY;
const WF_DIR = path.join(__dirname, "../workflows");
const DRY_RUN = process.argv.includes("--dry");

if (!API_KEY) {
  console.error("N8N_API_KEY not set in .env");
  console.error("Create one at: n8n → Settings → n8n API → Create API Key");
  process.exit(1);
}

// Activation order: downstream first
const WORKFLOW_FILES = ["03-review.json", "02-memory.json", "01-pipeline.json"];

async function api(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_HOST + "/api/v1" + endpoint);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port || 5678,
      path: url.pathname + url.search,
      method,
      headers: {
        "X-N8N-API-KEY": API_KEY,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getExistingWorkflows() {
  const res = await api("GET", "/workflows?limit=100");
  if (res.status !== 200)
    throw new Error("Failed to list workflows: " + JSON.stringify(res.body));
  return res.body.data || [];
}

async function deploy() {
  console.log(`\nn8n deploy → ${N8N_HOST}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  const existing = await getExistingWorkflows();
  const byName = Object.fromEntries(existing.map((w) => [w.name, w]));

  for (const file of WORKFLOW_FILES) {
    const filePath = path.join(WF_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP  ${file} (not found)`);
      continue;
    }

    const local = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const name = local.name;
    const found = byName[name];

    if (DRY_RUN) {
      console.log(`  ${found ? "UPDATE" : "CREATE"} "${name}"`);
      continue;
    }

    let res;
    // Strip all read-only fields the API rejects
    const { id: _id, active: _active, tags: _tags, ...payload } = local;

    if (found) {
      await api("POST", `/workflows/${found.id}/deactivate`);
      res = await api("PUT", `/workflows/${found.id}`, payload);
      console.log(`  UPDATE "${name}" (id ${found.id}) → HTTP ${res.status}`);
    } else {
      res = await api("POST", "/workflows", payload);
      console.log(`  CREATE "${name}" → HTTP ${res.status}`);
    }

    if (res.status >= 400) {
      console.error("    ERROR:", JSON.stringify(res.body).substring(0, 200));
      continue;
    }

    // Activate
    const id = res.body.id || found?.id;
    if (id) {
      const act = await api("POST", `/workflows/${id}/activate`);
      console.log(`  ACTIVATE id ${id} → HTTP ${act.status}`);
    }

    // Small delay to avoid race conditions on webhook registration
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("\nDone.\n");
}

deploy().catch((err) => {
  console.error(err);
  process.exit(1);
});
