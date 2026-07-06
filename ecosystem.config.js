module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'server.js',
      env_development: {
        NODE_ENV: 'development',
        PORT: 8080
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080
      },
      watch: false,
    },
  ],  

deploy: {
    development: {
      user: 'ubuntu',
      host: '54.74.21.95',
      ref: 'origin/staging',
      repo: 'git@github.com:calculus-guy/Learning247-creators-platform-backend.git',
      path: '/home/ubuntu/backend',
      'post-deploy': 'npm install && npx sequelize db:migrate && pm2 reload ecosystem.config.js --env development',
      env: {
        NODE_ENV: 'development',
      },
    },
    production: {
      user: 'ubuntu',
      host: '34.251.237.6',
      ref: 'origin/master',
      repo: 'git@github.com:calculus-guy/Learning247-creators-platform-backend.git',
      path: '/home/ubuntu/backend',
      'post-deploy': 'npm install && npx sequelize db:migrate && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};

