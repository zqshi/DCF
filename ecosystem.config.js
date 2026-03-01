module.exports = {
  apps: [
    {
      name: 'dcf-app',
      script: './app/src/server.js',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      wait_ready: true,
      listen_timeout: 30000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
