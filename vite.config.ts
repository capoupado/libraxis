import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.LIBRAXIS_BACKEND_URL ?? `http://localhost:${env.PORT || "3000"}`;

  return {
    plugins: [react()],
    root: "src/web",
    server: {
      port: 5173,
      proxy: {
        "^/(health|context|skills|entries|links|proposals|agents|owner|admin)(/|$)": {
          target: backendUrl,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: "../../dist/web",
      emptyOutDir: true
    },
    preview: {
      port: 4173
    }
  };
});
