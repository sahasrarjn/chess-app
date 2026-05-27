import { defineConfig } from "vite";

export default defineConfig({
  base: "/play/",
  server: {
    port: 5173,
    proxy: {
      "/v1/move": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
});
