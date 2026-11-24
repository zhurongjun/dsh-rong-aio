import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createStore } from 'zustand/vanilla'
import { mountStyle } from '../../../client/style.ts'
import { ModelSelectorSlot, type SelectorInjected, type TeamCapability } from './ModelSelector.tsx'
import css from './styles.css'

export const inject = ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']

export function apply(ctx: Context): void {
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
        if (teamCommands.getState().capability === capability) {
          teamCommands.setState({ capability: undefined })
        }
      }
    })
  })

  mountStyle(ctx, 'dsh-rong-aio', css)

  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -100,
        inject: (sessionId): SelectorInjected => {
          const directory = ctx.modelDirectories.directoryFor(sessionId)
          const available = ctx.sessions.subagentAddress(sessionId) === undefined
          return {
            teamCommands,
            available,
            directory: directory.store,
            load: () => {
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
