const fs = require("fs");
const path = require("path");

const WF_DIR = path.join(__dirname, "../workflows");

const REPLACEMENTS = [
  { find: /sk-ant-api03-[A-Za-z0-9_\-]+/g, replace: "YOUR_ANTHROPIC_API_KEY" },
  {
    find: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
    replace: "YOUR_SUPABASE_SERVICE_KEY",
  },
  {
    find: /06d6458b4d4f74251c112c6469b39cb1197d6a4b/g,
    replace: "YOUR_SERPER_API_KEY",
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
];

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
