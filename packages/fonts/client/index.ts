import { Context, icons } from '@koishijs/client'

import icom from './icon.vue'
import layout from './layout.vue'
icons.register('fonts', icom)

export default (ctx: Context) => {
  ctx.page({
    name: '字体管理',
    path: '/fonts',
    icon: 'fonts',
    component: layout,
    fields: ['fonts'],
  })
}
