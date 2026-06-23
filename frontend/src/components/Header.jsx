export default function Header({ onNewRequest }) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold text-blue-700">
          SEO Content Writer
        </span>
        <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
          Agentic Pipeline
        </span>
      </div>
      <button
        onClick={onNewRequest}
        className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <span className="text-base leading-none">+</span>
        New Request
      </button>
    </header>
  );
}
