import { Context, Dict, Logger, remove, Schema, Time } from 'koishi';
import { DataService } from '@koishijs/plugin-console';
import { resolve } from 'path';
import { mkdir, readdir, rm } from 'fs/promises';
import { FileWriter } from './file';
declare module '@koishijs/plugin-console' {
  namespace Console
  {
    interface Services
    {
      logs: DataService<Logger.Record[]>;
    }
  }
}

export const name = 'logger';

export const usage = `
---

方便地修改logger的设置~

灵感来自 https://forum.koishi.xyz/t/topic/6363

---
`;

class LogProvider extends DataService<Logger.Record[]>
{
  constructor(ctx: Context, private getWriter: () => FileWriter)
  {
    super(ctx, 'logs', { authority: 4 });

    ctx.console.addEntry(process.env.KOISHI_BASE ? [
      process.env.KOISHI_BASE + '/dist/index.js',
      process.env.KOISHI_BASE + '/dist/style.css',
    ] : process.env.KOISHI_ENV === 'browser' ? [

      resolve(__dirname, '../client/index.ts'),
    ] : {
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });
  }

  async get()
  {
    return this.getWriter()?.read();
  }
}

export interface Config
{
  root?: string;
  maxAge?: number;
  maxSize?: number;
  levels?: Dict<number>;
}

export const Config: Schema<Config> = Schema.object({
  root: Schema.path({
    filters: ['directory'],
    allowCreate: true,
  }).default('data/logs').description('存放输出日志的本地目录。'),
  maxAge: Schema.natural().description('日志文件保存的最大天数（天）。').default(30),
  maxSize: Schema.natural().description('单个日志文件的最大大小（字节）。').default(1024 * 100),
  levels: Schema.dict(Schema.natural().default(3)).description('指定模块的输出等级。<br>示例： 左侧写 `debug`，右侧写 `3`'),
});

export async function apply(ctx: Context, config: Config)
{
  let testInterval: NodeJS.Timeout | null = null;

  ctx.command('log-test', '压力测试日志输出')
    .action(async ({ session }) =>
    {
      if (testInterval)
      {
        clearInterval(testInterval);
        testInterval = null;
        return '日志压力测试已停止。';
      } else
      {
        let i = 0;
        testInterval = setInterval(() =>
        {
          const loggers = ['test', 'database', 'adapter-onebot', 'http-server', 'plugin-a', 'plugin-b'];
          const loggerName = loggers[i % loggers.length];
          ctx.logger(loggerName).info(`压力测试日志 #${i++} - 这是一个为了测试长文本而生成的随机字符串: ${Math.random().toString(36).substring(7)}`);
        }, 10);
        return '日志压力测试已开始。再次运行命令以停止。';
      }
    });

  const originalLevels: Dict<Logger.Level> = {};
  const customLevels = config.levels ?? {};

  // 特殊处理 debug 键，将其映射到 base 等级
  if ('debug' in customLevels)
  {
    originalLevels['base'] = Logger.levels.base;
    Logger.levels.base = customLevels['debug'];
  }

  // 备份并应用其他具名 logger 等级
  for (const name in customLevels)
  {
    // 跳过已经处理过的 debug 键
    if (name === 'debug') continue;
    originalLevels[name] = Logger.levels[name];
    Logger.levels[name] = customLevels[name];
  }

  const root = resolve(ctx.baseDir, config.root);
  await mkdir(root, { recursive: true });

  const files: Dict<number[]> = {};
  for (const filename of await readdir(root))
  {
    const capture = /^(\d{4}-\d{2}-\d{2})-(\d+)\.log$/.exec(filename);
    if (!capture) continue;
    files[capture[1]] ??= [];
    files[capture[1]].push(+capture[2]);
  }

  let writer: FileWriter;
  async function createFile(date: string, index: number)
  {
    writer = new FileWriter(date, `${root}/${date}-${index}.log`);

    const { maxAge } = config;
    if (!maxAge) return;

    const now = Date.now();
    for (const date of Object.keys(files))
    {
      if (now - +new Date(date) < maxAge * Time.day) continue;
      for (const index of files[date])
      {
        await rm(`${root}/${date}-${index}.log`).catch((error) =>
        {
          ctx.logger('logger').warn(error);
        });
      }
      delete files[date];
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  createFile(date, Math.max(...files[date] ?? [0]) + 1);

  let buffer: Logger.Record[] = [];
  const update = ctx.throttle(() =>
  {
    // Be very careful about accessing service in this callback,
    // because undeclared service access may cause infinite loop.
    ctx.get('console')?.patch('logs', buffer);
    buffer = [];
  }, 100);

  const loader = ctx.get('loader');
  const target: Logger.Target = {
    colors: 3,
    record: (record: Logger.Record) =>
    {
      record.meta ||= {};
      const scope = record.meta[Context.current]?.scope;
      if (loader && scope)
      {
        record.meta['paths'] = loader.paths(scope);
      }
      const date = new Date(record.timestamp).toISOString().slice(0, 10);
      if (writer.date !== date)
      {
        writer.close();
        files[date] = [1];
        createFile(date, 1);
      }
      writer.write(record);
      buffer.push(record);
      update();
      if (writer.size >= config.maxSize)
      {
        writer.close();
        const index = Math.max(...files[date] ?? [0]) + 1;
        files[date] ??= [];
        files[date].push(index);
        createFile(date, index);
      }
    },
  };

  Logger.targets.push(target);
  ctx.on('dispose', () =>
  {
    if (testInterval) clearInterval(testInterval);
    writer?.close();
    remove(Logger.targets, target);
    if (loader)
    {
      loader.prolog = [];
    }

    // 恢复所有被修改过的日志等级
    for (const name in originalLevels)
    {
      Logger.levels[name] = originalLevels[name];
    }
  });

  for (const record of loader?.prolog || [])
  {
    target.record(record);
  }

  ctx.plugin(LogProvider, () => writer);
}
