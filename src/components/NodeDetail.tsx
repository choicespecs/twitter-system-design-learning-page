import type { DiagramNodeData } from "../lib/diagram-types";

type Props = {
  node: DiagramNodeData | null;
  accent: string;
  onClose: () => void;
};

export default function NodeDetail({ node, accent, onClose }: Props) {
  if (!node) return null;

  return (
    <div className="node-detail">
      <div className="node-detail-header">
        <span className="node-detail-dot" style={{ background: accent }} />
        <h4>{node.label}</h4>
        <button type="button" className="node-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p>{node.description}</p>
      <style>{`
        .node-detail {
          margin-top: var(--space-3);
          background: var(--color-surface-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          animation: node-detail-in 150ms ease-out;
        }
        @keyframes node-detail-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .node-detail-header {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4) var(--space-2);
        }
        .node-detail-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .node-detail-header h4 {
          font-size: var(--text-sm);
          flex: 1;
        }
        .node-detail-close {
          background: none;
          border: none;
          color: var(--color-text-muted);
          font-size: var(--text-lg);
          line-height: 1;
          cursor: pointer;
        }
        .node-detail-close:hover {
          color: var(--color-text);
        }
        .node-detail p {
          padding: 0 var(--space-4) var(--space-4);
          font-size: var(--text-sm);
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
}
