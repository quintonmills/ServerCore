import {
  ImageGenerationError,
  validateGeneratedRasterImage,
  validateRasterImageDataUrl,
} from '../utils/rasterImage.js';

const apiUrl = 'https://api.openai.com/v1/images/edits';

function appendImage(form, image, filename) {
  form.append(
    'image[]',
    new Blob([image.buffer], { type: image.mimeType }),
    `${filename}.${image.extension}`,
  );
}

function buildPrompt(player, game, extraPrompt) {
  const teamName = player.team === 'Team A' ? game.teamA.name : game.teamB.name;
  const stats = [
    `POINTS: ${player.pts}`,
    `REBOUNDS: ${player.reb}`,
    `ASSISTS: ${player.ast}`,
    `STEALS: ${player.stl}`,
    `BLOCKS: ${player.blk}`,
    `TURNOVERS: ${player.to}`,
  ];
  const instructions = [
    'Generate one complete, finished basketball player stat flyer as a single portrait-format image, not a portrait to be placed in another template.',
    'Use the first reference image as the player identity and preserve their recognizable face, skin tone, hair, and build.',
    'Use the second reference image as the exact team logo reference. Reproduce the logo faithfully and do not invent another logo.',
    'Show the player prominently in a dynamic, photorealistic basketball pose wearing a uniform inspired by the team colors.',
    'Design a polished dark arena flyer with a near-black/navy background, high-contrast white type, restrained neon-lime accents, clean grid, generous spacing, and premium sports-poster art direction.',
    'Compose the entire flyer: put SCOREKINGS at the top, PLAYER STAT CARD as the subtitle, the player name and jersey near the portrait, team name and team logo together, the location beneath the player details, a matchup footer with both team names and final scores, and six clearly separated stat boxes.',
    `Player name, spelled exactly: ${player.name}. Jersey number: ${player.jersey}. Team: ${teamName}. Location: ${game.location}.`,
    `Display these exact stat labels and values without changing, omitting, duplicating, or adding any numbers: ${stats.join('; ')}.`,
    `Display the exact final matchup: ${game.teamA.name} ${game.teamA.score} - ${game.teamB.score} ${game.teamB.name}.`,
    'Make all requested text large, legible, correctly spelled, and easy to read. Do not add any other statistics or factual claims. Do not crop text, the player, or the team logo.',
    'Output only the finished flyer artwork with no mockup, no surrounding frame, no watermark, and no explanatory text.',
  ];

  if (extraPrompt) instructions.push(`Additional art direction: ${extraPrompt}`);
  return instructions.join(' ');
}

export async function generateFlyerImage({
  player,
  game,
  playerImage,
  teamLogoImage,
  imageGeneration = {},
  apiKey = process.env.OPENAI_API_KEY,
  fetchImplementation = fetch,
}) {
  if (!apiKey) {
    throw new ImageGenerationError('Image generation is not configured on the server.');
  }

  const [playerReference, teamLogoReference] = await Promise.all([
    validateRasterImageDataUrl(playerImage, 'Player photo'),
    validateRasterImageDataUrl(teamLogoImage, 'Team logo'),
  ]);

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', buildPrompt(player, game, imageGeneration.prompt));
  form.append('size', imageGeneration.size || '1024x1536');
  form.append('quality', imageGeneration.quality || 'high');
  form.append('input_fidelity', 'high');
  form.append('output_format', 'jpeg');
  appendImage(form, playerReference, 'player-reference');
  appendImage(form, teamLogoReference, 'team-logo-reference');

  let response;
  try {
    response = await fetchImplementation(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new ImageGenerationError();
  }
  if (!response.ok) {
    throw new ImageGenerationError(
      `The image-generation service returned HTTP ${response.status}.`,
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ImageGenerationError();
  }
  const encodedImage = result.data?.[0]?.b64_json;
  if (
    typeof encodedImage !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedImage)
  ) {
    throw new ImageGenerationError();
  }

  const flyerImage = Buffer.from(encodedImage, 'base64');
  await validateGeneratedRasterImage(flyerImage);
  return flyerImage;
}
