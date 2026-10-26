import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InvalidImageAssetError,
  ImageGenerationError,
  validateGeneratedRasterImage,
  validateRasterImageDataUrl,
} from '../utils/rasterImage.js';

const apiUrl = 'https://api.openai.com/v1/images/edits';
const defaultTemplatePath = fileURLToPath(
  new URL('../../assets/flyer-style-reference.png', import.meta.url),
);
const templateMimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function appendImage(form, image, filename) {
  form.append(
    'image[]',
    new Blob([image.buffer], { type: image.mimeType }),
    `${filename}.${image.extension}`,
  );
}

async function loadTemplateReference(templateImage) {
  if (templateImage) {
    return validateRasterImageDataUrl(templateImage, 'Flyer style reference');
  }
  const templatePath = process.env.FLYER_STYLE_REFERENCE_PATH || defaultTemplatePath;
  const mimeType = templateMimeTypes[path.extname(templatePath).toLowerCase()];
  if (!mimeType) {
    throw new ImageGenerationError('The flyer style reference must be a PNG, JPEG, or WebP image.');
  }
  let buffer;
  try {
    buffer = await readFile(templatePath);
  } catch {
    throw new ImageGenerationError('The configured flyer style reference could not be read.');
  }
  try {
    return validateRasterImageDataUrl(
      `data:${mimeType};base64,${buffer.toString('base64')}`,
      'Flyer style reference',
    );
  } catch (error) {
    if (!(error instanceof InvalidImageAssetError)) throw error;
    throw new ImageGenerationError('The configured flyer style reference is not a valid raster image.');
  }
}

function buildPrompt(player, game, extraPrompt, playerImageCount) {
  const teamName = player.team === 'Team A' ? game.teamA.name : game.teamB.name;
  const instructions = [
    'Create one complete, original portrait-format basketball achievement flyer as finished artwork.',
    'Reference image 1 is visual art-direction guidance only. Draw on broad qualities such as a light off-white paper field, gritty monochrome sports-editorial collage, tactile grain, layered torn-paper shapes, bold condensed typography, dramatic contrast, and a restrained team-color accent. Create a fresh composition; do not reproduce the reference layout, exact placement, wording, pictured athlete, uniform, logo, signature, slogans, or distinctive graphic marks.',
    playerImageCount === 3
      ? "Reference images 2, 3, and 4 show the same featured player from different views. Use each photo once to preserve the player's recognizable face, skin tone, hair, and build, and show that same player in three distinct depictions: one prominent dynamic full-body basketball pose and two smaller, lighter monochrome supporting cutouts integrated into the surrounding design. Do not substitute the athlete from the style reference or invent extra player depictions."
      : playerImageCount === 2
        ? "Reference images 2 and 3 show the same featured player from different views. Preserve the player's recognizable face, skin tone, hair, and build, and use the photos to create one prominent dynamic basketball depiction and one smaller supporting cutout of the same player."
        : 'Reference image 2 shows the featured player. Preserve their recognizable face, skin tone, hair, and build, and create one prominent dynamic basketball depiction with smaller supporting crops derived from this same player.',
    `Reference image ${playerImageCount + 2} is the supplied team logo. Use it faithfully and derive the uniform/accent color palette from this logo, not from the visual reference.`,
    `Feature the player in a uniform using the team colors. Player name, spelled exactly: ${player.name}. Jersey number: ${player.jersey}. Team name, spelled exactly: ${teamName}.`,
    `Display the exact points total: ${player.pts} POINTS. This is the only statistic to include.`,
    'Include only the player name, jersey number, team name, and points total as factual text. Do not add rebounds, assists, other statistics, location, opponents, scores, slogans, signatures, watermarks, or unprovided facts. Do not include brand marks other than the supplied team logo.',
    'Use strong, readable typography with every requested word and number spelled and rendered exactly once. Keep the player and all required text fully inside the image.',
    'Output only the finished flyer artwork with no mockup, external frame, or explanatory text.'
  ];

  if (extraPrompt) {
    instructions.push(`Optional additional art direction, if compatible with the fixed player details and design constraints: ${extraPrompt}`);
  }
  return instructions.join(' ');
}

export async function generateFlyerImage({
  player,
  game,
  playerImage,
  playerImages,
  templateImage,
  teamLogoImage,
  imageGeneration = {},
  apiKey = process.env.OPENAI_API_KEY,
  fetchImplementation = fetch,
}) {
  if (!apiKey) {
    throw new ImageGenerationError('Image generation is not configured on the server.');
  }

  const suppliedPlayerImages = playerImages || (playerImage ? [playerImage] : []);
  if (suppliedPlayerImages.length < 1 || suppliedPlayerImages.length > 3) {
    throw new ImageGenerationError('Provide between one and three player reference photos.');
  }

  const [playerReferences, teamLogoReference, templateReference] = await Promise.all([
    Promise.all(suppliedPlayerImages.map((image, index) =>
      validateRasterImageDataUrl(image, `Player photo ${index + 1}`),
    )),
    validateRasterImageDataUrl(teamLogoImage, 'Team logo'),
    loadTemplateReference(templateImage),
  ]);

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', buildPrompt(player, game, imageGeneration.prompt, playerReferences.length));
  form.append('size', imageGeneration.size || '1024x1536');
  form.append('quality', imageGeneration.quality || 'high');
  form.append('input_fidelity', 'high');
  form.append('output_format', 'jpeg');
  appendImage(form, templateReference, 'flyer-style-reference');
  playerReferences.forEach((reference, index) => {
    appendImage(form, reference, `player-reference-${index + 1}`);
  });
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
