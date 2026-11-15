import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import logger from '../logger.js';

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestLogger = pinoHttp({
  logger,
  genReqId(request, response) {
    const incomingId = request.headers['x-request-id'];
    const requestId =
      typeof incomingId === 'string' && requestIdPattern.test(incomingId)
        ? incomingId
        : randomUUID();
    response.setHeader('x-request-id', requestId);
    return requestId;
  },
  customProps(request) {
    return { requestId: request.id };
  },
  serializers: {
    req(request) {
      return {
        id: request.id,
        method: request.method,
        path: request.url?.split('?')[0],
      };
    },
    res(response) {
      return { statusCode: response.statusCode };
    },
  },
  customLogLevel(_request, response, error) {
    if (error || response.statusCode >= 500) return 'silent';
    if (response.statusCode >= 400) return 'warn';
    return 'info';
  },
});
