import { Router } from 'express';
import { createGameController } from '../controllers/gameController.js';

export function createGameRouter(dependencies) {
  const router = Router();
  router.post('/finalize', createGameController(dependencies));
  return router;
}
