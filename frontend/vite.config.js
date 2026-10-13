import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// dev proxy to the api on :3000
export default defineConfig({ plugins: [react()], server: { port: 5173, proxy: { "/api": "http://localhost:3000" } } });
