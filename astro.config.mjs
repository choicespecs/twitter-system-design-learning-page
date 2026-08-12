// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://choicespecs.github.io',
  base: '/twitter-system-design-learning-page',
  integrations: [react()]
});