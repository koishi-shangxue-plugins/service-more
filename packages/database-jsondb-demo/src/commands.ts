import { Context } from 'koishi';
import { TABLE_NAMES, TARGET_BYTES_PER_TABLE } from './constants';
import { formatSize, listImages, readRandomImage } from './images';
import type { Config } from './index';

interface DemoRow
{
  id: number;
  seq: number;
  fileName: string;
  base64: string;
  rawSize: number;
  base64Size: number;
  createdAt: Date;
}

// 注册测试命令
export function registerCommands(ctx: Context, config: Config)
{
  const logger = ctx.logger('database-jsondb-demo');

  ctx.command('dbjson-demo.run', '向 3 个测试表写入随机图片 base64 数据')
    .action(async ({ session }) =>
    {
      const images = await listImages();
      if (!images.length)
      {
        return `目录 ${TABLE_NAMES.length ? 'D:/Pictures/meme' : ''} 下没有可用图片。`;
      }

      for (const table of TABLE_NAMES)
      {
        await ctx.database.remove(table, {});
      }

      const summary: string[] = [];

      for (const table of TABLE_NAMES)
      {
        let totalBytes = 0;
        let seq = 0;

        while (totalBytes < TARGET_BYTES_PER_TABLE)
        {
          seq += 1;
          const image = await readRandomImage(images);

          await ctx.database.create(table, {
            seq,
            fileName: image.fileName,
            base64: image.base64,
            rawSize: image.rawSize,
            base64Size: image.base64Size,
            createdAt: new Date(),
          } satisfies Omit<DemoRow, 'id'>);

          totalBytes += image.base64Size;

          if (config.debug)
          {
            logger.debug('[%s] 第 %s 行，累计 %s', table, seq, formatSize(totalBytes));
          }
        }

        summary.push(`${table}: ${seq} 行，${formatSize(totalBytes)}`);

        if (session)
        {
          await session.send(`${table} 写入完成：${seq} 行，${formatSize(totalBytes)}`);
        }
      }

      return [
        '写入完成。',
        ...summary,
        '现在去查看 data/database/jsondb/ 目录，确认每个表已经切成多个分片文件。',
      ].join('\n');
    });

  ctx.command('dbjson-demo.status', '查看测试表写入结果')
    .action(async () =>
    {
      const lines: string[] = [];

      for (const table of TABLE_NAMES)
      {
        const rows = await ctx.database.get(table, {}) as DemoRow[];
        const totalBase64 = rows.reduce((sum, row) => sum + row.base64Size, 0);
        const totalRaw = rows.reduce((sum, row) => sum + row.rawSize, 0);
        lines.push(`${table}: ${rows.length} 行，base64=${formatSize(totalBase64)}，raw=${formatSize(totalRaw)}`);
      }

      return lines.join('\n');
    });

  ctx.command('dbjson-demo.clean', '清空测试表数据')
    .action(async () =>
    {
      for (const table of TABLE_NAMES)
      {
        await ctx.database.remove(table, {});
      }

      return '已清空 dbjson_demo_a / dbjson_demo_b / dbjson_demo_c';
    });
}
