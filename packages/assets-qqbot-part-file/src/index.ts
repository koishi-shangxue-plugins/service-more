import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { Context, Schema } from 'koishi';
import Assets from '@koishijs/assets';
import { } from '@koishijs/plugin-http';

export const name = 'assets-qqbot-part-file';

const QQ_API = 'https://api.sgroup.qq.com';
const QQ_TOKEN_API = 'https://bots.qq.com/app/getAppAccessToken';
const MAX_SIZE = 30 * 1024 * 1024;

interface AccessTokenResponse
{
  access_token?: string;
  expires_in?: number;
}

interface UploadPartInfo
{
  index: number;
  presigned_url: string;
  block_size: number | string;
}

interface UploadPrepareResult
{
  upload_id?: string;
  block_size?: number | string;
  parts?: UploadPartInfo[];
}

interface UploadFinishResult
{
  file_uuid?: string;
  file_info?: string;
  ttl?: number;
  id?: string;
  raw_url?: string;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/tiff': '.tif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
};

class QQBotPartFileAssets extends Assets<QQBotPartFileAssets.Config>
{
  types = ['image', 'img', 'audio', 'video'];

  private readonly api = this.ctx.http.extend({
    endpoint: QQ_API,
    headers: {
      accept: 'application/json',
      Authorization: '',
    },
  });

  private token = '';
  private tokenExpiresAt = 0;
  private refreshing: Promise<string> | null = null;

  constructor(ctx: Context, config: QQBotPartFileAssets.Config)
  {
    super(ctx, config);
  }

  private debug(...args: string[])
  {
    if (!this.config.debug) return;
    this.ctx.logger(name).info(args.join(' '));
  }

  private fail(message: string, error?: unknown): never
  {
    if (error instanceof Error)
    {
      this.ctx.logger(name).error(`${message}: ${error.message}`);
    } else if (typeof error !== 'undefined')
    {
      this.ctx.logger(name).error(`${message}: ${this.describe(error)}`);
    } else
    {
      this.ctx.logger(name).error(message);
    }
    throw error instanceof Error ? error : new Error(message);
  }

  private describe(value: unknown)
  {
    if (typeof value === 'string') return value;
    try
    {
      return JSON.stringify(value);
    } catch
    {
      return String(value);
    }
  }

  private getClientSecret()
  {
    const secret = this.config.appSecret;
    if (!secret)
    {
      throw new Error('缺少 QQ 机器人的 clientSecret');
    }
    return secret;
  }

  private async getAccessToken()
  {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshAccessToken();
    try
    {
      return await this.refreshing;
    } finally
    {
      this.refreshing = null;
    }
  }

  private async refreshAccessToken()
  {
    const response = await this.ctx.http.post(QQ_TOKEN_API, {
      appId: this.config.appid,
      clientSecret: this.getClientSecret(),
    }) as AccessTokenResponse;

    const token = response?.access_token;
    if (!token)
    {
      throw new Error(`QQ 获取 access_token 失败: ${this.describe(response)}`);
    }

    this.token = token;
    const expiresIn = Number(response.expires_in || 7200);
    this.tokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
    this.api.config.headers.Authorization = `QQBot ${token}`;
    return token;
  }

