/** 原生插槽适配：从会话投影派生 Team 状态，远程能力缺失时仅隐藏 Team 入口。 */

import { useCallback } from 'react'
import { useStore, type StoreApi } from 'zustand'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-team/client'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import { ModelSelector } from './model-selector/ModelSelector.tsx'

export type TeamCommand = Context['remote']['agentTeams']['setEnabled']
export type TeamCapability = { setEnabled: TeamCommand } | undefined

export interface SelectorInjected extends Omit<ModelSelectInjected, 'resolveText'> {
  /** 只观察可选原生 Remote 的生命周期，不保存 Team 业务状态。 */
  teamCommands: StoreApi<{ capability: TeamCapability }>
}

/** 使用宿主标准 hooks，不另建会话投影或持久化库；两种子会话身份均不呈现开关。 */
export function ModelSelectorSlot(
  props: PropsRuntime<'conversation.input.model'> & SelectorInjected,
) {
  const capability = useStore(props.teamCommands, (state) => state.capability)
  const command = capability?.setEnabled
  const addressedChild = props.useSession((snapshot) => snapshot.subagent !== null)
  const listedChild = props.useSessions(
    (state) => state.byId[props.sessionId]?.origin === 'subagent',
  )
  const team = props.useProjection('agentTeam')
  const model = props.useProjection('modelSelection')
  const selectEnabled = useCallback(
    (enabled: boolean) => {
      if (!command) return Promise.reject(new Error('Agent Team 服务不可用'))
      return command(props.sessionId, enabled)
    },
    [command, props.sessionId],
  )
  return (
    <ModelSelector
      {...props}
      team={
        command && team && !addressedChild && !listedChild
          ? {
              enabled: team.enabled,
              ready: model !== undefined,
              needsConfirmation: model !== undefined && model.lastUsed !== null,
              selectEnabled,
            }
          : undefined
      }
    />
  )
}
