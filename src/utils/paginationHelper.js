function toPositiveInt(value, defaultValue) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    return defaultValue;
  }
  return num;
}

function buildPagination(query, defaultLimit = 10, maxLimit = 100) {
  const page = toPositiveInt(query.page, 1);
  const rawLimit = toPositiveInt(query.limit, defaultLimit);
  const limit = Math.min(rawLimit, maxLimit);
  const offset = (page - 1) * limit;

  return { limit, offset, page };
}

function buildPaginatedResponse(data, total, page, limit) {
  const safeLimit = limit > 0 ? limit : 1;
  const totalPages = Math.ceil(total / safeLimit) || 1;

  return {
    data,
    pagination: {
      total,
      page,
      limit: safeLimit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = {
  buildPagination,
  buildPaginatedResponse,
};
