/** 客户端接入：复用宿主模型目录，在模型插槽挂载选择器并托管样式生命周期。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ModelSelector } from './model-selector/ModelSelector.tsx'
import css from './model-selector/styles.css'

export const inject = ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']

/** 注册模型输入框插槽与样式；模型目录由宿主管理，组件只委托读取与提交。 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-rong-aio'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, 'rong-aio: selector styles')

  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -100,
        inject: (sessionId): ModelSelectInjected => {
          const directory = ctx.modelDirectories.directoryFor(sessionId)
          const available = ctx.sessions.subagentAddress(sessionId) === undefined
          return {
            available,
            directory: directory.store,
            load: () => {
              // ModelDirectory 将加载错误写入共享 store，组件提供重试入口。
              if (available) void directory.load().catch(() => {})
            },
            select: (selection) =>
              available ? directory.select(selection) : Promise.resolve(undefined),
          }
        },
      },
      ModelSelector,
    ),
  )
}
