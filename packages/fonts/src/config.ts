import { z } from 'koishi'

export const Config: z<Config> = z.object({
  root: z
    .path({
      filters: ['directory'],
      allowCreate: true,
    })
    .default('data/fonts')
    .description('存放字体的目录。'),
})

export interface Config {
  root: string
}
