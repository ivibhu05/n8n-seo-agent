import { useState, useMemo } from "react";
import { marked } from "marked";
import { sb } from "../lib/supabase";
import { CFG, SITE_NAMES } from "../config";
import StatusBadge from "./StatusBadge";

const TABS = [
  { key: "research", label: "Research Brief" },
  { key: "strategy", label: "Strategy Brief" },
  { key: "content", label: "Written Content" },
  { key: "review", label: "Review" },
];

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
      <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
    </div>
  );
}

function WaitingMsg({ msg }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400 text-sm text-center max-w-xs mx-auto">
      <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-4" />
      {msg}
    </div>
  );
}

function JSONView({ data }) {
  const text = JSON.stringify(data, null, 2);
  function copy() {
    navigator.clipboard.writeText(text);
  }
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={copy}
          className="text-xs text-blue-600 hover:underline"
        >
          Copy JSON
        </button>
      </div>
      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-4 overflow-auto whitespace-pre-wrap max-h-[60vh] scrollbar-thin">
        {text}
      </pre>
    </div>
  );
}

function ContentView({ version }) {
  const [view, setView] = useState("rendered");
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {["rendered", "raw"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                view === v
                  ? "bg-blue-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {v === "rendered" ? "Preview" : "Markdown"}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">
          {version.word_count
            ? version.word_count.toLocaleString() + " words"
            : ""}{" "}
          · v{version.version_number}
        </span>
      </div>

      {(version.meta_title || version.meta_description) && (
        <div className="border border-gray-200 rounded-lg p-3 mb-4 space-y-1.5 bg-blue-50/50">
          {version.meta_title && (
            <p className="text-xs">
              <span className="font-semibold text-blue-700">Meta Title:</span>{" "}
              {version.meta_title}
            </p>
          )}
          {version.meta_description && (
            <p className="text-xs">
              <span className="font-semibold text-gray-700">Meta Desc:</span>{" "}
              {version.meta_description}
            </p>
          )}
        </div>
      )}

      {view === "rendered" ? (
        <div
          className="prose-content text-sm leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: marked.parse(version.content_markdown || ""),
          }}
        />
      ) : (
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-4 overflow-auto whitespace-pre-wrap max-h-[60vh] scrollbar-thin">
          {version.content_markdown}
        </pre>
      )}
    </div>
  );
}

function ReviewPanel({ req, version, onRefresh, onClose }) {
  const [approver, setApprover] = useState("");
  const [reworker, setReworker] = useState("");
  const [feedback, setFeedback] = useState("");
  const [category, setCategory] = useState("tone");
  const [severity, setSeverity] = useState("minor");
  const [loading, setLoading] = useState(false);

  if (!version?.content_markdown) {
    return (
      <WaitingMsg msg="Content must be written before it can be reviewed." />
    );
  }

  if (version.status === "approved") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-5xl mb-4">✅</div>
        <p className="font-semibold text-green-700 text-lg">Approved</p>
        <p className="text-sm text-gray-500 mt-1">
          This version has been approved and archived.
        </p>
      </div>
    );
  }

  async function handleApprove() {
    setLoading(true);
    try {
      await sb.from("seo_feedback").insert({
        request_id: req.id,
        content_version_id: version.id,
        version_number: version.version_number,
        decision: "approve",
        reviewer_name: approver || "SEO Team",
      });
      await fetch(CFG.REVIEW_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          request_id: req.id,
          version_id: version.id,
        }),
      });
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleRework() {
    if (!feedback.trim()) {
      alert("Please provide feedback.");
      return;
    }
    setLoading(true);
    try {
      await sb.from("seo_feedback").insert({
        request_id: req.id,
        content_version_id: version.id,
        version_number: version.version_number,
        decision: "rework",
        feedback_text: feedback,
        category,
        severity,
        reviewer_name: reworker || "SEO Team",
      });
      await fetch(CFG.REVIEW_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "rework",
          request_id: req.id,
          version_id: version.id,
          feedback_text: feedback,
          category,
          severity,
        }),
      });
      await onRefresh();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <p className="text-sm text-gray-500">
        Review the <strong>Written Content</strong> tab before submitting.
      </p>

      {/* Approve */}
      <div className="border border-green-200 bg-green-50 rounded-xl p-5">
        <h3 className="font-semibold text-green-800 mb-3">Approve Content</h3>
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Your Name
          </label>
          <input
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="SEO Team"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>
        <button
          onClick={handleApprove}
          disabled={loading}
          className="bg-green-700 hover:bg-green-800 disabled:bg-green-400 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : null}
          Approve ✓
        </button>
      </div>

      {/* Rework */}
      <div className="border border-orange-200 bg-orange-50 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-orange-800">Request Rework</h3>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Your Name
          </label>
          <input
            value={reworker}
            onChange={(e) => setReworker(e.target.value)}
            placeholder="SEO Team"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Feedback <span className="text-red-500">*</span>
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="Describe specifically what needs to change…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {[
                "tone",
                "structure",
                "keywords",
                "facts",
                "length",
                "other",
              ].map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Severity
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="minor">Minor</option>
              <option value="major">Major</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleRework}
          disabled={loading}
          className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : null}
          Submit Rework Request
        </button>
      </div>
    </div>
  );
}

export default function PipelineModal({ req, onClose, onRefresh }) {
  const [activeTab, setActiveTab] = useState("research");

  const latestVersion = useMemo(() => {
    const versions = req.content_versions || [];
    return (
      versions.sort((a, b) => b.version_number - a.version_number)[0] || null
    );
  }, [req.content_versions]);

  const siteSlug = req.website?.slug || "";

  function renderTab() {
    switch (activeTab) {
      case "research":
        return req.research_brief ? (
          <JSONView data={req.research_brief} />
        ) : (
          <WaitingMsg msg="Research Agent is analysing SERP data, keywords, and topic depth…" />
        );

      case "strategy":
        return req.strategy_brief ? (
          <JSONView data={req.strategy_brief} />
        ) : req.research_brief ? (
          <WaitingMsg msg="Strategy Agent is making editorial decisions…" />
        ) : (
          <WaitingMsg msg="Waiting for research to complete first…" />
        );

      case "content":
        return latestVersion?.content_markdown ? (
          <ContentView version={latestVersion} />
        ) : req.strategy_brief ? (
          <WaitingMsg msg="Writer Agent is generating the content…" />
        ) : (
          <WaitingMsg msg="Waiting for strategy to complete first…" />
        );

      case "review":
        return (
          <ReviewPanel
            req={req}
            version={latestVersion}
            onRefresh={onRefresh}
            onClose={onClose}
          />
        );

      default:
        return null;
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col"
        style={{ height: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base text-gray-900 leading-snug truncate">
              {req.topic}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <StatusBadge status={req.status} />
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">
                {SITE_NAMES[siteSlug] || siteSlug}
              </span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{req.content_type}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{req.placement}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-gray-400 hover:text-gray-700 text-2xl leading-none shrink-0"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 shrink-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-sm px-4 py-3 whitespace-nowrap font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-700 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {tab.label}
              {tab.key === "review" && req.status === "review" && (
                <span className="ml-2 w-2 h-2 bg-yellow-500 rounded-full inline-block" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
