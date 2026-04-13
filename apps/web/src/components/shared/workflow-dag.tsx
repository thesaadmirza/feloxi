"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import type { DagNode, DagEdge } from "@/types/api";
import { getStateColor, EDGE_TYPE_COLORS, DAG_LAYOUT } from "@/lib/constants";
import { formatDuration, truncateId, displayTaskName } from "@/lib/utils";

type LayoutNode = DagNode & {
  x: number;
  y: number;
  depth: number;
};

type Props = {
  nodes: DagNode[];
  edges: DagEdge[];
  rootId: string;
  currentTaskId?: string;
};

function buildAdjacency(nodes: DagNode[], edges: DagEdge[]) {
  const nodeMap = new Map<string, DagNode>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.task_id, node);
    children.set(node.task_id, []);
    parents.set(node.task_id, []);
  }

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      children.get(edge.source)!.push(edge.target);
      parents.get(edge.target)!.push(edge.source);
    }
  }

  return { nodeMap, children, parents };
}

function computeLayout(
  nodes: DagNode[],
  edges: DagEdge[],
  rootId: string
): LayoutNode[] {
  const { nodeMap, children, parents } = buildAdjacency(nodes, edges);
  const { nodeWidth, nodeHeight, horizontalGap, verticalGap } = DAG_LAYOUT;

  const visited = new Set<string>();
  const depthMap = new Map<string, number>();
  const depthBuckets = new Map<number, string[]>();

  const roots = nodes.filter(
    (n) => !parents.get(n.task_id)?.length || n.task_id === rootId
  );

  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  function assignDepths(taskId: string, depth: number) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    depthMap.set(taskId, depth);

    if (!depthBuckets.has(depth)) depthBuckets.set(depth, []);
    depthBuckets.get(depth)!.push(taskId);

    for (const childId of children.get(taskId) ?? []) {
      assignDepths(childId, depth + 1);
    }
  }

  for (const root of roots) {
    assignDepths(root.task_id, 0);
  }

  for (const node of nodes) {
    if (!visited.has(node.task_id)) {
      const maxDepth = Math.max(0, ...depthMap.values()) + 1;
      assignDepths(node.task_id, maxDepth);
    }
  }

  const result: LayoutNode[] = [];

  for (const [depth, ids] of depthBuckets.entries()) {
    ids.forEach((id, index) => {
      const node = nodeMap.get(id)!;
      result.push({
        ...node,
        x: depth * (nodeWidth + horizontalGap),
        y: index * (nodeHeight + verticalGap),
        depth,
      });
    });
  }

  return result;
}

function DagNodeCard({
  node,
  isCurrent,
}: {
  node: LayoutNode;
  isCurrent: boolean;
}) {
  const color = getStateColor(node.state);
  const { nodeWidth, nodeHeight } = DAG_LAYOUT;

  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <rect
        width={nodeWidth}
        height={nodeHeight}
        rx={10}
        ry={10}
        fill="var(--color-card)"
        stroke={isCurrent ? "var(--color-primary)" : color}
        strokeWidth={isCurrent ? 2.5 : 1.5}
        strokeDasharray={isCurrent ? "6 3" : "none"}
      />
      <rect
        x={0}
        y={0}
        width={6}
        height={nodeHeight}
        rx={3}
        ry={3}
        fill={color}
      />
      <Link href={`/tasks/${node.task_id}`}>
        <text
          x={16}
          y={22}
          fill="var(--color-foreground)"
          fontSize={12}
          fontWeight={600}
          className="cursor-pointer hover:underline"
        >
          <title>{displayTaskName(node.task_name)}</title>
          {(() => {
            const name = displayTaskName(node.task_name);
            return name.length > 40 ? `${name.slice(0, 40)}…` : name;
          })()}
        </text>
      </Link>
      <text
        x={16}
        y={40}
        fill="var(--color-muted-foreground)"
        fontSize={10}
        fontFamily="monospace"
      >
        <title>{node.task_id}</title>
        {truncateId(node.task_id, 24)}
      </text>
      <text x={16} y={58} fontSize={10}>
        <tspan fill={color} fontWeight={600}>
          {node.state}
        </tspan>
        {node.runtime != null && node.runtime > 0 && (
          <tspan fill="var(--color-muted-foreground)">
            {" "}
            · {formatDuration(node.runtime)}
          </tspan>
        )}
      </text>
      <text
        x={nodeWidth - 8}
        y={58}
        fill="var(--color-muted-foreground)"
        fontSize={9}
        textAnchor="end"
      >
        <title>Queue: {node.queue || "—"}</title>
        {node.queue}
      </text>
    </g>
  );
}

