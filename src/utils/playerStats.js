const statAliases = {
  PTS: ['PTS', 'pts'],
  REB: ['REB', 'reb'],
  AST: ['AST', 'ast'],
  STL: ['STL', 'stl'],
  BLK: ['BLK', 'blk'],
  TOV: ['TOV', 'TO', 'to'],
  MIN: ['MIN', 'min'],
  FG: ['FG', 'FGM', 'fg', 'fgm'],
  FGA: ['FGA', 'fga'],
  FG3: ['FG3', 'FG3M', '3PM', 'fg3'],
  FG3A: ['FG3A', '3PA', 'fg3a'],
  FT: ['FT', 'FTM', 'ft'],
  FTA: ['FTA', 'fta'],
  OREB: ['OREB', 'oreb'],
  DREB: ['DREB', 'dreb'],
  PF: ['PF', 'pf'],
  PLUS_MINUS: ['PLUS_MINUS', 'plusMinus'],
};

export function normalizePlayerStats(player) {
  const source = { ...player, ...(player.stats || {}) };
  return Object.fromEntries(
    Object.entries(statAliases).map(([stat, aliases]) => [
      stat,
      aliases.map((alias) => source[alias]).find((value) => value !== undefined) || 0,
    ]),
  );
}
