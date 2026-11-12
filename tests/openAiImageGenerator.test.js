import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneratedJpegBuffer,
  createRasterImageDataUrl,
} from './rasterImageFixtures.js';
import { generateFlyerImage } from '../src/services/openAiImageGenerator.js';

test('uses the flyer example for art direction alongside player and team references', async () => {
  const playerImages = [
    createRasterImageDataUrl('png'),
    createRasterImageDataUrl('jpeg'),
    createRasterImageDataUrl('webp'),
  ];
  const templateImage = createRasterImageDataUrl('png');
  const teamLogoImage = createRasterImageDataUrl('jpeg');
  const generatedImage = createGeneratedJpegBuffer();
  let requestUrl;
  let requestOptions;

  const result = await generateFlyerImage({
    player: {
      name: 'Marcus',
      jersey: '3',
      team: 'Team A',
      pts: 14,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 0,
      to: 2,
    },
    game: {
      teamA: { name: 'Red Team' },
      teamB: { name: 'Blue Team' },
    },
    playerImages,
    templateImage,
    teamLogoImage,
    imageGeneration: {
      prompt: 'Add a subtle arena spotlight',
      size: '1024x1024',
      quality: 'medium',
    },
    apiKey: 'test-key',
    fetchImplementation: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        async json() {
          return { data: [{ b64_json: generatedImage.toString('base64') }] };
        },
      };
    },
  });

  assert.equal(requestUrl, 'https://api.openai.com/v1/images/edits');
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
  const form = requestOptions.body;
  assert.equal(form.get('model'), 'gpt-image-2.5-sunburst');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.has('input_fidelity'), false);
  assert.equal(form.get('output_format'), 'jpeg');
  assert.match(form.get('prompt'), /Marcus/);
  assert.match(form.get('prompt'), /Red Team/);
  assert.match(form.get('prompt'), /subtle arena spotlight/);
  assert.match(form.get('prompt'), /primary visual art-direction reference/);
  assert.match(form.get('prompt'), /torn-paper layering/);
  assert.match(form.get('prompt'), /Do not copy its text, numbers, athlete/);
  assert.match(form.get('prompt'), /TIER 1 standard-run theme/);
  assert.match(form.get('prompt'), /clean neutral lighting/);
  assert.doesNotMatch(form.get('prompt'), /En Fuego|King of the Court|STAT BREAKOUT/);
  assert.match(form.get('prompt'), /one complete, original portrait-format basketball player spotlight flyer/);
  assert.match(form.get('prompt'), /must feel complete regardless of the stat total/);
  assert.match(form.get('prompt'), /Keep the established baseline composition/);
  assert.match(form.get('prompt'), /Create exactly one prominent, realistic head-and-shoulders portrait/);
  assert.match(form.get('prompt'), /do not depict a full body/);
  assert.match(form.get('prompt'), /without inferring or changing their gender or body type/);
  assert.doesNotMatch(form.get('prompt'), /dynamic full-body basketball pose/);
  assert.match(form.get('prompt'), /Display the exact featured stat as "POINTS" and the amount "14"/);
  assert.match(form.get('prompt'), /This is the only statistic to include/);
  assert.match(form.get('prompt'), /Do not add any other statistics/);
  const references = form.getAll('image[]');
  assert.equal(references.length, 5);
  assert.deepEqual(references.map((reference) => reference.type), [
    'image/png',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/jpeg',
  ]);
  assert.equal(references[0].size, Buffer.from(templateImage.split(',')[1], 'base64').length);
  assert.deepEqual(
    references.slice(1, 4).map((reference) => reference.size),
    playerImages.map((image) => Buffer.from(image.split(',')[1], 'base64').length),
  );
  assert.equal(references[4].size, Buffer.from(teamLogoImage.split(',')[1], 'base64').length);
  assert.deepEqual(result, generatedImage);
});

test('injects deterministic theme tokens for each performance tier before the API request', async () => {
  const image = createRasterImageDataUrl('png');
  const generatedImage = createGeneratedJpegBuffer();
  const cases = [
    {
      player: { pts: 14, reb: 5, ast: 3 },
      expected: /TIER 1 standard-run theme.*clean neutral lighting/s,
      unexpected: /STAT BREAKOUT|King of the Court/,
    },
    {
      player: { pts: 18, reb: 3, ast: 2 },
      expected: /TIER 2 "En Fuego".*#CCFF00.*STAT BREAKOUT/s,
      unexpected: /King of the Court/,
    },
    {
      player: { pts: 12, reb: 4, ast: 8 },
      expected: /TIER 2 "En Fuego".*#CCFF00.*STAT BREAKOUT/s,
      unexpected: /King of the Court/,
    },
    {
      player: { pts: 10, reb: 10, ast: 1 },
      expected: /TIER 2 "En Fuego".*#CCFF00.*STAT BREAKOUT/s,
      unexpected: /King of the Court/,
      featured: /Display the exact featured stat as "REBOUNDS" and the amount "10"/,
      notFeatured: /Display the exact featured stat as "POINTS"/,
    },
    {
      player: { pts: 18, reb: 10, ast: 1 },
      expected: /TIER 2 "En Fuego".*#CCFF00.*STAT BREAKOUT/s,
      unexpected: /King of the Court/,
      featured: /Display the exact featured stat as "POINTS" and the amount "18"/,
      notFeatured: /Display the exact featured stat as "REBOUNDS"/,
    },
    {
      player: { pts: 25, reb: 4, ast: 2 },
      expected: /TIER 3 "King of the Court".*#050505.*chrome-and-gold.*crown.*border breaks/s,
      unexpected: /STAT BREAKOUT/,
    },
    {
      player: { pts: 5, reb: 2, ast: 1, topPerformer: true },
      expected: /TIER 3 "King of the Court".*#050505.*chrome-and-gold/s,
      unexpected: /STAT BREAKOUT/,
    },
  ];

  for (const {
    player: stats,
    expected,
    unexpected,
    featured,
    notFeatured,
  } of cases) {
    let submittedPrompt;
    await generateFlyerImage({
      player: {
        name: 'Marcus',
        jersey: '3',
        team: 'Team A',
        pts: 0,
        reb: 0,
        ast: 0,
        ...stats,
      },
      game: {
        teamA: { name: 'Red Team' },
        teamB: { name: 'Blue Team' },
      },
      playerImage: image,
      teamLogoImage: image,
      apiKey: 'test-key',
      fetchImplementation: async (_url, { body }) => {
        submittedPrompt = body.get('prompt');
        return {
          ok: true,
          async json() {
            return { data: [{ b64_json: generatedImage.toString('base64') }] };
          },
        };
      },
    });

    assert.match(submittedPrompt, expected);
    assert.doesNotMatch(submittedPrompt, unexpected);
    if (featured) assert.match(submittedPrompt, featured);
    if (notFeatured) assert.doesNotMatch(submittedPrompt, notFeatured);
  }
});

