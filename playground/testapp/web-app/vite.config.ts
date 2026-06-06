import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: parseInt(process.env.WEB_PORT ?? "4000", 10) },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
