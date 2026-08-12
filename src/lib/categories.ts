export const CATEGORY_META = {
  "data-flow": {
    label: "Core Data Flow",
    color: "var(--color-accent-mint)",
    glow: "var(--glow-mint)",
  },
  scaling: {
    label: "Scaling & Infra",
    color: "var(--color-accent-amber)",
    glow: "var(--glow-amber)",
  },
  auxiliary: {
    label: "Auxiliary Systems",
    color: "var(--color-accent-pink)",
    glow: "var(--glow-pink)",
  },
} as const;

export type Category = keyof typeof CATEGORY_META;
