import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraphicTier } from '../src/utils/evaluateGraphicTier.js';

test('evaluates tier thresholds in elite-first priority order', () => {
  assert.equal(evaluateGraphicTier({ pts: 17, reb: 2, ast: 2 }), 1);
  assert.equal(evaluateGraphicTier({ pts: 18, reb: 2, ast: 2 }), 2);
  assert.equal(evaluateGraphicTier({ pts: 3, reb: 2, ast: 8 }), 2);
  assert.equal(evaluateGraphicTier({ pts: 10, reb: 10, ast: 2 }), 2);
  assert.equal(evaluateGraphicTier({ pts: 25, reb: 0, ast: 0 }), 3);
  assert.equal(evaluateGraphicTier({ pts: 18, reb: 10, ast: 8 }), 2);
  assert.equal(evaluateGraphicTier({ pts: 0, reb: 0, ast: 0, topPerformer: true }), 3);
});

test('supports uppercase box-score stat keys as well as player stat keys', () => {
  assert.equal(evaluateGraphicTier({ PTS: 10, REB: 10, AST: 0 }), 2);
});
