import { Context, Schema, Service } from 'koishi'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, extname, basename } from 'node:path'

export const name = 'fonts'

export const inject = {
  required: [],
  optional: []
}

// 支持的字体格式
const SUPPORTED_FORMATS = ['.ttf', '.otf', '.woff', '.woff2'] as const

// 在模块加载时同步读取字体列表（用于生成 Schema）
function loadFontSchemaOptions(): Schema<string, string>[] {
  try {
    // 注意：这里使用相对路径，假设字体在 data/fonts 目录
    // 实际路径需要根据 Koishi 的运行目录调整
    const fontRoot = resolve(process.cwd(), 'data/fonts')
    const files = readdirSync(fontRoot)

    const fontOptions: Schema<string, string>[] = []

    for (const file of files) {
      const ext = extname(file).toLowerCase()

      // 只处理支持的字体格式
      if (!SUPPORTED_FORMATS.includes(ext as any)) {
        continue
      }

      const filePath = resolve(fontRoot, file)
      const fileStats = statSync(filePath)

      // 跳过目录
      if (fileStats.isDirectory()) {
        continue
      }

      // 获取字体名称（不含扩展名）
      const fontName = basename(file, ext)
      const format = ext.slice(1)
      const sizeKB = (fileStats.size / 1024).toFixed(2)

      fontOptions.push(
        Schema.const(fontName).description(`${fontName} (${format}, ${sizeKB} KB)`)
      )
    }

    // 如果没有字体，添加一个默认选项
    if (fontOptions.length === 0) {
      fontOptions.push(Schema.const('').description('无可用字体（请将字体文件放入 data/fonts 目录）'))
    }

    return fontOptions
  } catch (err) {
    // 如果读取失败（例如目录不存在），返回默认选项
    return [Schema.const('').description('无可用字体（请将字体文件放入 data/fonts 目录）')]
  }
}

// 在模块加载时生成字体选项
const fontSchemaOptions = loadFontSchemaOptions()

// 导出字体选项供其他插件使用
export { fontSchemaOptions as fontlist }

// 字体信息接口
interface FontInfo {
  name: string        // 字体文件名（不含扩展名）
  dataUrl: string     // Base64 Data URL
  format: string      // 字体格式
  size: number        // 文件大小（字节）
}

// 声明 fonts 服务
declare module 'koishi' {
  interface Context {
    fonts: FontsService
  }
}

// Fonts 服务类
export class FontsService extends Service {
  private fontMap: Map<string, FontInfo> = new Map()
  private fontRoot: string

  constructor(ctx: Context, public config: FontsService.Config) {
    super(ctx, 'fonts', true)
    this.fontRoot = resolve(ctx.baseDir, config.root)
  }

  async start() {
    // 加载字体文件
    await this.loadFonts()

    this.ctx.logger.info(`已加载 ${this.fontMap.size} 个字体文件`)
  }

  // 加载字体目录中的所有字体文件
  private async loadFonts() {
    try {
      const files = await readdir(this.fontRoot)

      for (const file of files) {
        const ext = extname(file).toLowerCase()

        // 只处理支持的字体格式
        if (!SUPPORTED_FORMATS.includes(ext as any)) {
          continue
        }

        const filePath = resolve(this.fontRoot, file)
        const fileStats = await stat(filePath)

        // 跳过目录
        if (fileStats.isDirectory()) {
          continue
        }

        try {
          // 读取字体文件
          const buffer = await readFile(filePath)

          // 转换为 Base64 Data URL
          const base64 = buffer.toString('base64')
          const mimeType = this.getMimeType(ext)
          const dataUrl = `data:${mimeType};base64,${base64}`

          // 获取字体名称（不含扩展名）
          const fontName = basename(file, ext)

          // 存储字体信息
          const fontInfo: FontInfo = {
            name: fontName,
            dataUrl,
            format: ext.slice(1), // 去掉开头的点
            size: fileStats.size
          }

          this.fontMap.set(fontName, fontInfo)

          this.ctx.logger.info(`已加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`)
        } catch (err) {
          this.ctx.logger.warn(`加载字体文件失败: ${file}`, err)
        }
      }
    } catch (err) {
      this.ctx.logger.error(`读取字体目录失败: ${this.fontRoot}`, err)
    }
  }

  // 获取字体的 MIME 类型
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2'
    }
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream'
  }

  // 获取字体信息（可选的辅助方法）
  getFontInfo(name: string): FontInfo | undefined {
    return this.fontMap.get(name)
  }

  // 获取所有字体名称列表
  getFontNames(): string[] {
    return Array.from(this.fontMap.keys())
  }

  // 根据名称获取字体 Data URL
  getFontDataUrl(name: string): string | undefined {
    return this.fontMap.get(name)?.dataUrl
  }
}

export namespace FontsService {
  export interface Config {
    root: string
    testFont: string  // 测试配置项
  }

  export const Config: Schema<Config> = Schema.object({
    root: Schema.path({
      filters: ['directory'],
      allowCreate: true,
    })
      .default('data/fonts')
      .description('存放字体文件的目录路径'),

    testFont: Schema.union(fontSchemaOptions)
      .description('测试：选择字体（用于验证静态配置项是否工作）')
  })
}

// 导出配置
export const Config = FontsService.Config

// 应用插件
export function apply(ctx: Context, config: FontsService.Config) {
  // 注册 fonts 服务
  ctx.plugin(FontsService, config)

  // 测试：打印选中的字体
  // 如果没有选择字体，使用第一个可用字体
  const selectedFont = config.testFont || ctx.fonts?.getFontNames()[0]

  if (selectedFont) {
    ctx.logger.info('测试配置项 testFont 的值:', selectedFont)

    // 通过服务获取字体 Data URL
    const fontDataUrl = ctx.fonts?.getFontDataUrl(selectedFont)
    if (fontDataUrl) {
      ctx.logger.info('字体 Data URL 长度:', fontDataUrl.length)
    } else {
      ctx.logger.warn('未找到字体:', selectedFont)
    }
  }
}
