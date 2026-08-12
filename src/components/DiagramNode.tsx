import type { DiagramNodeData } from "../lib/diagram-types";
import { NODE_WIDTH, NODE_HEIGHT, wrapLabel } from "../lib/diagram-constants";

type Props = {
  node: DiagramNodeData;
  accent: string;
  accentGlow: string;
  isHovered: boolean;
  isSelected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

export default function DiagramNode({ node, accent, accentGlow, isHovered, isSelected, onHover, onSelect }: Props) {
  const active = isHovered || isSelected;
  const lines = wrapLabel(node.label);
  const lineHeight = 14;
  const startY = NODE_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2;

  return (
    <g
      transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(node.id)}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}: ${node.description}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={8}
        fill="var(--color-surface)"
        stroke={active ? accent : "var(--color-border)"}
        strokeWidth={active ? 1.5 : 1}
        style={{
          filter: active ? `drop-shadow(0 0 8px ${accentGlow})` : "none",
          transition: "stroke 150ms ease, filter 150ms ease",
        }}
      />
      <text
        x={NODE_WIDTH / 2}
        textAnchor="middle"
        fill="var(--color-text)"
        fontFamily="var(--font-mono)"
        fontSize="12"
        fontWeight={active ? 600 : 500}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={NODE_WIDTH / 2} y={startY + i * lineHeight} dominantBaseline="middle">
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}
