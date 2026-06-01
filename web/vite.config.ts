import { defineConfig } from "vite";

/** Override with http://127.0.0.1:8081 when running server/docker-compose locally. */
const engineProxy = process.env.VITE_ENGINE_PROXY ?? "https://borderchess.org";

export default defineConfig({
  base: "/play/",
  build: {
    modulePreload: false,
  },
  plugins: [
    {
      name: "strip-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, "");
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/v1/move": { target: engineProxy, changeOrigin: true, secure: true },
      "/health": { target: engineProxy, changeOrigin: true, secure: true },
    },
  },
});
