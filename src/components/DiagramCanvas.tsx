import { useId, useMemo, useState } from "react";
import type { DiagramConfig, DiagramNodeData, TierKey } from "../lib/diagram-types";
import { NODE_WIDTH, NODE_HEIGHT, CANVAS_PADDING } from "../lib/diagram-constants";
import DiagramNode from "./DiagramNode";
import DiagramEdge from "./DiagramEdge";
import NodeDetail from "./NodeDetail";

/** Computes a viewBox that fits every node's full box extent, so nothing near the edges gets clipped. */
function computeViewBox(nodes: DiagramNodeData[]) {
  const halfW = NODE_WIDTH / 2 + CANVAS_PADDING;
  const halfH = NODE_HEIGHT / 2 + CANVAS_PADDING;
  const minX = Math.min(...nodes.map((n) => n.x)) - halfW;
  const maxX = Math.max(...nodes.map((n) => n.x)) + halfW;
  const minY = Math.min(...nodes.map((n) => n.y)) - halfH;
  const maxY = Math.max(...nodes.map((n) => n.y)) + halfH;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

const TIER_LABELS: Record<TierKey, string> = {
  basic: "🌱 Basic",
  scaled: "⚙️ Scaled",
  advanced: "🚀 Advanced",
};

const TIER_ORDER: TierKey[] = ["basic", "scaled", "advanced"];

type Props = {
  config: DiagramConfig;
  accent: string;
  accentGlow: string;
};

export default function DiagramCanvas({ config, accent, accentGlow }: Props) {
  const [tier, setTier] = useState<TierKey>("basic");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const markerId = useId().replace(/:/g, "");

  const active = config[tier];
  const nodeMap = useMemo(() => new Map(active.nodes.map((n) => [n.id, n])), [active]);
  const selectedNode = selectedId ? nodeMap.get(selectedId) ?? null : null;
  const viewBox = useMemo(() => computeViewBox(active.nodes), [active]);

  const handleTierChange = (next: TierKey) => {
    setTier(next);
    setHoveredId(null);
    setSelectedId(null);
  };

  return (
    <div className="diagram-canvas">
      <div className="stepper" role="tablist" aria-label="Complexity tier">
        {TIER_ORDER.map((key, i) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tier === key}
            className={`step ${tier === key ? "active" : ""}`}
            onClick={() => handleTierChange(key)}
          >
            <span className="step-label">{TIER_LABELS[key]}</span>
            {i < TIER_ORDER.length - 1 && <span className="step-connector" />}
          </button>
        ))}
      </div>

      <div className="canvas-frame">
        <svg viewBox={viewBox} className="svg" role="group" aria-label={`${tier} diagram`}>
          <defs>
            <marker
              id={`arrow-${markerId}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={accent} />
            </marker>
          </defs>
          {active.edges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;
            const isActive = selectedId !== null && (edge.from === selectedId || edge.to === selectedId);
            return (
              <DiagramEdge
                key={`${edge.from}-${edge.to}`}
                from={from}
                to={to}
                accent={accent}
                active={isActive}
                markerId={`arrow-${markerId}`}
              />
            );
          })}
          {active.nodes.map((node) => (
            <DiagramNode
              key={node.id}
              node={node}
              accent={accent}
              accentGlow={accentGlow}
              isHovered={hoveredId === node.id}
              isSelected={selectedId === node.id}
              onHover={setHoveredId}
              onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
            />
          ))}
        </svg>
      </div>
      <NodeDetail node={selectedNode} accent={accent} onClose={() => setSelectedId(null)} />
      <p className="hint">Click a node to see what it does. Switch tiers above to see how the design scales.</p>

      <style>{`
        .diagram-canvas {
          margin-bottom: var(--space-6);
        }
        .stepper {
          display: flex;
          align-items: center;
          margin-bottom: var(--space-4);
        }
        .step {
          display: flex;
          align-items: center;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
        }
        .step-label {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          color: var(--color-text-muted);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-pill);
          border: 1px solid var(--color-border);
          transition: color 150ms ease, border-color 150ms ease, background 150ms ease;
        }
        .step.active .step-label {
          color: var(--color-text);
          border-color: ${accent};
          background: var(--color-surface);
          box-shadow: 0 0 10px ${accentGlow};
        }
        .step-connector {
          width: var(--space-5);
          height: 1px;
          background: var(--color-border);
        }
        .canvas-frame {
          overflow: hidden;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-card);
        }
        .svg {
          display: block;
          width: 100%;
          height: auto;
        }
        .hint {
          margin-top: var(--space-3);
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}
