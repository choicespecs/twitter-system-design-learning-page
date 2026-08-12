import type { DiagramNodeData } from "../lib/diagram-types";

type Props = {
  node: DiagramNodeData | null;
  accent: string;
  onClose: () => void;
};

export default function SidePanel({ node, accent, onClose }: Props) {
  return (
    <div className={`side-panel ${node ? "open" : ""}`} aria-hidden={!node}>
      {node && (
        <>
          <div className="side-panel-header">
            <span className="side-panel-dot" style={{ background: accent }} />
            <h4>{node.label}</h4>
            <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <p>{node.description}</p>
        </>
      )}
      <style>{`
        .side-panel {
          position: absolute;
          top: 0;
          right: 0;
          height: 100%;
          width: 0;
          overflow: hidden;
          background: var(--color-surface-secondary);
          border-left: 1px solid var(--color-border);
          transition: width 250ms ease-out;
        }
        .side-panel.open {
          width: min(260px, 100%);
        }
        .side-panel-header {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-4) var(--space-2);
        }
        .side-panel-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .side-panel-header h4 {
          font-size: var(--text-sm);
          flex: 1;
        }
        .side-panel-close {
          background: none;
          border: none;
          color: var(--color-text-muted);
          font-size: var(--text-lg);
          line-height: 1;
          cursor: pointer;
        }
        .side-panel-close:hover {
          color: var(--color-text);
        }
        .side-panel p {
          padding: 0 var(--space-4) var(--space-4);
          font-size: var(--text-sm);
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
}
