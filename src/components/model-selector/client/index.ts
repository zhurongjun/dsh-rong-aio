/** 客户端接入：复用宿主模型目录，在模型插槽挂载选择器并托管样式生命周期。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createStore } from 'zustand/vanilla'
import { mountStyle } from '../../../client/style.ts'
import { ModelSelectorSlot, type SelectorInjected, type TeamCapability } from './ModelSelector.tsx'
import css from './styles.css'

export const inject = ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']

/** 注册模型输入框插槽与样式；模型目录由宿主管理，组件只委托读取与提交。 */
export function apply(ctx: Context): void {
  // Team 是可选宿主能力，其卸载不能连带停用模型、effort 或 Fast。
  const teamCommands = createStore<{ capability: TeamCapability }>(() => ({
    capability: undefined,
  }))
  ctx.inject(['remote.agentTeams'], (scope) => {
    scope.effect(() => {
      const capability: NonNullable<TeamCapability> = {
        setEnabled: (sessionId, enabled, signal) =>
          scope.remote.agentTeams.setEnabled(sessionId, enabled, signal),
      }
      teamCommands.setState({ capability })
      return () => {
        if (teamCommands.getState().capability === capability)
          teamCommands.setState({ capability: undefined })
      }
    })
  })
  mountStyle(ctx, 'dsh-rong-aio', css)

  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -100,
        // 本选择器只消费目录名称，不呈现原生 badge，因而不需要 resolveText。
        inject: (sessionId): SelectorInjected => {
          const directory = ctx.modelDirectories.directoryFor(sessionId)
          const available = ctx.sessions.subagentAddress(sessionId) === undefined
          return {
            teamCommands,
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
      ModelSelectorSlot,
    ),
  )
}
