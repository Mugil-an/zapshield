const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const helmet = require('helmet');

const app = express();

// Security middleware
app.use(helmet());

// Core middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// HTTP request logging (will be refined later with env-specific configs)
app.use(morgan('dev'));

// API routes
app.use('/api', routes);

// Basic liveness probe for infra
app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;
