const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "../.env");
const WF_DIR = path.join(__dirname, "../workflows");

const env = {};
fs.readFileSync(ENV_PATH, "utf8")
  .split("\n")
  .forEach((line) => {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m) env[m[1].trim()] = m[2].replace(/\s+#.*$/, "").trim();
  });

const REPLACEMENTS = [
  { find: /YOUR_ANTHROPIC_API_KEY/g, replace: env.ANTHROPIC_API_KEY },
  { find: /YOUR_SUPABASE_SERVICE_KEY/g, replace: env.SUPABASE_SERVICE_KEY },
  { find: /YOUR_SUPABASE_URL/g, replace: env.SUPABASE_URL },
  { find: /YOUR_GRYNOW_WEBSITE_ID/g, replace: env.GRYNOW_WEBSITE_ID },
  { find: /YOUR_MYWALL_WEBSITE_ID/g, replace: env.MYWALL_WEBSITE_ID },
];

for (const file of fs.readdirSync(WF_DIR).filter((f) => f.endsWith(".json"))) {
  const fp = path.join(WF_DIR, file);
  let raw = fs.readFileSync(fp, "utf8");
  for (const { find, replace } of REPLACEMENTS)
    raw = raw.replace(find, replace);
  fs.writeFileSync(fp, raw);
  console.log(`Restored: ${file}`);
}
