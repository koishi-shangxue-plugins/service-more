import { resolve } from 'path'

import { DataService } from '@koishijs/console'

import { Fonts } from './font'

import type { Context } from 'koishi'

export class Provider extends DataService<Provider.Payload> {
  downloads: Record<string, Provider.Download> = {}

  constructor(ctx: Context, private fonts: Fonts) {
    super(ctx, 'fonts')

    ctx.console.addEntry(
      process.env.KOISHI_BASE
        ? [process.env.KOISHI_BASE + '/dist/index.js', process.env.KOISHI_BASE + '/dist/style.css']
        : {
            dev: resolve(__dirname, '../client/index.ts'),
            prod: resolve(__dirname, '../dist'),
          },
    )

    ctx.console.addListener('fonts/delete', async (name, fonts) => {
      await this.fonts.delete(name, fonts)
      await this.refresh(true)
    })
    ctx.console.addListener('fonts/download', async (name, urls) => {
      const handle = {
        name,
        files: urls.map((url) => ({
          url,
          downloaded: 0,
          contentLength: 0,
          finished: false,
          cancel: false,
          cancelled: false,
          failure: false,
        })),
      }
      this.downloads[name] = handle
      this.fonts.download(handle)
      await this.refresh(true)
      const timer = setInterval(async () => {
        await this.refresh(true)

        // TODO: need a bettle handle when some are failure, some are finished
        if (handle.files.every((file) => file.failure)) {
          clearInterval(timer)
          delete this.downloads[name]
          await this.refresh(true)
        }
        if (
          handle.files
            .filter((file) => !file.failure)
            .every((file) => file.finished)
        ) {
          clearInterval(timer)
          setTimeout(async () => {
            delete this.downloads[name]
            await this.refresh(true)
          }, 2000)
        }
      }, 1000)
      Object.defineProperty(this.downloads[name], 'timer', { value: timer })
    })
    ctx.console.addListener('fonts/cancel', async (name, urls) => {
      ctx.logger.info('request cancel', name)
      this.downloads[name].files.forEach((file) => {
        if (urls.includes(file.url) || !urls.length) {
          file.cancel = true
        }
      })
      let count = 0
      const timer = setInterval(async () => {
        if (
          this.downloads[name].files
            .filter((file) => urls.includes(file.url) || !urls.length)
            .every((file) => file.cancelled)
        ) {
          ctx.logger.info('cancel success', name)
          clearInterval(timer)
          if (!urls.length) {
            clearInterval(this.downloads[name]['timer'])
            delete this.downloads[name]
          }
          else {
            this.downloads[name].files = this.downloads[name].files
              .filter((file) => !urls.includes(file.url))
          }
          await this.refresh(true)
        }
        else if (count > 5) {
          clearInterval(timer)
        }
        count++
      }, 1000)
    })
  }

  async get(): Promise<Provider.Payload> {
    return {
      downloads: this.downloads,
      fonts: await this.fonts.list(),
    }
  }
}

export namespace Provider {
  export interface Download {
    name: string
    files: {
      url: string
      downloaded: number
      contentLength: number
      finished: boolean
      cancel: boolean
      cancelled: boolean
      failure: boolean
      descriptors?: FontFaceDescriptors
    }[]
  }

  export interface Payload {
    fonts: Fonts.Font[]
    downloads?: Record<string, Download>
  }
}
