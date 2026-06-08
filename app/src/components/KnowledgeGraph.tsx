import { useState, useCallback, lazy, Suspense } from 'react';
import type { MemoryGraph } from '~/server/memory/graph';

// Lazy-load the canvas component so react-force-graph-2d (which bundles its own
// React copy) is never imported during SSR — that would create a duplicate React
// instance and crash useContext / useRouter.
const KnowledgeGraphCanvas = lazy(() =>
  import('~/components/KnowledgeGraphCanvas').then((m) => ({ default: m.KnowledgeGraphCanvas }))
);

type SelectedNode = { id: string; label: string; type: string; memoryCount: number };

const NODE_TYPE_LABELS: Record<string, string> = {
  service: 'Service', file: 'File', concept: 'Concept', library: 'Library',
  person: 'Person', api: 'API', database: 'Database', config: 'Config', other: 'Other',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  service: '#3b82f6', file: '#22c55e', concept: '#a855f7', library: '#f59e0b',
  person: '#ec4899', api: '#06b6d4', database: '#6366f1', config: '#f97316', other: '#64748b',
};

export function KnowledgeGraph({
  graph,
  isLoading,
  onNodeClick,
  selectedNodeId,
}: {
  graph: MemoryGraph | null;
  isLoading: boolean;
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  const handleNodeClick = useCallback(
    (id: string, label: string, type: string, _value: number) => {
      setSelectedNode({
        id,
        label,
        type,
        memoryCount: graph?.nodeMemories[id]?.length ?? 0,
      });
      onNodeClick(id);
    },
    [graph, onNodeClick]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-surface border border-border rounded-xl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-text-muted font-medium">Loading knowledge graph…</span>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-surface border border-border rounded-xl">
        <div className="text-center">
          <p className="text-text-muted text-sm font-medium">No knowledge graph data yet</p>
          <p className="text-[10px] text-text-muted/70 mt-1">
            Memories with named entities will appear here once the AI extracts them.
          </p>
        </div>
      </div>
    );
  }

  const graphData = {
    nodes: graph.nodes,
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation })),
  };

  return (
    <div className="flex h-[600px] bg-surface border border-border rounded-xl overflow-hidden">
      {/* Canvas — lazy loaded, client only */}
      <div className="flex-1 relative bg-surface2">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          }
        >
          <KnowledgeGraphCanvas
            graphData={graphData}
            selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick}
          />
        </Suspense>
      </div>

      {/* Sidebar */}
      <div className="w-60 flex flex-col border-l border-border bg-surface shrink-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col gap-4">
          {selectedNode ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: NODE_TYPE_COLORS[selectedNode.type] ?? '#64748b' }}
                  />
                  <span className="text-[10px] font-bold uppercase text-text-muted tracking-wider">
                    {NODE_TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-text break-words">{selectedNode.label}</h3>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-accent/10 border border-accent/20 rounded-lg">
                  <span className="text-xs font-bold text-accent">
                    {selectedNode.memoryCount} {selectedNode.memoryCount === 1 ? 'memory' : 'memories'}
                  </span>
                </div>
              </div>
              <hr className="border-border/40" />
              {selectedNode.memoryCount > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold uppercase text-text-muted">Referenced Memories</span>
                  <div className="flex flex-col gap-1 max-h-96 overflow-y-auto no-scrollbar">
                    {graph.nodeMemories[selectedNode.id]?.map((memId) => (
                      <div
                        key={memId}
                        className="text-[10px] text-text-muted bg-surface2 border border-border rounded px-2 py-1.5 font-mono truncate hover:border-accent/30 transition-colors"
                        title={memId}
                      >
                        {memId.slice(0, 12)}…
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-text-muted text-center py-4">
              Click a node to see its referenced memories
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
