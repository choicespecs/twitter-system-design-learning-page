import type { DiagramNodeData } from "../lib/diagram-types";
import { NODE_WIDTH, NODE_HEIGHT } from "../lib/diagram-constants";

const HALF_W = NODE_WIDTH / 2;
const HALF_H = NODE_HEIGHT / 2;

/** Distance from a box's center to its edge along a given direction. */
function boxExitDistance(ux: number, uy: number) {
  const tx = ux !== 0 ? HALF_W / Math.abs(ux) : Infinity;
  const ty = uy !== 0 ? HALF_H / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
}

function shorten(from: DiagramNodeData, to: DiagramNodeData) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const inset = Math.min(boxExitDistance(ux, uy), dist / 2 - 4);
  return {
    x1: from.x + ux * inset,
    y1: from.y + uy * inset,
    x2: to.x - ux * inset,
    y2: to.y - uy * inset,
  };
}

type Props = {
  from: DiagramNodeData;
  to: DiagramNodeData;
  accent: string;
  active: boolean;
  markerId: string;
};

export default function DiagramEdge({ from, to, accent, active, markerId }: Props) {
  const { x1, y1, x2, y2 } = shorten(from, to);

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={active ? accent : "var(--color-border)"}
      strokeWidth={active ? 2 : 1.5}
      markerEnd={`url(#${markerId})`}
      strokeDasharray={active ? "6 4" : undefined}
      style={
        active
          ? {
              animation: "diagram-flow 900ms linear infinite",
            }
          : undefined
      }
    />
  );
}
