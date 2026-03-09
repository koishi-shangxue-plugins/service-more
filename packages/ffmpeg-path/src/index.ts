import { Context, Schema } from 'koishi';
import { access, constants, readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, delimiter, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { FFmpeg } from './ffmpeg';
import { DownloadTask } from './downloader';
import { SilkService } from './silk';
export * from './ffmpeg';
import registry from 'get-registry';

declare module 'koishi' {
  interface Context
  {
    silk?: SilkService;
  }
}

const platform = os.platform();
const arch = os.arch();

export const name = 'ffmpeg-path';
export const reusable = false;
export const filter = false;
export const inject = {
  required: ['logger'],
  implements: ['ffmpeg']
};

export const usage = `
---

<details>
<summary>Termux 相关 -- 环境配置</summary>

由于 Termux 的特殊文件系统结构，您需要手动指定 FFmpeg 的路径。请按照以下步骤操作：

1.  **安装 FFmpeg:** 在 Termux 中运行以下命令安装 FFmpeg：

    \`\`\`bash
    pkg install ffmpeg -y
    \`\`\`

2.  **查找 FFmpeg 路径:** 安装完成后，使用以下命令找到 FFmpeg 可执行文件的绝对路径：

    \`\`\`bash
    which ffmpeg
    \`\`\`

    通常，您会得到类似于 \`/data/data/com.termux/files/usr/bin/ffmpeg\` 的路径。

3.  **配置插件:** 在\`path\` 选项设置为您在上一步中找到的路径：

    \`/data/data/com.termux/files/usr/bin/ffmpeg\`

4.  **重载插件:** 保存配置文件并重载插件，以使配置生效。

</details>

---

### 其他平台

对于其他平台（Windows、macOS、Linux），支持自动检测环境变量和自动下载（无需额外安装 downloads 插件）。

如果您希望使用特定版本的 FFmpeg，您可以通过 \`path\` 选项手动指定路径，支持：
- 文件的绝对路径或相对路径
- 文件夹的绝对路径或相对路径（自动查找 ffmpeg 可执行文件）
- file:// URL 格式（可从浏览器地址栏复制）

---

### 自动检测 & 自动下载

如果您已经安装了 FFmpeg，并且配置好了环境变量，本插件会自动识别可执行文件的路径并使用。

如果您没有安装 FFmpeg，插件会自动下载 FFmpeg 到 \`./data/ffmpeg-path/ffmpeg\` 目录。

但是，请注意：

*   自动下载的 FFmpeg 可能不是最新版本。
*   在某些环境中，自动下载可能会失败。

---

### SILK 音频编码服务

启用 \`enableSilk\` 配置项后，插件会提供 SILK 音频编码服务，用于 QQ 官方平台的语音消息发送，无需额外安装 silk 插件。

---
`;

export interface Config
{
  loggerinfo: boolean;
  path?: string;
  autoDetect: boolean;
  autoDownload: boolean;
  enableSilk: boolean;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    autoDetect: Schema.boolean().default(true).description('自动检测环境变量中的 FFmpeg。'),
    autoDownload: Schema.boolean().default(true).description('找不到可执行文件时，自动下载 FFmpeg。'),
  }).description('FFmpeg 设置'),

  Schema.union([
    Schema.object({ autoDetect: Schema.const(true) }),
    Schema.object({
      autoDetect: Schema.const(false).required(),
      path: Schema.string().role('textarea', { rows: [2, 4] }).description('手动指定 ffmpeg 可执行文件的绝对路径'),
    }),
  ]),

  Schema.object({
    enableSilk: Schema.boolean().default(false).description('启用 SILK 音频编码服务（用于 QQ 语音消息）'),
  }).description('进阶设置'),

  Schema.object({
    loggerinfo: Schema.boolean().default(false).description('日志调试模式'),
  }).description('开发者选项'),
]);

