// Client-only canvas component — imported lazily to avoid SSR duplicate-React errors
// from react-force-graph-2d which bundles its own React copy.
import { useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

const NODE_TYPE_COLORS: Record<string, string> = {
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

export type CanvasGraphData = {
  nodes: Array<{ id: string; label: string; type: string; value: number }>;
  links: Array<{ source: string; target: string; relation: string }>;
};

export function KnowledgeGraphCanvas({
  graphData,
  selectedNodeId,
  onNodeClick,
}: {
  graphData: CanvasGraphData;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string, label: string, type: string, memCount: number) => void;
}) {
  const fgRef = useRef<any>(null);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (!node) return;
      onNodeClick(node.id, node.label ?? '', node.type ?? 'other', node.value ?? 0);
    },
    [onNodeClick]
  );

  const enriched = {
    nodes: graphData.nodes.map((n) => ({ ...n, color: NODE_TYPE_COLORS[n.type] ?? NODE_TYPE_COLORS.other })),
    links: graphData.links,
  };

  return (
    <div className="flex gap-0 h-full w-full">
      <div className="flex-1 relative">
        <ForceGraph2D
          ref={fgRef}
          graphData={enriched}
          nodeLabel={(n: any) => n?.label ? `${n.label} (${NODE_TYPE_LABELS[n.type] ?? 'Other'})` : ''}
          nodeColor={(n: any) => n?.color ?? NODE_TYPE_COLORS.other}
          nodeVal={(n: any) => n?.value ?? 1}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            if (!node) return;
            const size = Math.max(3, Math.sqrt((node.value ?? 1) * 3));
            ctx.fillStyle = node.color ?? NODE_TYPE_COLORS.other;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
            ctx.fill();

            if (selectedNodeId === node.id) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 2 / globalScale;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
              ctx.stroke();
            }

            if (globalScale > 1.5 && node.label) {
              ctx.fillStyle = '#fff';
              ctx.font = `${Math.max(2, 12 / globalScale)}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(node.label, node.x ?? 0, node.y ?? 0);
            }
          }}
          linkCanvasObject={(link: any, ctx, globalScale) => {
            const s = link.source;
            const t = link.target;
            if (!s || !t) return;
            ctx.strokeStyle = 'rgba(100,116,139,0.3)';
            ctx.lineWidth = 1 / globalScale;
            ctx.beginPath();
            ctx.moveTo(s.x ?? 0, s.y ?? 0);
            ctx.lineTo(t.x ?? 0, t.y ?? 0);
            ctx.stroke();
          }}
          onNodeClick={handleNodeClick}
          cooldownTicks={200}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-surface/90 border border-border rounded-lg p-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_TYPE_COLORS[type] }} />
            <span className="text-[9px] text-text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
