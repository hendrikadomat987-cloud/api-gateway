'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const logger = require('../utils/logger');

/**
 * JWT authentication middleware — HS256 only.
 *
 * Expects:  Authorization: Bearer <token>
 *
 * On success:  attaches decoded payload to req.jwtPayload and calls next().
 * On failure:  responds with 401 and a structured error body.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json(error('MISSING_TOKEN', 'Authorization header is required'));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json(error('INVALID_TOKEN_FORMAT', 'Use: Authorization: Bearer <token>'));
  }

  const token = parts[1];
  const verifyOptions = {
    algorithms: ['HS256'],   // hardcoded — never allow RS256, none, or any other alg
    ...(config.jwt.issuer   && { issuer:   config.jwt.issuer }),
    ...(config.jwt.audience && { audience: config.jwt.audience }),
  };

  try {
    const payload = jwt.verify(token, config.jwt.secret, verifyOptions);
    req.jwtPayload = payload;
    logger.debug('JWT verified', { sub: payload.sub, requestId: req.id });
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message, requestId: req.id });

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(error('TOKEN_EXPIRED', 'Token has expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json(error('INVALID_TOKEN', err.message));
    }
    if (err.name === 'NotBeforeError') {
      return res.status(401).json(error('TOKEN_NOT_ACTIVE', 'Token not yet valid'));
    }

    return res.status(401).json(error('AUTH_FAILED', 'Authentication failed'));
  }
}

function error(code, message) {
  return { success: false, error: { code, message } };
}

module.exports = authenticate;