export async function apply(ctx: Context, config: Config)
{
  let executable: string | null = null;
  let downloadTask: DownloadTask | null = null;
  const downloadPath = resolve(ctx.baseDir, 'data', 'ffmpeg-path', 'ffmpeg');

  ctx.on('ready', () =>
  {
    monitorAvailability();
  });

  // 在环境变量中查找 ffmpeg
  async function findExecutableInPath(): Promise<string | null>
  {
    if (!config.autoDetect) return null;

    const pathVar = process.env.PATH || '';
    const pathDirs = pathVar.split(delimiter);
    const executableNames = platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

    for (const dir of pathDirs)
    {
      for (const name of executableNames)
      {
        const fullPath = resolve(dir, name);
        const checkedPath = await checkPath(fullPath);
        if (checkedPath)
        {
          logInfo(`在环境变量中找到 ffmpeg: ${checkedPath}`);
          return checkedPath;
        }
      }
    }

    logInfo('在环境变量 PATH 中未找到有效的 ffmpeg 可执行文件。');
    return null;
  }

  // 持续监听可用性
  async function monitorAvailability()
  {
    logInfo(config);

    // 1. 检查用户指定的 path
    if (config.path)
    {
      const userPath = await checkPath(config.path);
      if (userPath)
      {
        executable = userPath;
        ctx.logger.info(`使用用户指定的 FFmpeg 路径: ${pathToFileURL(executable).href}`);
        startServices();
        return;
      }
    }

    // 2. 在环境变量中查找 ffmpeg
    const systemPathExecutable = await findExecutableInPath();
    if (systemPathExecutable)
    {
      executable = systemPathExecutable;
      ctx.logger.info(`在环境变量中找到 FFmpeg: ${pathToFileURL(executable).href}`);
      startServices();
      return;
    }

    // 3. 尝试 Termux 默认路径
    const termuxPath = await checkPath('/data/data/com.termux/files/usr/bin/ffmpeg');
    if (termuxPath)
    {
      executable = termuxPath;
      ctx.logger.info(`在 Termux 默认路径找到 FFmpeg: ${pathToFileURL(executable).href}`);
      startServices();
      return;
    }

    // 4. 尝试查找下载目录下的 ffmpeg
    const downloadsDirExecutable = await tryFindDownloadsDir();
    if (downloadsDirExecutable)
    {
      executable = downloadsDirExecutable;
      const relativeDir = relative(ctx.baseDir, downloadPath).replace(/\\/g, '/');
      const relativeFile = relative(ctx.baseDir, executable).replace(/\\/g, '/');
      ctx.logger.info(`使用 ./${relativeDir} 目录下的 FFmpeg 文件: ./${relativeFile}`);
      startServices();
      return;
    }

    // 5. 自动下载 FFmpeg
    if (config.autoDownload)
    {
      const downloadedExecutable = await tryDownloadFFmpeg();
      if (downloadedExecutable)
      {
        executable = downloadedExecutable;
        startServices();
        return;
      }
    }

    ctx.logger.error('无法找到可用的 FFmpeg 可执行文件。插件启动失败。');
  }

  function logInfo(...args: any[])
  {
    if (config.loggerinfo)
    {
      (ctx.logger.info as (...args: any[]) => void)(...args);
    }
  }

  // 检查指定的 path 是否可用（支持文件或文件夹，绝对或相对路径，以及 file:// URL）
  async function checkPath(path: string): Promise<string | null>
  {
    if (!path) return null;

    // 如果是 file:// URL，转换为普通路径
    let normalPath = path;
    if (path.startsWith('file:///') || path.startsWith('file://'))
    {
      try
      {
        normalPath = fileURLToPath(path);
      } catch (error)
      {
        ctx.logger.warn(`无法解析 file:// URL: ${path}`);
        return null;
      }
    }

    // 解析为绝对路径
    const absolutePath = resolve(ctx.baseDir, normalPath);

    if (!existsSync(absolutePath))
    {
      return null;
    }

    try
    {
      const stats = await stat(absolutePath);

      // 如果是文件，检查是否可执行
      if (stats.isFile())
      {
        await access(absolutePath, constants.F_OK | constants.X_OK);
        return absolutePath;
      }

      // 如果是文件夹，查找 ffmpeg 可执行文件
      if (stats.isDirectory())
      {
        const ffmpegPath = resolve(absolutePath, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
        if (existsSync(ffmpegPath))
        {
          const ffmpegStats = await stat(ffmpegPath);
          if (ffmpegStats.isFile())
          {
            await access(ffmpegPath, constants.F_OK | constants.X_OK);
            return ffmpegPath;
          }
        }
      }

      return null;
    } catch (error)
    {
      return null;
    }
  }

  // 尝试查找目录下的 ffmpeg
  async function tryFindDownloadsDir(): Promise<string | null>
  {
    const dirsToCheck = [
      './downloads',  // downloads 插件使用的目录
      downloadPath,  // data/ffmpeg-path/ffmpeg
    ];

    for (const dir of dirsToCheck)
    {
      if (!existsSync(dir)) continue;

      try
      {
        const files = await readdir(dir);
        for (const file of files)
        {
          const fullPath = resolve(dir, file);
          const stats = await stat(fullPath);
          if (stats.isDirectory())
          {
            const ffmpegPath = resolve(fullPath, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
            const checkedPath = await checkPath(ffmpegPath);
            if (checkedPath)
            {
              return checkedPath;
            }
          }
        }
      } catch (error)
      {
        ctx.logger.warn(`查找 ${dir} 目录下的 FFmpeg 失败: `, error);
      }
    }

    return null;
  }

  // 下载 FFmpeg
  async function tryDownloadFFmpeg(): Promise<string | null>
  {
    try
    {
      await mkdir(downloadPath, { recursive: true });

      downloadTask = new DownloadTask(
        ctx,
        [`npm://@koishijs-assets/ffmpeg?registry=${await registry()}`],
        bucket(),
        { output: downloadPath }
      );

      await downloadTask.start();
      const path = await downloadTask.promise;
      const executablePath = platform === 'win32' ? `${path}/ffmpeg.exe` : `${path}/ffmpeg`;

      return executablePath;
    } catch (error)
    {
      ctx.logger.error('下载 FFmpeg 失败: ', error);
      return null;
    }
  }

  // 启动服务
  function startServices()
  {
    if (executable)
    {
      ctx.plugin(FFmpeg, executable);

      // 如果启用 SILK 服务
      if (config.enableSilk)
      {
        ctx.plugin(SilkService);
      }
    }
  }

  // 清理下载任务
  ctx.on('dispose', () =>
  {
    if (downloadTask)
    {
      downloadTask.cancel();
    }
  });
}

function bucket()
{
  let bucket = 'ffmpeg-';
  switch (platform)
  {
    case 'win32':
      bucket += 'windows-';
      break;
    case 'linux':
      bucket += 'linux-';
      break;
    case 'darwin':
      bucket += 'macos-';
      break;
    default:
      throw new Error(`不支持的平台: ${platform}`);
  }
  switch (arch as string)
  {
    case 'arm':
      bucket += 'armel';
      break;
    case 'arm64':
      bucket += 'arm64';
      break;
    case 'x86':
    case 'ia32':
      bucket += 'i686';
      break;
    case 'x64':
      bucket += 'amd64';
      break;
    default:
      throw new Error(`不支持的架构: ${arch}`);
  }
  return bucket;
}
