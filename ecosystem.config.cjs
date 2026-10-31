/**
 * PM2 process file — the simplest always-on setup on any machine (no root).
 *
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     # ← starts on boot
 *
 * PM2 restarts the agent if it crashes, keeps logs rotated, and exposes
 * `pm2 monit` / `pm2 logs nova` for live inspection.
 */
module.exports = {
  apps: [
    {
      name: "nova",
      cwd: "./artifacts/api-server",
      script: "dist/index.mjs",
      node_args: "--enable-source-maps",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 1000,
      restart_delay: 3000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: "1200M",
      watch: false,
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "8080",
        NOVA_MEMORY_FILE: "../../state/nova-memory.json",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen2.5:3b",
      },
      out_file: "./logs/nova-out.log",
      error_file: "./logs/nova-err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
