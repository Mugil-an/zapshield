const { validationResult } = require('express-validator');
const ApiError = require('../utils/apiError');

function validate(validations) {
  return async (req, res, next) => {
    try {
      await Promise.all(validations.map((validation) => validation.run(req)));

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const formatted = errors.array().map((e) => ({
          field: e.path,
          message: e.msg,
        }));
        throw ApiError.badRequest('Validation failed', formatted);
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = validate;
