import { useMemo } from "react";
import StatusBadge from "./StatusBadge";
import { SITE_NAMES, PIPELINE_STAGES, STATUS } from "../config";

const STAGE_ORDER = [
  "pending",
  "researching",
  "strategizing",
  "drafting",
  "review",
  "rework",
  "approved",
];

export default function RequestCard({ req, onClick }) {
  const latestVersion = useMemo(() => {
    const versions = req.content_versions || [];
    return (
      versions.sort((a, b) => b.version_number - a.version_number)[0] || null
    );
  }, [req.content_versions]);

  const siteSlug = req.website?.slug || "";
  const siteLabel = SITE_NAMES[siteSlug] || siteSlug;
  const stageIdx = STAGE_ORDER.indexOf(req.status);

  return (
    <article
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <StatusBadge status={req.status} />
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500 font-medium">
              {siteLabel}
            </span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{req.content_type}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{req.placement}</span>
            {latestVersion?.word_count > 0 && (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">
                  {latestVersion.word_count.toLocaleString()} words
                </span>
              </>
            )}
          </div>

          <h3 className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-blue-700 transition-colors">
            {req.topic}
          </h3>

          {(req.keywords || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {req.keywords.slice(0, 5).map((k, i) => (
                <span
                  key={i}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                >
                  {k}
                </span>
              ))}
              {req.keywords.length > 5 && (
                <span className="text-xs text-gray-400">
                  +{req.keywords.length - 5}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-xs text-gray-400 mb-2">
            {new Date(req.created_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            })}
          </div>
          {req.status === "review" && (
            <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded-md font-medium">
              Review Ready
            </span>
          )}
          {latestVersion && (
            <div className="text-xs text-gray-400 mt-1">
              v{latestVersion.version_number}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline progress bar */}
      <div className="mt-4 flex gap-1.5 items-center">
        {PIPELINE_STAGES.map((stage, i) => {
          const sIdx = STAGE_ORDER.indexOf(stage);
          const done = stageIdx >= sIdx;
          const active = req.status === stage;
          return (
            <div
              key={stage}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div
                className={`h-1.5 w-full rounded-full transition-all ${
                  done ? "bg-blue-500" : "bg-gray-200"
                } ${active ? "animate-pulse" : ""}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex mt-1">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className="flex-1 text-center">
            <span className="text-[9px] text-gray-400 capitalize">
              {stage.replace("ing", "")}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
