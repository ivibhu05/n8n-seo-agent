import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchRequests } from "./lib/supabase";
import Header from "./components/Header";
import FilterBar from "./components/FilterBar";
import RequestCard from "./components/RequestCard";
import NewRequestModal from "./components/NewRequestModal";
import PipelineModal from "./components/PipelineModal";

const RUNNING = new Set(["researching", "strategizing", "drafting"]);

export default function App() {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchRequests();
      setRequests(data);
    } catch (e) {
      console.error("fetch error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "running")
      return requests.filter((r) => RUNNING.has(r.status));
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedId) || null,
    [requests, selectedId],
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header onNewRequest={() => setNewRequestOpen(true)} />
      <FilterBar filter={filter} setFilter={setFilter} requests={requests} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <div className="w-7 h-7 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <div className="text-5xl mb-4">📄</div>
            <p className="text-sm">
              No content requests yet. Click <strong>+ New Request</strong> to
              get started.
            </p>
          </div>
        ) : (
          visible.map((req) => (
            <RequestCard
              key={req.id}
              req={req}
              onClick={() => setSelectedId(req.id)}
            />
          ))
        )}
      </main>

      {newRequestOpen && (
        <NewRequestModal
          onClose={() => setNewRequestOpen(false)}
          onSubmitted={load}
        />
      )}

      {selectedId && selectedRequest && (
        <PipelineModal
          req={selectedRequest}
          onClose={() => setSelectedId(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}
