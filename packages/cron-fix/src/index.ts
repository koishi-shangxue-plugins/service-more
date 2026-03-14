import { Context, Disposable, Schema } from 'koishi';
import { CronExpression, CronExpressionParser } from 'cron-parser';

export const name = 'cron-fix';
export const inject = {
  implements: ['cron'] as const,
};

export type CronCallback = () => void | Promise<void>;

export type Cron = (this: Context, input: string, callback: CronCallback) => () => void;

declare module 'koishi' {
  interface Context
  {
    cron(input: string, callback: () => void): () => void;
  }
}

export interface Config
{ }

export const Config: Schema<Config> = Schema.object({}).description('基础设置');

function formatLogValue(value: unknown)
{
  if (value instanceof Error)
  {
    return value.stack ?? value.message;
  }

  if (typeof value === 'string')
  {
    return value;
  }

  try
  {
    return JSON.stringify(value);
  } catch
  {
    return String(value);
  }
}

class CronTask
{
  private timer?: Disposable;
  private disposed = false;

  constructor(
    private readonly caller: Context,
    private readonly input: string,
    private readonly expr: CronExpression,
    private readonly callback: CronCallback,
    private readonly logInfo: (...args: unknown[]) => void,
  )
  {
    this.scheduleNext();
  }

  // 按 cron 表达式持续调度下一次执行。
  private scheduleNext()
  {
    if (this.disposed) return;

    const delay = Math.max(this.expr.next().getTime() - Date.now(), 0);
    this.timer = this.caller.setTimeout(async () =>
    {
      this.timer = undefined;
      if (this.disposed) return;

      this.scheduleNext();
      try
      {
        await this.callback();
      } catch (error)
      {
        this.logInfo('计划任务执行失败：', this.input, error);
      }
    }, delay);

    this.logInfo('已调度下一次计划任务：', this.input, `${delay}ms`);
  }

  dispose()
  {
    if (this.disposed) return;
    this.disposed = true;
    this.timer?.();
    this.timer = undefined;
    this.logInfo('已释放计划任务：', this.input);
  }
}

export function apply(ctx: Context)
{
  const logger = ctx.logger(name);

  function logInfo(...args: unknown[])
  {
    logger.info(args.map(formatLogValue).join(' '));
  }

  function cronProxy(this: Context, input: string, callback: CronCallback)
  {
    const caller = this ?? ctx;

    // 在创建阶段直接校验表达式，避免把错误延迟到运行期。
    const task = new CronTask(
      caller,
      input,
      CronExpressionParser.parse(input),
      callback,
      logInfo,
    );

    logInfo('已创建计划任务：', input);
    return caller.collect('cron', () =>
    {
      task.dispose();
    });
  }

  ctx.set('cron', cronProxy);
  logInfo('已注册独立 cron 服务。');
}
