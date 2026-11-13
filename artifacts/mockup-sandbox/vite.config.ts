import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

/* PORT و BASE_PATH بيبقوا مطلوبين بس لما البي إتش بي أو الـSSG أو السيرفر
 * الحربي بيشغّل الـdev. مجرد تجميع يقدر يسقط افتراضي من غير بيئة موفرة. */
const rawPort = process.env.PORT;
if (process.env.NODE_ENV !== "production" && !rawPort) {
  console.warn("[mockup-sandbox] PORT not set — defaulting to 5173 for dev build");
}
const port = rawPort ? (Number.isNaN(Number(rawPort)) || Number(rawPort) <= 0 ? 5173 : Number(rawPort)) : 5173;

if (process.env.NODE_ENV !== "production" && !process.env.BASE_PATH) {
  console.warn("[mockup-sandbox] BASE_PATH not set — defaulting to /");
}
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
