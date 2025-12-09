/**
 * 这是一个示例文件，展示其他插件如何使用 koishi-plugin-fonts
 * 
 * 使用方法：
 * 1. 在你的插件中安装 koishi-plugin-fonts
 * 2. 在配置 Schema 中使用 Schema.dynamic('font')
 * 3. 通过 config.font 直接获取字体的 Base64 Data URL
 */

import { Context, Schema } from 'koishi'

export const name = 'example-plugin'

// 不需要 inject fonts 服务，因为我们只使用动态配置项
export const inject = {
  required: [],
  optional: []
}

export interface Config {
  font: string  // 这里会是字体的 Base64 Data URL
  text: string
}

export const Config: Schema<Config> = Schema.object({
  // 使用 Schema.dynamic('font') 来获取字体列表
  // 用户在 UI 上会看到一个下拉框，包含所有可用的字体
  font: Schema.dynamic('font').description('选择要使用的字体'),

  text: Schema.string().default('Hello World').description('要渲染的文本')
})

export function apply(ctx: Context, config: Config) {
  ctx.command('test-font')
    .action(async ({ session }) => {
      // config.font 直接就是字体的 Base64 Data URL
      // 格式类似: data:font/ttf;base64,AAEAAAALAIAAAwAwT1M...

      ctx.logger.info('字体 Data URL:', config.font.substring(0, 50) + '...')

      // 你可以直接在 HTML/CSS 中使用这个 Data URL
      // 例如在生成图片时：
      const fontFace = `
        @font-face {
          font-family: 'CustomFont';
          src: url('${config.font}');
        }
      `

      // 或者在 Canvas 中使用
      // 或者传递给图片生成库等

      return `字体已加载，文本: ${config.text}`
    })
}