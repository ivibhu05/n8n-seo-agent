const fs = require("fs");
const path = require("path");

const WF_DIR = path.join(__dirname, "../workflows");

// Read .env so secrets added later (igygrow's UUID, the deploy token) can be
// scrubbed by their actual value without hardcoding them here.
const env = {};
try {
  fs.readFileSync(path.join(__dirname, "../.env"), "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.+)$/);
      if (m) env[m[1].trim()] = m[2].replace(/\s+#.*$/, "").trim();
    });
} catch {}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REPLACEMENTS = [
  { find: /sk-ant-api03-[A-Za-z0-9_\-]+/g, replace: "YOUR_ANTHROPIC_API_KEY" },
  {
    find: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
    replace: "YOUR_SUPABASE_SERVICE_KEY",
  },
  {
    find: /https:\/\/mxqwdhlsefgomxxcnkyl\.supabase\.co/g,
    replace: "YOUR_SUPABASE_URL",
  },
  {
    find: /18c17c9a-a46d-4b28-9077-c2fb75afcd1c/g,
    replace: "YOUR_GRYNOW_WEBSITE_ID",
  },
  {
    find: /31e5e87f-9495-41b0-b52f-76a7dc99acb1/g,
    replace: "YOUR_MYWALL_WEBSITE_ID",
  },
  // Deploy token: scrub the configured value, plus any token of the dpl_ shape.
  { find: /dpl_[A-Za-z0-9]{16,}/g, replace: "YOUR_DEPLOY_TOKEN" },
  env.IGYGROW_WEBSITE_ID && {
    find: new RegExp(escapeRe(env.IGYGROW_WEBSITE_ID), "g"),
    replace: "YOUR_IGYGROW_WEBSITE_ID",
  },
  env.DEPLOY_TOKEN && {
    find: new RegExp(escapeRe(env.DEPLOY_TOKEN), "g"),
    replace: "YOUR_DEPLOY_TOKEN",
  },
  env.SERPER_API_KEY && {
    find: new RegExp(escapeRe(env.SERPER_API_KEY), "g"),
    replace: "YOUR_SERPER_API_KEY",
  },
].filter(Boolean);

for (const file of fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".json"))) {
  const fp = path.join(WF_DIR, file);
  let raw = fs.readFileSync(fp, "utf8");
  let changed = false;
  for (const { find, replace } of REPLACEMENTS) {
    const next = raw.replace(find, replace);
    if (next !== raw) {
      raw = next;
      changed = true;
    }
  }
  fs.writeFileSync(fp, raw);
  console.log(changed ? `Scrubbed: ${file}` : `Clean:    ${file}`);
}
