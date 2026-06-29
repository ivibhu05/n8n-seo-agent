export const CFG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_KEY: import.meta.env.VITE_SUPABASE_KEY,
  GRYNOW_ID: import.meta.env.VITE_GRYNOW_ID,
  MYWALL_ID: import.meta.env.VITE_MYWALL_ID,
  IGYGROW_ID: import.meta.env.VITE_IGYGROW_ID,
  PIPELINE_WEBHOOK: import.meta.env.VITE_PIPELINE_WEBHOOK,
  MEMORY_WEBHOOK: import.meta.env.VITE_MEMORY_WEBHOOK,
  REVIEW_WEBHOOK: import.meta.env.VITE_REVIEW_WEBHOOK,
};

// Single source of truth for selectable websites. Add a site here (+ its
// VITE_<SLUG>_ID env var and a `websites` row) to offer it in the form.
export const SITES = {
  grynow: {
    id: import.meta.env.VITE_GRYNOW_ID,
    name: "GryNow",
    url: "https://grynow.in",
    label: "grynow.in",
  },
  mywall: {
    id: import.meta.env.VITE_MYWALL_ID,
    name: "MyWall",
    url: "https://mywall.me",
    label: "mywall.me",
  },
  igygrow: {
    id: import.meta.env.VITE_IGYGROW_ID,
    name: "Igygrow",
    url: "https://www.igygrow.com",
    label: "igygrow.com",
  },
};

export const STATUS = {
  pending: {
    label: "Pending",
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-600",
  },
  researching: {
    label: "Researching",
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700",
  },
  strategizing: {
    label: "Planning",
    dot: "bg-indigo-500",
    badge: "bg-indigo-50 text-indigo-700",
  },
  drafting: {
    label: "Drafting",
    dot: "bg-purple-500",
    badge: "bg-purple-50 text-purple-700",
  },
  review: {
    label: "Needs Review",
    dot: "bg-yellow-500",
    badge: "bg-yellow-50 text-yellow-800",
  },
  rework: {
    label: "Rework",
    dot: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700",
  },
  approved: {
    label: "Approved",
    dot: "bg-green-500",
    badge: "bg-green-50 text-green-700",
  },
};

export const SITE_NAMES = {
  grynow: "grynow.in",
  mywall: "mywall.me",
  igygrow: "igygrow.com",
};
export const PIPELINE_STAGES = [
  "researching",
  "strategizing",
  "drafting",
  "review",
  "approved",
];
