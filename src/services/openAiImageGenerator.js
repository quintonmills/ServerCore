import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InvalidImageAssetError,
  ImageGenerationError,
  validateGeneratedRasterImage,
  validateRasterImageDataUrl,
} from '../utils/rasterImage.js';
import { evaluateGraphicTier } from '../utils/evaluateGraphicTier.js';

const apiUrl = 'https://api.openai.com/v1/images/edits';
const defaultImageModel = 'gpt-image-2.5-sunburst';
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

function buildPrompt(player, game, extraPrompt, playerImageCount, tier) {
  const teamName = player.team === 'Team A' ? game.teamA.name : game.teamB.name;
  const isReboundDoubleDouble =
    player.reb >= 10 &&
    player.pts < 18 &&
    (player.pts >= 10 || player.ast >= 10);
  const featuredStat = isReboundDoubleDouble
    ? { label: 'REBOUNDS', value: player.reb }
    : { label: 'POINTS', value: player.pts };
  const instructions = [
    'Create one complete, original portrait-format basketball achievement flyer as finished artwork.',
    `Keep the established baseline composition: one prominent head-and-shoulders player portrait and a clear hierarchy for player name, jersey number, team, and the featured ${featuredStat.label.toLowerCase()} stat, with all content fully inside the portrait canvas. Preserve this composition across themes; tier styling changes visual treatment only.`,
    'Reference image 1 is the supplied flyer example and the primary visual art-direction reference. Draw from its gritty monochrome sports-editorial texture, torn-paper layering, bold condensed typography, dramatic contrast, and energetic collage treatment, while adapting the composition to the fixed baseline hierarchy and selected tier theme. Do not copy its text, numbers, athlete, face, uniform, pose, logos, slogans, or exact layout.',
    `Reference images 2 through ${playerImageCount + 1} show the same featured player. Use them only to accurately identify that person; preserve their recognizable face, skin tone, hair, and natural appearance without inferring or changing their gender or body type. Create exactly one prominent, realistic head-and-shoulders portrait of this player. Keep the image framed at the head and shoulders; do not depict a full body, invent body details or poses, or add duplicate portraits or extra people.`,
    `Reference image ${playerImageCount + 2} is the supplied team logo. Use it faithfully and derive the uniform/accent color palette from this logo, not from the flyer example.`,
    `If a uniform is visible within the head-and-shoulders crop, use the team colors. Player name, spelled exactly: ${player.name}. Jersey number: ${player.jersey}. Team name, spelled exactly: ${teamName}.`,
    `Display the exact featured stat as "${featuredStat.label}" and the amount "${featuredStat.value}". This is the only statistic to include; do not substitute points or another stat.`,
    'Include only the player name, jersey number, team name, and the single featured stat as factual text. Do not add any other statistics, location, opponents, scores, slogans, signatures, or unprovided facts. Do not copy any text or numbers from the flyer example, and do not add textual watermarks or brand marks other than the supplied team logo.',
    'Use strong, readable typography with every requested word and number spelled and rendered exactly once. Keep the portrait and all required text fully inside the image.',
    'Output only the finished flyer artwork with no mockup, external frame, or explanatory text.',
  ];

  if (extraPrompt) {
    instructions.push(`Optional additional art direction, if compatible with the fixed player details and design constraints: ${extraPrompt}`);
  }

  if (tier === 3) {
    instructions.push(
      'Apply the TIER 3 "King of the Court" luxury theme over the fixed baseline composition: use an obsidian/metallic slate canvas (#050505), chrome-and-gold gradient text fills, subtle non-text crown watermark motifs in the background, and magazine-cover-style dynamic border breaks. Do not change the composition or add factual copy.',
    );
  } else if (tier === 2) {
    instructions.push(
      'Apply the TIER 2 "En Fuego" dark-mode theme over the fixed baseline composition: add electric neon-lime (#CCFF00) diagonal geometric slash accents, dynamic motion-blur highlights around the player photo cutout, and one clearly legible badge with the exact text "STAT BREAKOUT". Do not change the composition or add other statistics.',
    );
  } else {
    instructions.push(
      'Apply the TIER 1 standard-run theme: preserve the baseline composition with clean neutral lighting, standard high-contrast dark text, and subtle grid lines. Do not add tier badges or decorative visual effects from higher tiers.',
    );
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

  const tier = evaluateGraphicTier(player);
  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL || defaultImageModel);
  form.append(
    'prompt',
    buildPrompt(player, game, imageGeneration.prompt, playerReferences.length, tier),
  );
  form.append('size', imageGeneration.size || '1024x1536');
  form.append('quality', imageGeneration.quality || 'high');
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
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      console.error('[openai] Could not parse the image-generation error response', {
        status: response.status,
      });
    }
    const providerError = errorBody?.error;
    const providerMessage =
      typeof providerError?.message === 'string'
        ? providerError.message.replace(/[\r\n]+/g, ' ').slice(0, 500)
        : undefined;
    console.error('[openai] Image generation request failed', {
      status: response.status,
      ...(typeof providerError?.type === 'string' ? { type: providerError.type } : {}),
      ...(typeof providerError?.code === 'string' ? { code: providerError.code } : {}),
      ...(providerMessage ? { message: providerMessage } : {}),
    });
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
