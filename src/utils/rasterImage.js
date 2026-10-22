const dataUrlPattern = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const maxImageBytes = 5 * 1024 * 1024;
const signatures = {
  'image/png': (buffer) =>
    buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (buffer) =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/webp': (buffer) =>
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP',
};

export class InvalidImageAssetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidImageAssetError';
    this.status = 400;
    this.code = 'INVALID_IMAGE_ASSET';
  }
}

export class ImageGenerationError extends Error {
  constructor(message = 'The image-generation service could not create a valid flyer image.') {
    super(message);
    this.name = 'ImageGenerationError';
    this.status = 502;
    this.code = 'IMAGE_GENERATION_FAILED';
  }
}

export function parseRasterImageDataUrl(dataUrl, fieldName = 'Image') {
  if (typeof dataUrl !== 'string') {
    throw new InvalidImageAssetError(`${fieldName} must be a PNG, JPEG, or WebP base64 data URL.`);
  }

  const match = dataUrlPattern.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) {
    throw new InvalidImageAssetError(`${fieldName} must be a PNG, JPEG, or WebP base64 data URL.`);
  }

  const [, mimeType, encodedImage] = match;
  const buffer = Buffer.from(encodedImage, 'base64');
  if (
    buffer.length === 0 ||
    buffer.length > maxImageBytes ||
    buffer.toString('base64') !== encodedImage
  ) {
    throw new InvalidImageAssetError(`${fieldName} contains invalid base64 data or exceeds the 5 MB limit.`);
  }
  if (!signatures[mimeType](buffer)) {
    throw new InvalidImageAssetError(`${fieldName} contents do not match the declared ${mimeType} format.`);
  }

  return { buffer, mimeType, extension: mimeType.slice('image/'.length) };
}

export function validateRasterImageDataUrl(dataUrl, fieldName) {
  return parseRasterImageDataUrl(dataUrl, fieldName);
}

export function validateGeneratedRasterImage(buffer) {
  const isJpeg = Buffer.isBuffer(buffer) && signatures['image/jpeg'](buffer);
  if (!isJpeg) {
    throw new ImageGenerationError();
  }
}
