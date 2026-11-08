export function evaluateGraphicTier(stats) {
  const points = stats.pts ?? stats.PTS ?? 0;
  const rebounds = stats.reb ?? stats.REB ?? 0;
  const assists = stats.ast ?? stats.AST ?? 0;

  if (stats.topPerformer === true || points >= 25) return 3;

  const doubleDoubleCount = [points, rebounds, assists].filter((value) => value >= 10).length;
  if (points >= 18 || assists >= 8 || doubleDoubleCount >= 2) return 2;

  return 1;
}
