// Client-only canvas — imported lazily to avoid SSR duplicate-React errors.
import { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { NODE_TYPE_COLORS } from '~/components/KnowledgeGraph';

export type CanvasGraphData = {
  nodes: Array<{ id: string; label: string; type: string; value: number }>;
  links: Array<{ source: string; target: string; relation: string }>;
};

type HoveredLink = { relation: string; x: number; y: number } | null;

export function KnowledgeGraphCanvas({
  graphData,
  selectedNodeId,
  onNodeClick,
  jumpToNodeId,
  onJumpConsumed,
}: {
  graphData: CanvasGraphData;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string, label: string, type: string, memCount: number) => void;
  jumpToNodeId: string | null;
  onJumpConsumed: () => void;
}) {
  const fgRef = useRef<any>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<HoveredLink>(null);

  // Compute neighbor sets for the selected node
  const neighborIds = new Set<string>();
  const neighborLinkIds = new Set<string>();
  if (selectedNodeId) {
    for (const link of graphData.links) {
      const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      if (srcId === selectedNodeId || tgtId === selectedNodeId) {
        neighborIds.add(srcId);
        neighborIds.add(tgtId);
        neighborLinkIds.add(`${srcId}__${tgtId}`);
      }
    }
  }
  const hasSelection = !!selectedNodeId;

  const handleNodeClick = useCallback(
    (node: any) => {
      if (!node) return;
      onNodeClick(node.id, node.label ?? '', node.type ?? 'other', node.value ?? 0);
    },
    [onNodeClick]
  );

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNodeId(node?.id ?? null);
  }, []);

  const handleLinkHover = useCallback((link: any, prevLink: any) => {
    if (!link) { setHoveredLink(null); return; }
    // Position the tooltip near the midpoint — actual coords injected in linkCanvasObject
    setHoveredLink({ relation: link.relation ?? '', x: 0, y: 0 });
  }, []);

  // Jump to node when jumpToNodeId changes
  useEffect(() => {
    if (!jumpToNodeId || !fgRef.current) return;
    const node = graphData.nodes.find((n) => n.id === jumpToNodeId);
    if (node) {
      const nodeObj = fgRef.current.getGraphData?.()?.nodes?.find?.((n: any) => n.id === jumpToNodeId);
      if (nodeObj?.x != null && nodeObj?.y != null) {
        fgRef.current.centerAt(nodeObj.x, nodeObj.y, 600);
        fgRef.current.zoom(2.5, 600);
      }
    }
    onJumpConsumed();
  }, [jumpToNodeId, graphData.nodes, onJumpConsumed]);

  const enriched = {
    nodes: graphData.nodes.map((n) => ({
      ...n,
      color: NODE_TYPE_COLORS[n.type] ?? NODE_TYPE_COLORS.other,
    })),
    links: graphData.links,
  };

  return (
    <div className="h-full w-full relative">
      <ForceGraph2D
        ref={fgRef}
        graphData={enriched}
        nodeLabel={(n: any) => ''}
        nodeColor={(n: any) => n?.color ?? NODE_TYPE_COLORS.other}
        nodeVal={(n: any) => n?.value ?? 1}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          if (!node) return;
          const isSelected = node.id === selectedNodeId;
          const isNeighbor = neighborIds.has(node.id);
          const isHovered = node.id === hoveredNodeId;
          const dimmed = hasSelection && !isSelected && !isNeighbor;

          const size = Math.max(3, Math.sqrt((node.value ?? 1) * 4));
          const alpha = dimmed ? 0.15 : 1;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = node.color ?? NODE_TYPE_COLORS.other;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
          ctx.fill();

          // Gold ring for selected node
          if (isSelected) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5 / globalScale;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, size + 3, 0, 2 * Math.PI);
            ctx.stroke();
          }

          // Subtle ring for neighbors
          if (isNeighbor && !isSelected) {
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1 / globalScale;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
            ctx.stroke();
          }

          // Hover glow
          if (isHovered && !isSelected) {
            ctx.globalAlpha = 0.4;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5 / globalScale;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, size + 1.5, 0, 2 * Math.PI);
            ctx.stroke();
          }

          // Label — always show for selected/neighbor, show on zoom otherwise
          const showLabel = isSelected || isNeighbor || globalScale > 1.8 || isHovered;
          if (showLabel && node.label) {
            ctx.globalAlpha = dimmed ? 0.15 : 1;
            const fontSize = Math.max(2, 11 / globalScale);
            ctx.font = `${isSelected ? 'bold ' : ''}${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            // Small shadow for readability
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillText(node.label, (node.x ?? 0) + 0.5, (node.y ?? 0) + size + 1.5);
            ctx.fillStyle = '#fff';
            ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + size + 1);
          }

          ctx.globalAlpha = 1;
        }}
        linkCanvasObject={(link: any, ctx, globalScale) => {
          const s = link.source;
          const t = link.target;
          if (!s || !t || s.x == null || t.x == null) return;

          const srcId = typeof s === 'object' ? s.id : s;
          const tgtId = typeof t === 'object' ? t.id : t;
          const isNeighborLink = neighborLinkIds.has(`${srcId}__${tgtId}`);
          const dimmed = hasSelection && !isNeighborLink;

          ctx.globalAlpha = dimmed ? 0.05 : isNeighborLink ? 0.8 : 0.25;
          ctx.strokeStyle = isNeighborLink ? '#fbbf24' : 'rgba(100,116,139,1)';
          ctx.lineWidth = (isNeighborLink ? 1.5 : 1) / globalScale;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();

          // Relation label on highlighted edges at sufficient zoom
          if (isNeighborLink && link.relation && globalScale > 1.2) {
            const mx = (s.x + t.x) / 2;
            const my = (s.y + t.y) / 2;
            const fontSize = Math.max(1.5, 9 / globalScale);
            ctx.globalAlpha = 0.9;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillText(link.relation, mx + 0.3, my + 0.3);
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(link.relation, mx, my);
          }

          ctx.globalAlpha = 1;
        }}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkHover={handleLinkHover}
        cooldownTicks={200}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        width={undefined}
        height={undefined}
      />
    </div>
  );
}
