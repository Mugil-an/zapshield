const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');

const ALLOWED_ROLES = ['insurer_analyst', 'insurer_admin', 'super_admin'];

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('No token provided');
  }

  const token = authHeader.split(' ')[1];

  const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

  if (!ALLOWED_ROLES.includes(decoded.role)) {
    throw ApiError.forbidden('Insufficient permissions');
  }

  req.admin = decoded;

  return next();
}

module.exports = adminAuth;