test('features rebounds for a rebound double-double and points for other performances', async () => {
  const image = createRasterImageDataUrl('png');
  const generatedImage = createGeneratedJpegBuffer();
  const statsCases = [
    { pts: 12, reb: 10, ast: 2, label: 'REBOUNDS', value: 10 },
    { pts: 5, reb: 10, ast: 10, label: 'REBOUNDS', value: 10 },
    { pts: 17, reb: 9, ast: 2, label: 'POINTS', value: 17 },
    { pts: 18, reb: 10, ast: 2, label: 'POINTS', value: 18 },
  ];

  for (const stats of statsCases) {
    let prompt;
    await generateFlyerImage({
      player: {
        name: 'Marcus',
        jersey: '3',
        team: 'Team A',
        ...stats,
      },
      game: {
        teamA: { name: 'Red Team' },
        teamB: { name: 'Blue Team' },
      },
      playerImage: image,
      teamLogoImage: image,
      apiKey: 'test-key',
      fetchImplementation: async (_url, { body }) => {
        prompt = body.get('prompt');
        return {
          ok: true,
          async json() {
            return { data: [{ b64_json: generatedImage.toString('base64') }] };
          },
        };
      },
    });

    assert.match(prompt, new RegExp(
      `Display the exact featured stat as "${stats.label}" and the amount "${stats.value}"`,
    ));
  }
});

test('reports OpenAI API failures and missing generated image content', async () => {
  const playerImage = createRasterImageDataUrl('webp');
  const teamLogoImage = createRasterImageDataUrl('png');
  const args = {
    player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
    game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
    playerImage,
    teamLogoImage,
    apiKey: 'test-key',
  };

  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: false,
        status: 429,
        async json() {
          return { error: { type: 'rate_limit_error', message: 'rate limited' } };
        },
      }),
    }),
    /image-generation service returned HTTP 429/,
  );
  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: true,
        async json() {
          return { data: [] };
        },
      }),
    }),
    /image-generation service could not create a valid flyer image/,
  );
  await assert.rejects(
    generateFlyerImage({
      ...args,
      fetchImplementation: async () => ({
        ok: true,
        async json() {
          return { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] };
        },
      }),
    }),
    /image-generation service could not create a valid flyer image/,
  );
});

test('logs concise provider details for rejected image-generation requests', async () => {
  const playerImage = createRasterImageDataUrl('jpeg');
  const teamLogoImage = createRasterImageDataUrl('png');
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);

  try {
    await assert.rejects(
      generateFlyerImage({
        player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
        game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
        playerImage,
        teamLogoImage,
        apiKey: 'test-key',
        fetchImplementation: async () => ({
          ok: false,
          status: 400,
          async json() {
            return {
              error: {
                type: 'invalid_request_error',
                code: 'unsupported_value',
                message: 'Invalid image dimensions',
              },
            };
          },
        }),
      }),
      /image-generation service returned HTTP 400/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(loggedErrors, [[
    '[openai] Image generation request failed',
    {
      status: 400,
      type: 'invalid_request_error',
      code: 'unsupported_value',
      message: 'Invalid image dimensions',
    },
  ]]);
});

test('sends flyer, player, and team references for legacy player input', async () => {
  const image = createRasterImageDataUrl('webp');
  const generatedFlyer = createGeneratedJpegBuffer();
  let submittedFiles;

  await generateFlyerImage({
    player: { name: 'Marcus', jersey: '3', team: 'Team A', pts: 14, reb: 5, ast: 3 },
    game: { teamA: { name: 'Red Team' }, teamB: { name: 'Blue Team' } },
    playerImage: image,
    teamLogoImage: image,
    apiKey: 'test-key',
    fetchImplementation: async (_url, { body }) => {
      submittedFiles = body.getAll('image[]');
      return {
        ok: true,
        async json() {
          return { data: [{ b64_json: generatedFlyer.toString('base64') }] };
        },
      };
    },
  });

  assert.equal(submittedFiles.length, 3);
  assert.deepEqual(submittedFiles.map((file) => file.type), [
    'image/png',
    'image/webp',
    'image/webp',
  ]);
});
