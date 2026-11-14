import { Router } from 'express';
import { createGameController } from '../controllers/gameController.js';

export function createGameRouter(dependencies) {
  const router = Router();
  const controller = createGameController(dependencies);
  router.post('/finalize', controller.finalizeGame);
  router.get('/:gameId/flyers', controller.getFlyerGenerationStatus);
  router.post('/:gameId/flyers/retry', controller.retryFlyerGeneration);
  return router;
}
