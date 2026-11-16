import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: [
        "**/experiments/smule-renaissance/.venv/**",
        "**/experiments/smule-renaissance/upstream/**",
        "**/experiments/smule-renaissance/inputs/**",
        "**/experiments/smule-renaissance/outputs/**",
      ],
    },
  },
});
