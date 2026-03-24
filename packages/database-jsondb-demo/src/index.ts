import { Context, Schema } from 'koishi';
import { registerCommands } from './commands';
import { TABLE_NAMES } from './constants';

export const name = 'database-jsondb-demo';
export const inject = ['database'] as const;

export interface Config
{
  debug: boolean;
}

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

declare module 'koishi' {
  interface Tables
  {
    dbjson_demo_a: DemoRow;
    dbjson_demo_b: DemoRow;
    dbjson_demo_c: DemoRow;
  }
}

export const Config: Schema<Config> = Schema.object({
  debug: Schema.boolean().description('是否输出调试日志。').default(true),
});

export function apply(ctx: Context, config: Config)
{
  for (const table of TABLE_NAMES)
  {
    ctx.model.extend(table, {
      id: 'unsigned',
      seq: 'unsigned',
      fileName: 'string',
      base64: 'text',
      rawSize: 'unsigned',
      base64Size: 'unsigned',
      createdAt: 'timestamp',
    }, {
      autoInc: true,
    });
  }

  registerCommands(ctx, config);
}