function DagEdgeLine({
  sourceNode,
  targetNode,
  edge,
}: {
  sourceNode: LayoutNode;
  targetNode: LayoutNode;
  edge: DagEdge;
}) {
  const { nodeWidth, nodeHeight } = DAG_LAYOUT;
  const color = EDGE_TYPE_COLORS[edge.edge_type] ?? "#6b7280";

  const x1 = sourceNode.x + nodeWidth;
  const y1 = sourceNode.y + nodeHeight / 2;
  const x2 = targetNode.x;
  const y2 = targetNode.y + nodeHeight / 2;

  const midX = (x1 + x2) / 2;

  return (
    <g>
      <path
        d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={edge.edge_type === "group" ? "4 4" : "none"}
        markerEnd={`url(#arrow-${edge.edge_type})`}
      />
    </g>
  );
}

export default function WorkflowDag({ nodes, edges, rootId, currentTaskId }: Props) {
  const [hoveredEdgeType, setHoveredEdgeType] = useState<string | null>(null);

  const layoutNodes = useMemo(
    () => computeLayout(nodes, edges, rootId),
    [nodes, edges, rootId]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    for (const n of layoutNodes) map.set(n.task_id, n);
    return map;
  }, [layoutNodes]);

  const { nodeWidth, nodeHeight } = DAG_LAYOUT;

  const svgWidth = useMemo(() => {
    if (layoutNodes.length === 0) return 400;
    return Math.max(...layoutNodes.map((n) => n.x)) + nodeWidth + 40;
  }, [layoutNodes, nodeWidth]);

  const svgHeight = useMemo(() => {
    if (layoutNodes.length === 0) return 200;
    return Math.max(...layoutNodes.map((n) => n.y)) + nodeHeight + 40;
  }, [layoutNodes, nodeHeight]);

  const edgeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of edges) types.add(e.edge_type);
    return Array.from(types);
  }, [edges]);

  const handleLegendHover = useCallback((et: string | null) => {
    setHoveredEdgeType(et);
  }, []);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No workflow data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        {edgeTypes.map((et) => (
          <button
            key={et}
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
            onMouseEnter={() => handleLegendHover(et)}
            onMouseLeave={() => handleLegendHover(null)}
          >
            <span
              className="block w-3 h-0.5 rounded"
              style={{ backgroundColor: EDGE_TYPE_COLORS[et] ?? "#6b7280" }}
            />
            {et}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">
          {nodes.length} task{nodes.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-auto rounded-lg border border-border bg-background/50 p-4">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`-20 -20 ${svgWidth} ${svgHeight}`}
          className="select-none"
        >
          <defs>
            {Object.entries(EDGE_TYPE_COLORS).map(([type, color]) => (
              <marker
                key={type}
                id={`arrow-${type}`}
                viewBox="0 0 10 6"
                refX={10}
                refY={3}
                markerWidth={8}
                markerHeight={6}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 3 L 0 6 z" fill={color} />
              </marker>
            ))}
          </defs>

          {edges.map((edge, i) => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) return null;

            const dimmed =
              hoveredEdgeType !== null && hoveredEdgeType !== edge.edge_type;

            return (
              <g key={`edge-${i}`} opacity={dimmed ? 0.15 : 1}>
                <DagEdgeLine
                  sourceNode={src}
                  targetNode={tgt}
                  edge={edge}
                />
              </g>
            );
          })}

          {layoutNodes.map((node) => (
            <DagNodeCard
              key={node.task_id}
              node={node}
              isCurrent={node.task_id === currentTaskId}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
