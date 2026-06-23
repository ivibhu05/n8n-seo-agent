#!/bin/bash
# Quick pipeline test — creates a real DB record and fires the pipeline

set -a && source .env && set +a

N8N_PIPELINE="http://localhost:5678/webhook/seo-pipeline"

# Get latest pending request or create one
REQUEST_ID=$(curl -s \
  "${SUPABASE_URL}/rest/v1/content_requests?select=id&status=eq.pending&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

if [ -z "$REQUEST_ID" ]; then
  echo "Creating new content request..."
  REQUEST_ID=$(curl -s -X POST \
    "${SUPABASE_URL}/rest/v1/content_requests" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{\"website_id\":\"${GRYNOW_WEBSITE_ID}\",\"placement\":\"off-page\",\"content_type\":\"blog\",\"topic\":\"Why influencer marketing is important in 2026\",\"keywords\":[\"influencer marketing\",\"creator economy\",\"brand collaborations\"],\"status\":\"pending\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
fi

echo "Request ID: $REQUEST_ID"
echo "Firing pipeline..."

curl -s -X POST "$N8N_PIPELINE" \
  -H "Content-Type: application/json" \
  -d "{
    \"request_id\": \"$REQUEST_ID\",
    \"website_slug\": \"grynow\",
    \"website_name\": \"GryNow\",
    \"website_url\": \"https://grynow.in\",
    \"placement\": \"off-page\",
    \"content_type\": \"blog\",
    \"topic\": \"Why influencer marketing is important in 2026\",
    \"keywords\": [\"influencer marketing\", \"creator economy\", \"brand collaborations\"],
    \"keywords_raw\": \"influencer marketing, creator economy, brand collaborations\",
    \"layout_notes\": \"Hook, key stats, types of influencers, ROI comparison, CTA\",
    \"additional_brief\": \"Target: brand managers at D2C companies in India. Off-page tone.\"
  }"

echo ""
echo "Pipeline triggered. Watch the frontend or Supabase for status updates."
