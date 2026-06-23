import { STATUS } from "../config";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "running", label: "In Progress" },
  { key: "review", label: "Needs Review" },
  { key: "approved", label: "Approved" },
  { key: "rework", label: "Rework" },
];

const RUNNING = new Set(["researching", "strategizing", "drafting"]);

function count(requests, key) {
  if (key === "all") return requests.length;
  if (key === "running")
    return requests.filter((r) => RUNNING.has(r.status)).length;
  return requests.filter((r) => r.status === key).length;
}

export default function FilterBar({ filter, setFilter, requests }) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 flex gap-1 overflow-x-auto sticky top-[57px] z-10">
      {FILTERS.map((f) => {
        const active = f.key === filter;
        const n = count(requests, f.key);
        return (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 text-sm px-3 py-3 whitespace-nowrap border-b-2 transition-colors ${
              active
                ? "border-blue-700 text-blue-700 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {f.label}
            {n > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  active
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
