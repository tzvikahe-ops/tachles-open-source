import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Pure SPA: a single fallback HTML, all routing happens client-side.
    adapter: adapter({ fallback: "index.html", strict: false }),
  },
};

export default config;
