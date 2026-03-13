// Copy this file to ecosystem.config.js and fill in your values.
// ecosystem.config.js is gitignored — never commit it.
//
// This template mirrors the live PM2 config layout so names, log paths, and
// restart behavior stay aligned with the deployment we actually run.
//
// With NGINX path-based routing (recommended), API_URL, WEB_URL, and
// NEXT_PUBLIC_API_URL all point to the same domain (e.g. https://yourdomain.com).
// NEXT_PUBLIC_API_URL is baked into the Next.js bundle at build time — rebuild
// the web app after changing it.
//
// Log rotation is handled by the PM2 pm2-logrotate module. These log paths are
// stable by design so that module can rotate them safely.

module.exports = {
  apps: [
    {
      name: 'betterspend-api',
      namespace: 'betterspend',
      script: 'apps/api/dist/main.js',
      cwd: '/path/to/betterspend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://betterspend:betterspend@localhost:5433/betterspend',
        REDIS_URL: 'redis://localhost:6379',
        API_PORT: 4001,
        API_URL: 'https://yourdomain.com',
        WEB_URL: 'https://yourdomain.com',
        BETTER_AUTH_SECRET: 'change-me-use-openssl-rand-hex-32',
        MINIO_ENDPOINT: 'http://localhost:9000',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin',
        MINIO_BUCKET: 'betterspend',
      },
      log_file: '/home/ubuntu/.pm2/logs/betterspend-api.log',
      error_file: '/home/ubuntu/.pm2/logs/betterspend-api-error.log',
      out_file: '/home/ubuntu/.pm2/logs/betterspend-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      time: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 2000,
    },
    {
      name: 'betterspend-web',
      namespace: 'betterspend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: '/path/to/betterspend/apps/web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        NEXT_PUBLIC_API_URL: 'https://yourdomain.com',
      },
      log_file: '/home/ubuntu/.pm2/logs/betterspend-web.log',
      error_file: '/home/ubuntu/.pm2/logs/betterspend-web-error.log',
      out_file: '/home/ubuntu/.pm2/logs/betterspend-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      time: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 2000,
    },
  ],
};
