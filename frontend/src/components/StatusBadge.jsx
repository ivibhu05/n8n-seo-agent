import { STATUS } from "../config";

export default function StatusBadge({ status }) {
  const s = STATUS[status] || {
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-600",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
