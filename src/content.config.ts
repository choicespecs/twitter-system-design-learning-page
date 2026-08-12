import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const subsystems = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/subsystems" }),
  schema: z.object({
    title: z.string(),
    teaser: z.string(),
    category: z.enum(["data-flow", "scaling", "auxiliary"]),
    order: z.number(),
    techChoices: z.array(z.string()).default([]),
  }),
});

export const collections = { subsystems };
