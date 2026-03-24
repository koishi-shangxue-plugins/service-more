export const IMAGE_DIR = 'D:/Pictures/meme';

export const TABLE_NAMES = [
  'dbjson_demo_a',
  'dbjson_demo_b',
  'dbjson_demo_c',
] as const;

export const TARGET_BYTES_PER_TABLE = 5 * 1024 * 1024;

export const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
]);
