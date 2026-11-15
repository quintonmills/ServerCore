import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsByAction } from '../src/utils/eventsByAction.js';

test('keys events by their exact action and preserves repeated actions', () => {
  const events = [
    { action: 'PTS_2', playerId: 'p1' },
    { action: 'PTS_2', playerId: 'p2' },
    { action: 'REB', playerId: 'p1' },
  ];

  assert.deepEqual(eventsByAction(events), {
    PTS_2: events[0],
    'PTS_2 (2)': events[1],
    REB: events[2],
  });
});

test('normalizes previously keyed events without changing action casing', () => {
  const events = {
    pts_2: { action: 'PTS_2', playerId: 'p1' },
  };

  assert.deepEqual(eventsByAction(events), {
    PTS_2: events.pts_2,
  });
});
