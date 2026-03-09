import { Context } from 'koishi';
import { ResolveOptions, sync, State } from 'nereid';
import { pathToFileURL } from 'node:url';

// 下载任务类
export class DownloadTask
{
  state: State;
  promise: Promise<string>;
  private resolve: (path: string) => void;

  constructor(
    private ctx: Context,
    private srcs: string[],
    private bucket: string,
    private options: ResolveOptions,
  )
  {
    this.promise = new Promise((resolve) => this.resolve = resolve);
  }

  async start()
  {
    const state = sync(this.srcs, this.bucket, this.options);

    state.on('check/start', () =>
    {
      this.ctx.logger.info('正在检查 FFmpeg');
    });

    state.on('check/failed', (error) =>
    {
      this.ctx.logger.warn('检查失败:', error.message);
    });

    state.on('download/start', () =>
    {
      this.ctx.logger.info('FFmpeg 开始下载');
    });

    state.on('download/failed', (error) =>
    {
      this.ctx.logger.error('下载失败:', error.message);
    });

    state.on('done', (path) =>
    {
      this.ctx.logger.success(`FFmpeg 下载成功: ${pathToFileURL(path).href}`);
      this.resolve(path);
    });

    this.state = state;
  }

  cancel()
  {
    if (!this.state || this.state.status === 'done') return;
    this.state.cancel();
  }
}
