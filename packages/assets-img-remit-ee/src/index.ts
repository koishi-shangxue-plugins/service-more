import { Context, HTTP, Schema } from 'koishi';
import Assets from '@koishijs/assets';
import { } from '@koishijs/plugin-http';
import { extname } from 'node:path';

export const name = 'assets-img-remit-ee';

class RemitAssets extends Assets<RemitAssets.Config>
{
  types = ['image', 'img', "video"];
  http: HTTP;

  constructor(ctx: Context, config: RemitAssets.Config)
  {
    super(ctx, config);
    this.http = ctx.http.extend({
      endpoint: config.endpoint,
      headers: { accept: 'application/json' },
    });
    this.logInfo(`初始化完成，API地址: ${config.endpoint}`);
  }

  private logInfo(message: string)
  {
    if (this.config.loggerinfo)
    {
      this.ctx.logger('assets-img-remit-ee').info(message);
    }
  }

  private getUploadFilename(filename: string, type: string)
  {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
    };
    const expectedExt = extMap[type];
    const currentExt = extname(filename);

    if (!expectedExt || currentExt.toLowerCase() === expectedExt) return filename;

    // 临时修正后缀，绕过服务端的扩展名校验
    return currentExt ? filename.slice(0, -currentExt.length) + expectedExt : filename + expectedExt;
  }

  private getFileUrl(response: unknown)
  {
    if (!response || typeof response !== 'object') return null;
    const data = response as Record<string, unknown>;
    const url = data.url ?? data.directUrl ?? data.previewUrl;
    return typeof url === 'string' && url.length > 0 ? url : null;
  }

  async upload(url: string, file: string)
  {
    const { buffer, filename, type } = await this.analyze(url, file);
    const logger = this.ctx.logger('assets-img-remit-ee');

    try
    {
      const payload = new FormData();
      const uploadFilename = this.getUploadFilename(filename, type);
      payload.append('file', new Blob([new Uint8Array(buffer)], { type }), uploadFilename);

      this.logInfo(`开始上传文件: ${filename}, 类型: ${type}, 实际文件名: ${uploadFilename}`);

      const response = await this.http.post('/upload', payload);
      this.logInfo(`API响应: ${JSON.stringify(response)}`);

      if (response && typeof response === 'object')
      {
        const data = response as { success?: boolean; };
        const fileUrl = this.getFileUrl(response);

        if (data.success && fileUrl)
        {
          const fullUrl = new URL(fileUrl, this.config.baseUrl).toString();
          this.logInfo(`上传成功: ${fullUrl}`);
          return fullUrl;
        }
      }

      logger.error(`上传失败 - 响应格式异常: ${JSON.stringify(response)}`);
      throw new Error('上传失败：API响应格式异常');
    } catch (error)
    {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`上传失败: ${err.message}`);
      throw err;
    }
  }

  async stats()
  {
    return {};
  }
}

namespace RemitAssets
{
  export interface Config extends Assets.Config
  {
    endpoint: string;
    baseUrl: string;
    loggerinfo: boolean;
  }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      endpoint: Schema.string()
        .role('link')
        .description('API 服务器地址')
        .default('https://img.remit.ee/api')
        .disabled(),
      baseUrl: Schema.string()
        .role('link')
        .description('文件访问基础URL')
        .default('https://img.remit.ee')
        .disabled(),
      loggerinfo: Schema.boolean()
        .default(false)
        .description('日志调试开关')
        .experimental(),
    }),
    Assets.Config,
  ]);
}

export interface Config extends RemitAssets.Config { }

export const Config = RemitAssets.Config;

export function apply(ctx: Context, config: Config)
{
  ctx.plugin(RemitAssets, config);
}

export default RemitAssets;
