import logger, { serializeError } from '../logger.js';

export function errorHandler(error, request, response, next) {
  const requestedStatus = error?.status ?? error?.statusCode;
  const status =
    Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
      ? requestedStatus
      : 500;
  const knownImageError =
    error?.code === 'INVALID_IMAGE_ASSET' || error?.code === 'IMAGE_GENERATION_FAILED';

  const log = request.log || logger;
  const errorFields = {
    method: request.method,
    path: request.path,
    statusCode: status,
    err: serializeError(error),
  };
  if (!request.log) errorFields.requestId = request.id;
  if (status >= 500) {
    log.error(errorFields, 'Request failed');
  } else {
    log.warn(errorFields, 'Request rejected');
  }

  if (response.headersSent) {
    next(error);
    return;
  }

  const errorCodes = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    413: 'PAYLOAD_TOO_LARGE',
    429: 'TOO_MANY_REQUESTS',
  };
  const errorResponse = {
    error: {
      code:
        (knownImageError && error.code) ||
        errorCodes[status] ||
        (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
      message:
        status === 404
          ? 'Resource not found'
          : status >= 500 && !knownImageError
          ? 'An internal server error occurred'
          : error?.type === 'entity.parse.failed'
            ? 'Request body must contain valid JSON'
            : error?.message || 'An internal server error occurred',
    },
  };
  if (error?.type === 'entity.too.large') {
    errorResponse.error.code = 'PAYLOAD_TOO_LARGE';
    errorResponse.error.message = 'Request body is too large';
  }

  response.status(status).json(errorResponse);
}
