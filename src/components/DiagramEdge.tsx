import type { DiagramNodeData } from "../lib/diagram-types";

const INSET = 68;

function shorten(from: DiagramNodeData, to: DiagramNodeData) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const inset = Math.min(INSET, dist / 2 - 4);
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
