import { resolve } from 'path'

import { Context } from 'koishi'

import { Config } from './config'
import { Fonts, Provider } from './font'

import type {} from '@koishijs/console'

export { Fonts, Provider, Config }

export const name = 'fonts'

export const inject = {
  required: ['database'],
  optional: ['console'],
}

declare module 'koishi' {
  interface Context {
    fonts: Fonts
  }

  interface Tables {
    fonts: Fonts.Font
  }

  interface Events {
    // TODO: Add event invocation methods
    // 'fonts/register'(name: string, paths: string[]): void
    // 'fonts/delete'(name: string, fonts: Fonts.Font[]): void
  }
}

declare module '@koishijs/console' {
  namespace Console {
    interface Services {
      fonts: Provider
    }
  }

  interface Events {
    'fonts/delete'(name: string, fonts: Fonts.Font[]): void
    'fonts/download'(name: string, url: string[]): void
    'fonts/cancel'(name: string, url: string[]): void
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.plugin(Fonts, config)
  // ctx.console.addListener('fonts/register', this.fonts.register)

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })
}
