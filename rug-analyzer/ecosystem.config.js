// PM2 Ecosystem Config — Rug Analyzer PRO
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   (follow the printed command to enable auto-start on boot)

module.exports = {
  apps: [
    {
      name: 'rug-analyzer',
      script: 'index.js',
      cwd: __dirname,

      // Auto-restart settings
      watch: false,              // do NOT watch files (causes restart loops)
      autorestart: true,         // restart on crash
      max_restarts: 20,          // max crash restarts before giving up
      min_uptime: '10s',         // must stay alive 10s to count as a successful start
      restart_delay: 5000,       // wait 5s before restarting after a crash

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Memory limit — auto-restart if RAM exceeds 300 MB (safe for phones)
      max_memory_restart: '300M',

      // Exponential backoff on repeated crashes (prevents crash loop hammering APIs)
      exp_backoff_restart_delay: 100,
    },
  ],
};
