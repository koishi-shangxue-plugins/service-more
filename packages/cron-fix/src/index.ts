import { Context, Disposable, Schema } from 'koishi';
import { CronExpression, CronExpressionParser } from 'cron-parser';

export const name = 'cron-fix';
export const inject = {
  implements: ['cron'] as const,
};
export const reusable = false;
export const filter = false;

export type CronCallback = () => void | Promise<void>;

export type Cron = (this: Context, input: string, callback: CronCallback) => () => void;

declare module 'koishi' {
  interface Context
  {
    cron(input: string, callback: () => void): () => void;
  }
}

export interface Config { }

export const Config: Schema<Config> = Schema.object({});

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

function attachServiceOwner<T extends object>(value: T, owner: Context)
{
  if (!Reflect.getOwnPropertyDescriptor(value, Context.current))
  {
    Object.defineProperty(value, Context.current, {
      value: owner,
      configurable: true,
    });
  }

  return value;
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
  }

  dispose()
  {
    if (this.disposed) return;
    this.disposed = true;
    this.timer?.();
    this.timer = undefined;
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

    const task = new CronTask(
      caller,
      input,
      CronExpressionParser.parse(input),
      callback,
      logInfo,
    );

    return caller.effect(() => () =>
    {
      task.dispose();
    });
  }

  attachServiceOwner(cronProxy, ctx);
  ctx.set('cron', cronProxy);
}
