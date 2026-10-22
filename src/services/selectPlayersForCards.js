export function selectPlayersForCards(players) {
  return [...players]
    .filter((player) => player.pts >= 1)
    .sort(
      (left, right) =>
        right.pts - left.pts ||
        right.reb - left.reb ||
        right.ast - left.ast,
    )
    .slice(0, 3);
}
