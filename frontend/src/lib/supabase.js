import { createClient } from "@supabase/supabase-js";
import { CFG } from "../config";

export const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);

export async function fetchRequests() {
  const { data, error } = await sb
    .from("content_requests")
    .select("*, website:websites(slug, name), content_versions(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
