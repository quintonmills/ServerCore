import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsByAction } from '../src/utils/eventsByAction.js';

test('keys events by their normalized action and preserves repeated actions', () => {
  const events = [
    { action: 'PTS_2', playerId: 'p1' },
    { action: 'PTS_2', playerId: 'p2' },
    { action: 'REB', playerId: 'p1' },
  ];

  assert.deepEqual(eventsByAction(events), {
    pts_2: events[0],
    'pts_2 (2)': events[1],
    reb: events[2],
  });
});
