import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRasterImageDataUrl,
  validateRasterImageDataUrl,
} from '../src/utils/rasterImage.js';
import { createRasterImageDataUrl } from './rasterImageFixtures.js';

test('decodes valid PNG, JPEG, and WebP data URLs as raster image bytes', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const dataUrl = createRasterImageDataUrl(format);
    const image = await validateRasterImageDataUrl(dataUrl, 'test image');

    assert.equal(image.mimeType, `image/${format}`);
    assert.equal(image.extension, format);
    assert.ok(image.buffer.length > 0);
    assert.equal(parseRasterImageDataUrl(dataUrl).buffer.toString('base64'), dataUrl.split(',')[1]);
  }
});

test('rejects malformed base64, unsupported MIME, and raster signature mismatches', async () => {
  const validJpeg = createRasterImageDataUrl('jpeg');

  assert.throws(
    () => parseRasterImageDataUrl('data:image/png;base64,not-base64!'),
    /must be a PNG, JPEG, or WebP base64 data URL/,
  );
  assert.throws(
    () => parseRasterImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='),
    /must be a PNG, JPEG, or WebP base64 data URL/,
  );
  assert.throws(
    () => parseRasterImageDataUrl(validJpeg.replace('image/jpeg', 'image/png')),
    /contents do not match the declared image\/png format/,
  );
  assert.throws(
    () => validateRasterImageDataUrl('data:image/png;base64,aGVsbG8=', 'Player photo'),
    /contents do not match the declared image\/png format/,
  );
});
