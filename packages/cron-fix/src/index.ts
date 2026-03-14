import { Context, Logger, Schema } from 'koishi';

export const name = 'cron-fix';

const logger = new Logger(name);

export type CronCallback = () => void | Promise<void>;

export type Cron = (this: Context, input: string, callback: CronCallback) => () => void;

interface PendingTask
{
  caller: Context;
  input: string;
  callback: CronCallback;
  disposed: boolean;
  dispose?: () => void;
}

declare module 'koishi' {
  interface Context
  {
    cron(input: string, callback: () => void): () => void;
  }
}

export interface Config
{
  loggerinfo: boolean;
}

export const Config: Schema<Config> = Schema.object({
  loggerinfo: Schema.boolean().default(false).description('日志调试模式').experimental(),
}).description('基础设置');

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

export function apply(ctx: Context, config: Config)
{
  const pendingTasks = new Set<PendingTask>();
  let targetCron: Cron | null = null;
  let missingCronWarned = false;

  function debugLog(...args: unknown[])
  {
    if (!config.loggerinfo) return;
    logger.info(args.map(formatLogValue).join(' '));
  }

  function warnLog(...args: unknown[])
  {
    logger.warn(args.map(formatLogValue).join(' '));
  }

  function attachTask(task: PendingTask)
  {
    if (!targetCron || task.disposed)
    {
      pendingTasks.delete(task);
      return;
    }

    try
    {
      task.dispose = targetCron.call(task.caller, task.input, task.callback);
      debugLog('已补挂计划任务：', task.input);
    } catch (error)
    {
      warnLog('补挂计划任务失败：', task.input, error);
    } finally
    {
      pendingTasks.delete(task);
    }
  }

  function flushPendingTasks()
  {
    if (!targetCron || !pendingTasks.size) return;

    for (const task of [...pendingTasks])
    {
      attachTask(task);
    }
  }

  function cronProxy(this: Context, input: string, callback: CronCallback)
  {
    const caller = this ?? ctx;

    if (targetCron)
    {
      return targetCron.call(caller, input, callback);
    }

    const task: PendingTask = {
      caller,
      input,
      callback,
      disposed: false,
    };

    pendingTasks.add(task);
    debugLog('cron 服务尚未就绪，暂存计划任务：', input);

    return () =>
    {
      if (task.disposed) return;
      task.disposed = true;
      task.dispose?.();
      pendingTasks.delete(task);
      debugLog('已释放暂存计划任务：', input);
    };
  }

  ctx.set('cron', cronProxy);
  debugLog('已注册 cron 代理服务。');

  // 通过依赖注入等待真实 cron 服务，避免直接访问未注册属性。
  ctx.inject(['cron'], (injectCtx) =>
  {
    const detectedCron = injectCtx.cron as Cron;
    if (detectedCron === cronProxy || detectedCron === targetCron)
    {
      return;
    }

    targetCron = detectedCron;
    debugLog('已检测到原始 cron 服务实现，开始转发调用。');
    flushPendingTasks();
  });

  ctx.on('ready', () =>
  {
    if (!targetCron && !missingCronWarned)
    {
      missingCronWarned = true;
      warnLog('未检测到原始 cron 插件实现，cron-fix 仅完成了服务占位。');
    }
  });

  ctx.on('dispose', () =>
  {
    for (const task of pendingTasks)
    {
      task.disposed = true;
      task.dispose?.();
    }

    pendingTasks.clear();
    debugLog('cron-fix 已完成资源释放。');
  });
}
