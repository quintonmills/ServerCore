function redactConnectionCredentials(message) {
  return message.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1[redacted]@');
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;

  if (status >= 500) {
    const message = error instanceof Error ? redactConnectionCredentials(error.message) : 'Unknown error';
    console.error(`[${request.method} ${request.path}] ${message}`);
  }

  const errorResponse = {
    error: {
      code: status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      message:
        status === 404
          ? 'Resource not found'
          : status === 500
          ? 'An internal server error occurred'
          : error.type === 'entity.parse.failed'
            ? 'Request body must contain valid JSON'
            : error.message,
    },
  };
  if (error.type === 'entity.too.large') {
    errorResponse.error.code = 'PAYLOAD_TOO_LARGE';
    errorResponse.error.message = 'Request body is too large';
  }

  response.status(status).json(errorResponse);
}
