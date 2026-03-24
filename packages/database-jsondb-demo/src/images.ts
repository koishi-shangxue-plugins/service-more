import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { IMAGE_DIR, IMAGE_EXTENSIONS } from './constants';

export interface ImageSource
{
  fileName: string;
  filePath: string;
}

export interface EncodedImage
{
  fileName: string;
  base64: string;
  rawSize: number;
  base64Size: number;
}

// 读取图片目录
export async function listImages()
{
  const entries = await fs.readdir(IMAGE_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .filter(entry => IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map<ImageSource>(entry => ({
      fileName: entry.name,
      filePath: join(IMAGE_DIR, entry.name),
    }));
}

// 随机读取一张图片并编码
export async function readRandomImage(images: readonly ImageSource[])
{
  const selected = images[Math.floor(Math.random() * images.length)];
  const buffer = await fs.readFile(selected.filePath);
  const base64 = buffer.toString('base64');
  return {
    fileName: selected.fileName,
    base64,
    rawSize: buffer.byteLength,
    base64Size: Buffer.byteLength(base64, 'utf8'),
  } satisfies EncodedImage;
}

// 格式化字节数
export function formatSize(size: number)
{
  return `${(size / 1024 / 1024).toFixed(2)}MB`;
}
