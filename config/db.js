const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
        sslmode: 'require'
      }
    },
    // Sequelize's default pool is `max: 5` — fine for light traffic, but a
    // severe bottleneck once real concurrency shows up: a tournament with a
    // few hundred participants starting at once (each knockout pairing alone
    // issues several queries), or just ordinary traffic from a few hundred
    // simultaneous users, would have every request queuing for one of only 5
    // connections regardless of how fast each individual query is. 20 is a
    // conservative multiple, not a guess at a ceiling — raise it further if
    // the Postgres plan's own max_connections has headroom to spare (a
    // managed Render Postgres instance has its own hard cap shared across
    // every client connected to it, so this shouldn't be pushed blindly high
    // without checking that first).
    pool: {
      max: 20,
      min: 2,
      acquire: 30000,
      idle: 10000
    }
  }
);

sequelize.authenticate()
  .then(() => console.log('PostgreSQL connected successfully'))
  .catch((err) => console.error('Database connection failed:', err.stack));

module.exports = sequelize;