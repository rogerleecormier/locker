// Client-only canvas — imported lazily to avoid SSR duplicate-React errors.
import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { NODE_TYPE_COLORS } from '~/components/KnowledgeGraph';

export type CanvasGraphData = {
  nodes: Array<{ id: string; label: string; type: string; value: number }>;
  links: Array<{ source: string; target: string; relation: string }>;
};

export function KnowledgeGraphCanvas({
  graphData,
  selectedNodeId,
  onNodeClick,
  jumpToNodeId,
  onJumpConsumed,
  highlightedNodeIds,
}: {
  graphData: CanvasGraphData;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string, label: string, type: string, memCount: number) => void;
  jumpToNodeId: string | null;
  onJumpConsumed: () => void;
  highlightedNodeIds?: Set<string>;
}) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Use refs for hover state so canvas callbacks never trigger React re-renders
  const hoveredNodeIdRef = useRef<string | null>(null);

  // Track container size so the canvas resizes when the drawer slides in/out.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setDimensions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    setDimensions({ width: el.offsetWidth, height: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  // Precompute neighbor sets from selectedNodeId — only recompute when selection changes
  const { neighborIds, neighborLinkIds, hasSelection } = useMemo(() => {
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
    return { neighborIds, neighborLinkIds, hasSelection: !!selectedNodeId };
  }, [selectedNodeId, graphData.links]);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (!node) return;
      onNodeClick(node.id, node.label ?? '', node.type ?? 'other', node.value ?? 0);
    },
    [onNodeClick]
  );

  // Hover uses ref mutation — no setState, no re-render, no simulation reheat
  const handleNodeHover = useCallback((node: any) => {
    hoveredNodeIdRef.current = node?.id ?? null;
  }, []);

  // Jump to node
  useEffect(() => {
    if (!jumpToNodeId || !fgRef.current) return;
    const nodeObj = fgRef.current.getGraphData?.()?.nodes?.find?.((n: any) => n.id === jumpToNodeId);
    if (nodeObj?.x != null && nodeObj?.y != null) {
      fgRef.current.centerAt(nodeObj.x, nodeObj.y, 600);
      fgRef.current.zoom(2.5, 600);
    }
    onJumpConsumed();
  }, [jumpToNodeId, onJumpConsumed]);

  // When a memory is highlighted, its touched nodes may be far away (a disconnected
  // island) — pan/zoom to frame them so the highlight is actually visible.
  useEffect(() => {
    if (!highlightedNodeIds || highlightedNodeIds.size === 0 || !fgRef.current) return;
    const allNodes = fgRef.current.getGraphData?.()?.nodes ?? [];
    const targets = allNodes.filter((n: any) => highlightedNodeIds.has(n.id) && n.x != null && n.y != null);
    if (targets.length === 0) return;

    if (targets.length === 1) {
      fgRef.current.centerAt(targets[0].x, targets[0].y, 600);
      fgRef.current.zoom(2.5, 600);
      return;
    }

    const xs = targets.map((n: any) => n.x);
    const ys = targets.map((n: any) => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    fgRef.current.centerAt(cx, cy, 600);

    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const span = Math.max(spanX, spanY, 40);
    const targetZoom = Math.min(3, Math.max(0.5, (dimensions.width || 400) / (span * 2.2)));
    fgRef.current.zoom(targetZoom, 600);
  }, [highlightedNodeIds, dimensions.width]);

  const enriched = useMemo(() => ({
    nodes: graphData.nodes.map((n) => ({
      ...n,
      color: NODE_TYPE_COLORS[n.type] ?? NODE_TYPE_COLORS.other,
    })),
    links: graphData.links,
  }), [graphData]);

  // Stable canvas draw callbacks — capture refs, not state, so they never change identity
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    if (!node) return;
    const isSelected = node.id === selectedNodeId;
    const isNeighbor = neighborIds.has(node.id);
    const isHighlighted = !!highlightedNodeIds?.has(node.id);
    const isHovered = node.id === hoveredNodeIdRef.current;
    const dimmed = (hasSelection && !isSelected && !isNeighbor && !isHighlighted) ||
      (!!highlightedNodeIds && highlightedNodeIds.size > 0 && !isHighlighted && !isSelected);

    const size = Math.max(3, Math.sqrt((node.value ?? 1) * 4));

    ctx.globalAlpha = dimmed ? 0.15 : 1;
    ctx.fillStyle = node.color ?? NODE_TYPE_COLORS.other;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
    ctx.fill();

    // Gold ring for selected
    if (isSelected) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, size + 3, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Cyan ring for nodes touched by the currently-highlighted memory
    if (isHighlighted && !isSelected) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.5 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, size + 3, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Subtle ring for neighbors
    if (isNeighbor && !isSelected && !isHighlighted) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Hover glow — reads ref, no re-render needed
    if (isHovered && !isSelected) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / globalScale;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, size + 1.5, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Labels
    const showLabel = isSelected || isNeighbor || isHighlighted || globalScale > 1.8 || isHovered;
    if (showLabel && node.label) {
      ctx.globalAlpha = dimmed ? 0.15 : 1;
      const fontSize = Math.max(2, 11 / globalScale);
      ctx.font = `${isSelected ? 'bold ' : ''}${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(node.label, (node.x ?? 0) + 0.4, (node.y ?? 0) + size + 1.4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + size + 1);
    }

    ctx.globalAlpha = 1;
  }, [selectedNodeId, neighborIds, hasSelection, highlightedNodeIds]);

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
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
  }, [neighborLinkIds, hasSelection]);

  return (
    <div ref={containerRef} className="h-full w-full relative">
      <ForceGraph2D
        ref={fgRef}
        graphData={enriched}
        nodeLabel={() => ''}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={200}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        width={dimensions.width || undefined}
        height={dimensions.height || undefined}
      />
    </div>
  );
}
