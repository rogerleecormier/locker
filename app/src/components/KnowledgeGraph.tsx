import { useState, useCallback, lazy, Suspense, useEffect, useRef } from 'react';
import type { MemoryGraph, GraphMemorySnippet } from '~/server/memory/graph';

const KnowledgeGraphCanvas = lazy(() =>
  import('~/components/KnowledgeGraphCanvas').then((m) => ({ default: m.KnowledgeGraphCanvas }))
);

export const NODE_TYPE_COLORS: Record<string, string> = {
  service: '#3b82f6',
  file: '#22c55e',
  concept: '#a855f7',
  library: '#f59e0b',
  person: '#ec4899',
  api: '#06b6d4',
  database: '#6366f1',
  config: '#f97316',
  other: '#64748b',
};

const NODE_TYPE_LABELS: Record<string, string> = {
  service: 'Service',
  file: 'File',
  concept: 'Concept',
  library: 'Library',
  person: 'Person',
  api: 'API',
  database: 'Database',
  config: 'Config',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  rules: '#f59e0b',
  projects: '#3b82f6',
  references: '#a855f7',
  configs: '#22c55e',
};

type SelectedNode = {
  id: string;
  label: string;
  type: string;
  memoryCount: number;
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function KnowledgeGraph({
  graph,
  isLoading,
  onNodeClick,
  selectedNodeId,
  fetchMemoriesByIds,
}: {
  graph: MemoryGraph | null;
  isLoading: boolean;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
  fetchMemoriesByIds: (ids: string[]) => Promise<GraphMemorySnippet[]>;
}) {
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMemories, setDrawerMemories] = useState<GraphMemorySnippet[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [highlightedMemoryId, setHighlightedMemoryId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Compute top-5 most connected nodes
  const topNodes = graph
    ? [...graph.nodes]
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    : [];

  // Invert nodeMemories (nodeId -> memoryIds) so a clicked memory can highlight
  // every node it touches, not just the one whose drawer is currently open.
  const memoryToNodeIds = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!graph) return map;
    for (const [nodeId, memIds] of Object.entries(graph.nodeMemories)) {
      for (const memId of memIds) {
        const list = map.get(memId);
        if (list) list.push(nodeId);
        else map.set(memId, [nodeId]);
      }
    }
    return map;
  }, [graph]);

  const highlightedNodeIds = useMemo(
    () => (highlightedMemoryId ? new Set(memoryToNodeIds.get(highlightedMemoryId) ?? []) : new Set<string>()),
    [highlightedMemoryId, memoryToNodeIds]
  );

  const handleNodeClick = useCallback(
    async (id: string, label: string, type: string, _value: number) => {
      const memCount = graph?.nodeMemories[id]?.length ?? 0;
      setSelectedNode({ id, label, type, memoryCount: memCount });
      setDrawerOpen(true);
      setDrawerMemories([]);
      setHighlightedMemoryId(null);
      onNodeClick(id);

      const memIds = graph?.nodeMemories[id] ?? [];
      if (memIds.length > 0) {
        setDrawerLoading(true);
        try {
          const snippets = await fetchMemoriesByIds(memIds);
          setDrawerMemories(snippets);
        } finally {
          setDrawerLoading(false);
        }
      }
    },
    [graph, onNodeClick, fetchMemoriesByIds]
  );

  const toggleTypeFilter = useCallback((type: string) => {
    setActiveTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Search: find matching node and signal canvas to jump to it
  const handleSearch = useCallback(() => {
    if (!graph || !searchQuery.trim()) return;
    const q = searchQuery.toLowerCase();
    const match = graph.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (match) setJumpTarget(match.id);
  }, [graph, searchQuery]);

  // Reset jump target after canvas has consumed it
  const handleJumpConsumed = useCallback(() => setJumpTarget(null), []);

  // Filter graph data by active type filters
  const filteredGraph = graph
    ? {
        nodes: activeTypeFilters.size === 0
          ? graph.nodes
          : graph.nodes.filter((n) => !activeTypeFilters.has(n.type)),
        links: (activeTypeFilters.size === 0
          ? graph.edges
          : graph.edges.filter((e) => {
              const srcNode = graph.nodes.find((n) => n.id === e.source);
              const tgtNode = graph.nodes.find((n) => n.id === e.target);
              return srcNode && !activeTypeFilters.has(srcNode.type) &&
                     tgtNode && !activeTypeFilters.has(tgtNode.type);
            })
        ).map((e) => ({ source: e.source, target: e.target, relation: e.relation })),
      }
    : { nodes: [], links: [] };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[680px] bg-surface border border-border rounded-xl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-muted font-medium">Loading knowledge graph…</span>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[680px] bg-surface border border-border rounded-xl">
        <div className="text-center">
          <p className="text-text-muted text-sm font-medium">No knowledge graph data yet</p>
          <p className="text-[10px] text-text-muted/70 mt-1">
            Memories with named entities will appear here once the AI extracts them.
          </p>
        </div>
      </div>
    );
  }

  const edgeCount = graph.edges.length;
  const nodeCount = graph.nodes.length;

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface2 flex flex-col" style={{ height: 660 }}>
      {/* Toolbar — fixed height, no wrapping, no reflow */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-surface shrink-0 overflow-hidden">
        {/* Stats */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-text tabular-nums">{nodeCount}</span>
            <span className="text-[10px] text-text-muted uppercase tracking-wider">entities</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-text tabular-nums">{edgeCount}</span>
            <span className="text-[10px] text-text-muted uppercase tracking-wider">relations</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <span className="text-[10px] text-text-muted">{formatRelativeTime(graph.fetchedAt)}</span>
        </div>

        <div className="w-px h-3 bg-border shrink-0" />

        {/* Search */}
        <div className="flex items-center gap-1.5 bg-surface2 border border-border rounded-lg px-2 py-1 shrink-0 w-36">
          <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Find entity…"
            className="bg-transparent text-xs text-text placeholder:text-text-muted/60 outline-none w-full"
          />
        </div>

        <div className="w-px h-3 bg-border shrink-0" />

        {/* Type filter chips — no-wrap, scroll if needed */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1">
          {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => {
            const hidden = activeTypeFilters.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleTypeFilter(type)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium shrink-0 transition-colors ${
                  hidden
                    ? 'border-border/40 bg-transparent text-text-muted/40'
                    : 'border-border bg-surface text-text hover:border-accent/40'
                }`}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: hidden ? '#64748b40' : NODE_TYPE_COLORS[type] }}
                />
                {label}
              </button>
            );
          })}
        </div>

        {/* Top nodes */}
        {topNodes.length > 0 && (
          <>
            <div className="w-px h-3 bg-border shrink-0" />
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              <span className="text-[10px] text-text-muted uppercase tracking-wider shrink-0">Top</span>
              {topNodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    setSearchQuery(n.label);
                    setJumpTarget(n.id);
                    handleNodeClick(n.id, n.label, n.type, n.value);
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface2 border border-border hover:border-accent/40 transition-colors shrink-0"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: NODE_TYPE_COLORS[n.type] ?? '#64748b' }}
                  />
                  <span className="text-[10px] text-text truncate max-w-[72px]">{n.label}</span>
                  <span className="text-[9px] text-text-muted tabular-nums">{n.value - 1}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Graph canvas + drawer — takes remaining height */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas — flex-1 so it fills remaining width; ResizeObserver in canvas handles reflow */}
        <div className="relative flex-1 min-w-0">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <div className="w-6 h-6 border-4 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <KnowledgeGraphCanvas
              graphData={filteredGraph}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
              jumpToNodeId={jumpTarget}
              onJumpConsumed={handleJumpConsumed}
              highlightedNodeIds={highlightedNodeIds}
            />
          </Suspense>
        </div>

        {/* Slide-out drawer — flex sibling so canvas ResizeObserver picks up the resize */}
        <div
          className={`flex flex-col border-l border-border bg-surface overflow-hidden transition-all duration-300 ${
            drawerOpen ? 'w-[320px]' : 'w-0'
          }`}
        >
          {/* Inner wrapper keeps content at full width during animation */}
          <div className="flex flex-col h-full w-[320px]">
          {/* Drawer header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
            {selectedNode ? (
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: NODE_TYPE_COLORS[selectedNode.type] ?? '#64748b' }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text truncate">{selectedNode.label}</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">
                    {NODE_TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                    {' · '}
                    {selectedNode.memoryCount} {selectedNode.memoryCount === 1 ? 'memory' : 'memories'}
                  </p>
                </div>
              </div>
            ) : (
              <span className="text-sm text-text-muted">Node details</span>
            )}
            <button
              type="button"
              onClick={() => { setDrawerOpen(false); setSelectedNode(null); setHighlightedMemoryId(null); onNodeClick(''); }}
              className="text-text-muted hover:text-text transition-colors shrink-0 p-1 rounded hover:bg-surface2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Drawer body */}
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {drawerLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-5 h-5 border-4 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : drawerMemories.length === 0 && !drawerLoading ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-xs text-text-muted text-center px-4">
                  {selectedNode?.memoryCount === 0
                    ? 'No memories reference this entity'
                    : 'Could not load memory content'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {drawerMemories.map((mem) => (
                  <button
                    key={mem.id}
                    type="button"
                    onClick={() => setHighlightedMemoryId((cur) => (cur === mem.id ? null : mem.id))}
                    className={`px-4 py-3 text-left w-full transition-colors ${
                      highlightedMemoryId === mem.id ? 'bg-accent/10' : 'hover:bg-surface2/60'
                    }`}
                  >
                    {/* Category + timestamp */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[mem.category] ?? '#64748b'}20`,
                          color: CATEGORY_COLORS[mem.category] ?? '#64748b',
                        }}
                      >
                        {mem.category}
                      </span>
                      <span className="text-[9px] text-text-muted tabular-nums shrink-0">
                        {formatRelativeTime(mem.timestamp)}
                      </span>
                    </div>
                    {/* Memory text */}
                    <p className="text-xs text-text leading-relaxed line-clamp-4">{mem.fact}</p>
                    {/* Tags */}
                    {mem.tags && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {mem.tags.split(',').filter(Boolean).map((tag) => (
                          <span
                            key={tag}
                            className="text-[9px] text-text-muted bg-surface border border-border rounded px-1.5 py-0.5"
                          >
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>{/* end inner wrapper */}
        </div>
      </div>
    </div>
  );
}
