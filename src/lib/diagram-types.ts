export type DiagramNodeData = {
  id: string;
  label: string;
  x: number;
  y: number;
  description: string;
};

export type DiagramEdgeData = {
  from: string;
  to: string;
};

export type DiagramTier = {
  nodes: DiagramNodeData[];
  edges: DiagramEdgeData[];
};

export type DiagramConfig = {
  basic: DiagramTier;
  scaled: DiagramTier;
  advanced: DiagramTier;
};

export type TierKey = keyof DiagramConfig;
