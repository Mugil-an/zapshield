const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');

function auth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('No token provided');
  }

  const token = authHeader.split(' ')[1];

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.rider = decoded;

  return next();
}

module.exports = auth;
