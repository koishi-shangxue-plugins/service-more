import { Context, Service, defineProperty } from 'koishi';
import { encode, decode, isWav, getDuration, getWavFileInfo, isSilk } from 'silk-wasm';
import { Semaphore } from '@shopify/semaphore';
import { availableParallelism } from 'node:os';
import { Worker, MessageChannel, isMainThread, parentPort } from 'node:worker_threads';

interface WorkerInstance
{
  worker: Worker;
  busy: boolean;
}

interface Data
{
  type: string;
  params: [input: ArrayBufferView | ArrayBuffer, sampleRate: number];
}

// Worker 线程逻辑
if (!isMainThread && parentPort)
{
  parentPort.addListener('message', (e) =>
  {
    const data: Data = e.data;
    const port: MessagePort = e.port;
    switch (data.type)
    {
      case 'encode':
        encode(...data.params)
          .then(ret => port.postMessage(ret))
          .catch(err => port.postMessage(err))
          .finally(() => port.close());
        break;
      case 'decode':
        decode(...data.params)
          .then(ret => port.postMessage(ret))
          .catch(err => port.postMessage(err))
          .finally(() => port.close());
        break;
      default:
        port.postMessage(new Error('unsupported'));
        port.close();
    }
  });
}

// SILK 服务类
export class SilkService extends Service
{
  protected semaphore: Semaphore;
  protected workers: WorkerInstance[];
  protected workerUsed: number;

  constructor(ctx: Context)
  {
    super(ctx, 'silk', true);
    const maxThreads = Math.max(availableParallelism() - 1, 1);
    defineProperty(this, 'semaphore', new Semaphore(maxThreads));
    defineProperty(this, 'workers', []);
    defineProperty(this, 'workerUsed', 0);
  }

  // 编码为 SILK
  async encode(input: ArrayBufferView | ArrayBuffer, sampleRate: number)
  {
    const permit = await this.semaphore.acquire();
    return this.postMessage({ type: 'encode', params: [input, sampleRate] }).finally(() => permit.release());
  }

  // 解码 SILK 为 PCM
  async decode(input: ArrayBufferView | ArrayBuffer, sampleRate: number)
  {
    const permit = await this.semaphore.acquire();
    return this.postMessage({ type: 'decode', params: [input, sampleRate] }).finally(() => permit.release());
  }

  // 获取 SILK 音频时长
  getDuration(data: ArrayBufferView | ArrayBuffer, frameMs = 20)
  {
    return getDuration(data, frameMs);
  }

  // 检测是否为 WAV 文件
  isWav(data: ArrayBufferView | ArrayBuffer)
  {
    return isWav(data);
  }

  // 获取 WAV 文件信息
  getWavFileInfo(data: ArrayBufferView | ArrayBuffer)
  {
    return getWavFileInfo(data);
  }

  // 检测是否为 SILK 文件
  isSilk(data: ArrayBufferView | ArrayBuffer): boolean
  {
    return isSilk(data);
  }

  private postMessage(data: Data): Promise<any>
  {
    return new Promise((resolve, reject) =>
    {
      let indexing = 0;
      if (this.workers.length === 0)
      {
        this.workers.push({
          worker: new Worker(__filename),
          busy: false
        });
        this.workerUsed++;
      } else
      {
        let found = false;
        for (const [index, value] of this.workers.entries())
        {
          if (value?.busy === false)
          {
            indexing = index;
            found = true;
            break;
          }
        }
        if (!found)
        {
          const len = this.workers.push({
            worker: new Worker(__filename),
            busy: false
          });
          this.workerUsed++;
          indexing = len - 1;
        }
      }
      this.workers[indexing].busy = true;
      const { port1, port2 } = new MessageChannel();
      port2.once('message', async (ret) =>
      {
        if (this.workerUsed > 1)
        {
          this.workers[indexing].worker.terminate();
          delete this.workers[indexing];
          this.workerUsed--;
        } else
        {
          this.workers[indexing].busy = false;
        }
        ret instanceof Error ? reject(ret) : resolve(ret);
      });
      this.workers[indexing].worker.postMessage({ port: port1, data }, [port1]);
    });
  }
}
