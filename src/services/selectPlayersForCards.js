import { evaluateGraphicTier } from '../utils/evaluateGraphicTier.js';

export function selectPlayersForCards(players) {
  if (players.length === 1) return [...players];

  return [...players]
    .filter((player) => evaluateGraphicTier(player) >= 2)
    .sort(
      (left, right) =>
        right.pts - left.pts ||
        right.reb - left.reb ||
        right.ast - left.ast,
    )
    .slice(0, 5);
}
