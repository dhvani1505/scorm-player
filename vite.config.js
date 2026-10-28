import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      "/courses": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },

      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});