  private sniffMime(buffer: Buffer)
  {
    if (buffer.length >= 8)
    {
      if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      ) return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    {
      return 'image/jpeg';
    }

    if (buffer.length >= 6)
    {
      const head = buffer.subarray(0, 6).toString('ascii');
      if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
    }

    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
    {
      return 'image/webp';
    }

    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE')
    {
      return 'audio/wav';
    }

    if (buffer.length >= 4)
    {
      const head = buffer.subarray(0, 4).toString('ascii');
      if (head === 'fLaC') return 'audio/flac';
      if (head === 'OggS') return 'audio/ogg';
      if (head === 'ftyp' || (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'))
      {
        const brand = buffer.length >= 12 ? buffer.subarray(8, 12).toString('ascii').toLowerCase() : '';
        return brand.includes('qt') ? 'video/quicktime' : 'video/mp4';
      }
    }

    if (buffer.length >= 4)
    {
      const head = buffer.subarray(0, 4).toString('hex');
      if (head === '1a45dfa3') return 'video/webm';
    }

    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d)
    {
      return 'image/bmp';
    }

    if (buffer.length >= 4)
    {
      const le = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
      const be = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
      if (le || be) return 'image/tiff';
    }

    return undefined;
  }

  private mimeFromFilename(filename: string)
  {
    const ext = extname(filename).toLowerCase();
    switch (ext)
    {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.bmp':
        return 'image/bmp';
      case '.tif':
      case '.tiff':
        return 'image/tiff';
      case '.svg':
        return 'image/svg+xml';
      case '.mp4':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      case '.mov':
        return 'video/quicktime';
      case '.mp3':
      case '.m4a':
      case '.aac':
        return 'audio/mpeg';
      case '.wav':
        return 'audio/wav';
      case '.ogg':
        return 'audio/ogg';
      case '.flac':
        return 'audio/flac';
      default:
        return undefined;
    }
  }

  private resolveMime(buffer: Buffer, filename: string, declaredType?: string)
  {
    const sniffed = this.sniffMime(buffer);
    if (sniffed) return sniffed;

    const normalized = declaredType?.trim().toLowerCase();
    if (normalized && normalized !== 'application/octet-stream') return normalized;

    return this.mimeFromFilename(filename);
  }

  private resolveFileType(filename: string, mime?: string)
  {
    const lowerMime = mime?.toLowerCase();
    if (lowerMime?.startsWith('image/')) return 1;
    if (lowerMime?.startsWith('video/')) return 2;
    if (lowerMime?.startsWith('audio/')) return 3;

    const lowerName = filename.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(lowerName)) return 1;
    if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lowerName)) return 2;
    if (/\.(silk|mp3|wav|ogg|m4a|aac|flac)$/.test(lowerName)) return 3;
    return 4;
  }

  private resolveUploadFilename(filename: string, mime?: string)
  {
    const ext = mime ? MIME_TO_EXT[mime.toLowerCase()] : undefined;
    if (!ext) return filename;

    const currentExt = extname(filename);
    if (!currentExt) return `${filename}${ext}`;
    if (currentExt.toLowerCase() === ext) return filename;
    return `${filename.slice(0, -currentExt.length)}${ext}`;
  }

  private buildPublicUrl(rawUrl: string, mime?: string)
  {
    const normalized = mime?.trim().toLowerCase();
    if (!normalized) return rawUrl;

    try
    {
      const url = new URL(rawUrl);
      url.searchParams.set('response-content-type', normalized);
      return url.toString();
    } catch
    {
      return rawUrl;
    }
  }

  async upload(url: string, file: string)
  {
    const { buffer, filename, type } = await this.analyze(url, file);
    const mime = this.resolveMime(buffer, filename, type);
    const uploadFilename = this.resolveUploadFilename(filename, mime);
    const fileType = this.resolveFileType(uploadFilename, mime);

    if (buffer.byteLength > MAX_SIZE)
    {
      throw new Error('QQ 分片上传当前仅支持 30MB 以内的文件');
    }

    await this.getAccessToken();

    const prepare = await this.api.post(`/v2/groups/${this.config.groupId}/upload_prepare`, {
      file_type: fileType,
      file_size: buffer.byteLength,
      file_name: uploadFilename,
      md5: createHash('md5').update(buffer).digest('hex'),
      sha1: createHash('sha1').update(buffer).digest('hex'),
    }) as UploadPrepareResult;

    const uploadId = prepare?.upload_id;
    const parts = [...(prepare?.parts || [])].sort((a, b) => a.index - b.index);
    const blockSize = Number(prepare?.block_size || 0);

    if (!uploadId || !parts.length || !blockSize)
    {
      throw new Error(`QQ upload_prepare 返回异常: ${this.describe(prepare)}`);
    }

    this.debug(`开始上传 ${filename} -> ${uploadFilename}`, `mime=${mime || 'unknown'}`, `parts=${parts.length}`);

    for (const part of parts)
    {
      const size = Number(part.block_size || blockSize);
      const start = (part.index - 1) * blockSize;
      const chunk = buffer.subarray(start, start + size);

      await this.ctx.http.put(part.presigned_url, chunk, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });

      await this.api.post(`/v2/groups/${this.config.groupId}/upload_part_finish`, {
        upload_id: uploadId,
        part_index: part.index,
        block_size: String(chunk.length),
        md5: createHash('md5').update(chunk).digest('hex'),
      });

      this.debug(`part_${part.index} uploaded`, this.buildPublicUrl(part.presigned_url, mime));
    }

    const merged = await this.api.post(`/v2/groups/${this.config.groupId}/files`, {
      file_type: fileType,
      srv_send_msg: false,
      file_name: uploadFilename,
      upload_id: uploadId,
    }) as UploadFinishResult;

    const rawUrl = merged?.raw_url;
    if (!rawUrl)
    {
      throw new Error(`QQ 分片上传完成后未返回 raw_url: ${this.describe(merged)}`);
    }

    const finalUrl = this.buildPublicUrl(rawUrl, mime);
    this.debug(`uploaded ${filename} -> ${finalUrl}`);
    return finalUrl;
  }

  async stats()
  {
    return {};
  }
}

namespace QQBotPartFileAssets
{
  export interface Config extends Assets.Config
  {
    appid: string;
    appSecret: string;
    groupId: string;
    debug: boolean;
  }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      appid: Schema.string()
        .description('QQ 机器人 AppID')
        .required(),
      appSecret: Schema.string()
        .description('QQ 机器人 AppSecret')
        .role('secret')
        .required(),
      groupId: Schema.string()
        .description('用于上传文件的群 OpenID<br>请使用inspect指令查看群组openId，任意QQ群组即可')
        .required(),
      debug: Schema.boolean()
        .default(false)
        .description('开启后输出调试日志')
        .experimental(),
    }),
    Assets.Config,
  ]);
}

export interface Config extends QQBotPartFileAssets.Config { }

export const Config = QQBotPartFileAssets.Config;

export function apply(ctx: Context, config: Config)
{
  ctx.plugin(QQBotPartFileAssets, config);
}

export default QQBotPartFileAssets;
