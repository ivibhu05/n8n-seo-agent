import { useState } from "react";
import { sb } from "../lib/supabase";
import { CFG, SITE_NAMES } from "../config";

const INIT = {
  website: "grynow",
  placement: "off-page",
  contentType: "blog",
  topic: "",
  keywords: "",
  layoutNotes: "",
  brief: "",
};

export default function NewRequestModal({ onClose, onSubmitted }) {
  const [form, setForm] = useState(INIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit() {
    setError("");
    if (!form.topic.trim()) {
      setError("Topic is required.");
      return;
    }
    if (!form.keywords.trim()) {
      setError("Keywords are required.");
      return;
    }

    setLoading(true);
    try {
      const websiteId =
        form.website === "grynow" ? CFG.GRYNOW_ID : CFG.MYWALL_ID;
      const keywords = form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      const { data: rows, error: dbErr } = await sb
        .from("content_requests")
        .insert({
          website_id: websiteId,
          placement: form.placement,
          content_type: form.contentType,
          topic: form.topic.trim(),
          keywords,
          layout_notes: form.layoutNotes.trim(),
          additional_brief: form.brief.trim(),
          status: "pending",
        })
        .select("id")
        .single();
      if (dbErr) throw new Error(dbErr.message);

      await fetch(CFG.PIPELINE_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: rows.id,
          website_slug: form.website,
          website_name: form.website === "grynow" ? "GryNow" : "MyWall",
          website_url:
            form.website === "grynow"
              ? "https://grynow.in"
              : "https://mywall.me",
          placement: form.placement,
          content_type: form.contentType,
          topic: form.topic.trim(),
          keywords,
          keywords_raw: form.keywords,
          layout_notes: form.layoutNotes.trim(),
          additional_brief: form.brief.trim(),
        }),
      });

      await onSubmitted();
      onClose();
    } catch (e) {
      setError("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">
            New Content Request
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Website
              </label>
              <select
                value={form.website}
                onChange={set("website")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="grynow">grynow.in</option>
                <option value="mywall">mywall.me</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Placement
              </label>
              <select
                value={form.placement}
                onChange={set("placement")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="off-page">Off-Page</option>
                <option value="on-page">On-Page</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Type
              </label>
              <select
                value={form.contentType}
                onChange={set("contentType")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="blog">Blog</option>
                <option value="web-page">Web Page</option>
                <option value="listicle">Listicle</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Topic <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.topic}
              onChange={set("topic")}
              placeholder="e.g., Why influencer marketing is important in 2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Keywords <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">
                (comma-separated)
              </span>
            </label>
            <input
              type="text"
              value={form.keywords}
              onChange={set("keywords")}
              placeholder="influencer marketing, creator economy, brand deals"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Layout / Structure Notes{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={form.layoutNotes}
              onChange={set("layoutNotes")}
              rows={2}
              placeholder="e.g., Intro → Key Stats → Types of influencers → ROI → CTA"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Additional Brief{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={form.brief}
              onChange={set("brief")}
              rows={2}
              placeholder="Target audience, special requirements, tone notes…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className="flex-1 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{" "}
                  Starting pipeline…
                </>
              ) : (
                "Submit & Start Pipeline"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
