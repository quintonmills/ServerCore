import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { generateStatCard } from '../src/services/renderGraphic.js';

test('renders a 1080 by 1350 JPEG with a safe file path and public URL', async () => {
  const graphic = await generateStatCard(
    {
      id: '../p1',
      name: 'A very long player name that still fits gracefully within the stat card',
      jersey: '3',
      team: 'Team A',
      pts: 14,
      reb: 5,
      ast: 3,
    },
    {
      gameId: '../game-101',
      location: 'Marietta Rec League',
      teamA: { name: 'Red Team', score: 24 },
      teamB: { name: 'Blue Team', score: 18 },
    },
    { publicBaseUrl: 'http://localhost:5000/' },
  );

  try {
    const image = await loadImage(graphic.filePath);
    assert.equal(image.width, 1080);
    assert.equal(image.height, 1350);
    assert.equal(dirname(graphic.filePath), resolve('output'));
    assert.match(graphic.filePath, /game-101-p1-[a-f0-9-]+\.jpg$/);
    assert.match(graphic.publicUrl, /^http:\/\/localhost:5000\/output\//);
  } finally {
    await unlink(graphic.filePath);
  }
});
