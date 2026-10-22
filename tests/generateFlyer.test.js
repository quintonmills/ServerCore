import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateFlyer } from '../src/services/generateFlyer.js';
import { createGeneratedJpegBuffer, createRasterImageDataUrl } from './rasterImageFixtures.js';

test('saves the complete OpenAI-generated flyer JPEG without local image composition', async () => {
  const referenceDataUrl = createRasterImageDataUrl('png');
  const generatedFlyer = createGeneratedJpegBuffer();
  const graphic = await generateFlyer(
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
    {
      publicBaseUrl: 'http://localhost:5000/',
      playerImage: referenceDataUrl,
      teamLogoImage: referenceDataUrl,
      imageGenerator: async () => generatedFlyer,
    },
  );

  try {
    const image = await readFile(graphic.filePath);
    assert.deepEqual(image, generatedFlyer);
    assert.equal(dirname(graphic.filePath), resolve('output'));
    assert.match(graphic.filePath, /game-101-p1-[a-f0-9-]+\.jpg$/);
    assert.match(graphic.publicUrl, /^http:\/\/localhost:5000\/output\//);
  } finally {
    await unlink(graphic.filePath);
  }
});
