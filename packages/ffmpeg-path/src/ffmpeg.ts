import { Context, Service } from 'koishi';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

declare module 'koishi' {
  interface Context
  {
    ffmpeg: FFmpeg;
  }
}

interface RunReturn
{
  file: Promise<void>;
  buffer: Promise<Buffer>;
  info: Promise<Buffer>;
  stream: Readable;
}

export class FFmpegBuilder
{
  _inputs: Array<string | Buffer | Readable> = [];
  inputOptions: string[] = [];
  outputOptions: string[] = [];
  constructor(public executable: string) { }

  input(path: string): FFmpegBuilder;
  input(buffer: Buffer): FFmpegBuilder;
  input(stream: Readable): FFmpegBuilder;
  input(arg: string | Buffer | Readable): FFmpegBuilder
  {
    this._inputs.push(arg);
    return this;
  }

  inputOption(...option: string[]): FFmpegBuilder
  {
    this.inputOptions.push(...option);
    return this;
  }

  outputOption(...option: string[]): FFmpegBuilder
  {
    this.outputOptions.push(...option);
    return this;
  }

  run<T extends keyof RunReturn>(type: T, path?: string): RunReturn[T]
  {
    const options: string[] = ['-y', ...this.inputOptions];
    const hasNonStringInput = this._inputs.some(i => typeof i !== 'string');

    for (const input of this._inputs)
    {
      options.push('-i', typeof input === 'string' ? input : '-');
    }

    if (type === 'file')
    {
      options.push(...[...this.outputOptions, path]);
    } else if (type !== 'info')
    {
      options.push(...[...this.outputOptions, '-']);
    }
    const child = spawn(this.executable, options, { stdio: 'pipe' });

    if (hasNonStringInput)
    {
      const firstNonString = this._inputs.find(i => typeof i !== 'string');
      if (firstNonString instanceof Buffer)
      {
        child.stdin.write(firstNonString);
        child.stdin.end();
      } else if (firstNonString instanceof Readable)
      {
        firstNonString.pipe(child.stdin);
      }
    }
    if (type === 'stream')
    {
      return child.stdout as any;
    } else
    {
      return new Promise<void | Buffer>((resolve, reject) =>
      {
        child.stdin.on('error', function (err)
        {
          if (!['ECONNRESET', 'EPIPE', 'EOF'].includes(err['code'])) reject(err);
        });
        child.on('error', reject);
        let stream: Readable;
        if (type === 'file')
        {
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exited with ${code}`)));
        } else if (type === 'buffer')
        {
          stream = child.stdout;
        } else if (type === 'info')
        {
          stream = child.stderr;
        }
        if (stream)
        {
          const buffer = [];
          stream.on('data', data => buffer.push(data));
          stream.on('end', () => resolve(Buffer.concat(buffer)));
          stream.on('error', reject);
        }
      }) as any;
    }
  }
}

export class FFmpeg extends Service
{
  constructor(ctx: Context, public executable: string)
  {
    super(ctx, 'ffmpeg');
  }

  builder()
  {
    return new FFmpegBuilder(this.executable);
  }
}
