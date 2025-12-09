/**
 * 这是一个示例文件，展示其他插件如何使用 koishi-plugin-fonts
 *
 * 使用方法：
 * 1. 在你的插件中安装 koishi-plugin-fonts
 * 2. 导入 fontlist 并在 Schema 中使用
 * 3. 必须注入 fonts 服务才能获取字体 Data URL
 * 4. 通过 ctx.fonts.getFontDataUrl(config.font) 获取字体的 Base64 Data URL
 */

import { Context, Schema } from 'koishi'
import { fontlist } from 'koishi-plugin-fonts'
import { } from 'koishi-plugin-fonts'  // 导入类型声明

export const name = 'example-plugin'

// 必须注入 fonts 服务才能获取字体 Data URL
export const inject = {
  required: ['fonts']
}

export interface Config {
  font: string  // 这里存储的是字体名称（例如："NotoColorEmoji-Regular"）
  text: string
}

export const Config: Schema<Config> = Schema.object({
  // 使用 Schema.union(fontlist) 来获取字体列表
  // 用户在 UI 上会看到一个下拉框，包含所有可用的字体
  // 配置项的值是字体名称，不是 Data URL
  font: Schema.union(fontlist).description('选择要使用的字体'),

  text: Schema.string().default('Hello World').description('要渲染的文本')
})

export function apply(ctx: Context, config: Config) {
  ctx.command('test-font')
    .action(async ({ session }) => {
      // config.font 是字体名称，需要通过 fonts 服务获取 Data URL
      const fontDataUrl = ctx.fonts.getFontDataUrl(config.font)

      if (!fontDataUrl) {
        return `未找到字体: ${config.font}`
      }

      ctx.logger.info('选中的字体:', config.font)
      ctx.logger.info('字体 Data URL 长度:', fontDataUrl.length)

      // 现在可以在 HTML/CSS 中使用这个 Data URL
      // 例如在生成图片时：
      const fontFace = `
        @font-face {
          font-family: 'CustomFont';
          src: url('${fontDataUrl}');
        }
      `

      // 或者在 Canvas 中使用
      // 或者传递给图片生成库等

      return `字体已加载: ${config.font}，文本: ${config.text}`
    })
}