import { createHash } from 'node:crypto';
import { Context, Schema } from 'koishi';
import Assets from '@koishijs/assets';
import { } from '@koishijs/plugin-http';

export const name = 'assets-qqbot-part-file';

const QQ_API = 'https://api.sgroup.qq.com';
const QQ_TOKEN_API = 'https://bots.qq.com/app/getAppAccessToken';
const MAX_SIZE = 30 * 1024 * 1024;

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface UploadPartInfo {
  index: number;
  presigned_url: string;
  block_size: number | string;
}

interface UploadPrepareResult {
  upload_id?: string;
  block_size?: number | string;
  parts?: UploadPartInfo[];
}

interface UploadFinishResult {
  file_uuid?: string;
  file_info?: string;
  ttl?: number;
  id?: string;
  raw_url?: string;
}

class QQBotPartFileAssets extends Assets<QQBotPartFileAssets.Config> {
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

  constructor(ctx: Context, config: QQBotPartFileAssets.Config) {
    super(ctx, config);
  }

  private getClientSecret() {
    const secret = this.config.appSecret;
    if (!secret) {
      throw new Error('缺少 QQ 机器人 clientSecret');
    }
    return secret;
  }

  private async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshAccessToken();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async refreshAccessToken() {
    const response = await this.ctx.http.post(QQ_TOKEN_API, {
      appId: this.config.appid,
      clientSecret: this.getClientSecret(),
    }) as AccessTokenResponse;

    const token = response?.access_token;
    if (!token) {
      throw new Error(`QQ 获取 access_token 失败: ${JSON.stringify(response)}`);
    }

    this.token = token;
    const expiresIn = Number(response.expires_in || 7200);
    this.tokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
    this.api.config.headers.Authorization = `QQBot ${token}`;
    return token;
  }

  private resolveFileType(filename: string, mime = '') {
    const lowerMime = mime.toLowerCase();
    if (lowerMime.startsWith('image/')) return 1;
    if (lowerMime.startsWith('video/')) return 2;
    if (lowerMime.startsWith('audio/')) return 3;

    const lowerName = filename.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(lowerName)) return 1;
    if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lowerName)) return 2;
    if (/\.(silk|mp3|wav|ogg|m4a|aac|flac)$/.test(lowerName)) return 3;
    return 4;
  }

  private buildPublicUrl(rawUrl: string, mime?: string) {
    const url = new URL(rawUrl);
    if (mime?.startsWith('image/')) {
      url.searchParams.set('response-content-type', 'image/jpeg');
    }
    return url.toString();
  }

  async upload(url: string, file: string) {
    const logger = this.ctx.logger('assets-qqbot-part-file');
    const { buffer, filename, type } = await this.analyze(url, file);
    const fileType = this.resolveFileType(filename, type);

    if (buffer.byteLength > MAX_SIZE) {
      throw new Error('QQ 分片上传当前仅支持 30MB 以内的文件');
    }

    await this.getAccessToken();

    const prepare = await this.api.post(`/v2/groups/${this.config.groupId}/upload_prepare`, {
      file_type: fileType,
      file_size: buffer.byteLength,
      file_name: filename,
      md5: createHash('md5').update(buffer).digest('hex'),
      sha1: createHash('sha1').update(buffer).digest('hex'),
    }) as UploadPrepareResult;

    const uploadId = prepare?.upload_id;
    const parts = prepare?.parts || [];
    const blockSize = Number(prepare?.block_size || 0);

    if (!uploadId || !parts.length || !blockSize) {
      throw new Error(`QQ upload_prepare 返回异常: ${JSON.stringify(prepare)}`);
    }

    let finishResult: UploadFinishResult | undefined;
    for (const part of parts) {
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
    }

    const merged = await this.api.post(`/v2/groups/${this.config.groupId}/files`, {
      file_type: fileType,
      srv_send_msg: false,
      file_name: filename,
      upload_id: uploadId,
    }) as UploadFinishResult;

    const rawUrl = merged?.raw_url;
    if (!rawUrl) {
      throw new Error(`QQ 分片上传完成后未返回 raw_url: ${JSON.stringify(merged)}`);
    }

    const finalUrl = this.buildPublicUrl(rawUrl, type);
    logger.info(`uploaded ${filename} -> ${finalUrl}`);
    return finalUrl;
  }

  async stats() {
    return {};
  }
}

namespace QQBotPartFileAssets {
  export interface Config extends Assets.Config {
    appid: string;
    appSecret: string;
    groupId: string;
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
        .description('用于上传的群 OpenID')
        .required(),
    }),
    Assets.Config,
  ]);
}

export interface Config extends QQBotPartFileAssets.Config {}

export const Config = QQBotPartFileAssets.Config;

export function apply(ctx: Context, config: Config) {
  ctx.plugin(QQBotPartFileAssets, config);
}

export default QQBotPartFileAssets;
