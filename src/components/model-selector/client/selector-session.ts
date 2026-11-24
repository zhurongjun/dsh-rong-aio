/** 会话级选择器控制器：统一托管目录订阅、速度同步、Agent Team 与退出定时器生命周期。 */

import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createStore } from 'zustand/vanilla'
import { withLifecycle } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import { createSelectorStore } from './selector-store.ts'
import { createSpeedStore } from './speed-store.ts'

export interface TeamSelection {
  /** 原生 agentTeam 投影中的已保存值。 */
  enabled: boolean
  /** modelSelection 投影尚未就绪时不可修改。 */
  ready: boolean
  /** 原生 lastUsed 非空表示会话已使用模型，关闭前必须确认。 */
  needsConfirmation: boolean
  /** 绑定当前会话的原生 Remote；不调用选模或 Fast 接口。 */
  selectEnabled(enabled: boolean): Promise<RemoteResult<void>>
}

export interface TeamInteraction {
  pending: boolean
  confirming: boolean
  select(enabled: boolean): void
  confirm(): void
  cancel(): void
}

export interface TeamState {
  pending: boolean
  rawConfirming: boolean
}

/** 失败保留确认状态并报告 Toast；外部可通过 isMounted 门控避免卸载后回写错误。 */
export function createTeamStore(reportError: (message: string) => void, isMounted: () => boolean) {
  const store = createStore<TeamState>(() => ({ pending: false, rawConfirming: false }))
  let inFlight = false

  async function save(team: TeamSelection | undefined, locked: boolean, enabled: boolean) {
    if (!team?.ready || locked || inFlight) return
    inFlight = true
    store.setState({ pending: true })
    try {
      const result = await team.selectEnabled(enabled)
      if (!result.ok) throw new Error(result.error.message)
      if (isMounted()) store.setState({ rawConfirming: false })
    } catch (error) {
      if (isMounted()) reportError(`Agent Team 设置失败：${errorMessage(error, String(error))}`)
    } finally {
      inFlight = false
      if (isMounted()) store.setState({ pending: false })
    }
  }

  return Object.assign(store, {
    select(
      team: TeamSelection | undefined,
      locked: boolean,
      dismiss: () => void,
      enabled: boolean,
    ) {
      if (!team?.ready || locked || inFlight || enabled === team.enabled) return
      if (!enabled && team.needsConfirmation) {
        dismiss()
        store.setState({ rawConfirming: true })
      } else {
        void save(team, locked, enabled)
      }
    },
    confirm(team: TeamSelection | undefined, locked: boolean) {
      void save(team, locked, false)
    },
    cancel() {
      if (!inFlight) store.setState({ rawConfirming: false })
    },
  })
}

export function createSelectorSession(
  sessionId: string,
  directory: ModelSelectInjected['directory'],
) {
  let mounted = false
  let lastSpeedSync = ''

  const rawSelectorStore = createSelectorStore()
  const actions = rawSelectorStore.getState().actions
  const speedStore = createSpeedStore(actions.reportError)
  const teamStore = createTeamStore(actions.reportError, () => mounted)

  const syncSpeed = () => {
    const current = directory.getSnapshot().current
    const open = rawSelectorStore.getState().open
    const nextTuple = `${current?.provider ?? ''}\0${current?.model ?? ''}\0${open ? 1 : 0}`
    if (nextTuple === lastSpeedSync) return
    lastSpeedSync = nextTuple
    speedStore.sync(
      current ? { sessionId, provider: current.provider, model: current.model } : undefined,
      open,
    )
  }

  const selectorStore = withLifecycle(rawSelectorStore, () => {
    mounted = true
    syncSpeed()
    const stopDirectory = directory.subscribe(syncSpeed)
    const stopSelector = rawSelectorStore.subscribe(syncSpeed)
    return () => {
      mounted = false
      lastSpeedSync = ''
      stopDirectory()
      stopSelector()
      actions.dispose()
      speedStore.dispose()
    }
  })

  return {
    selectorStore,
    speedStore,
    teamStore,
    directorySource: {
      subscribe: (notify: () => void) => directory.subscribe(notify),
      getSnapshot: () => directory.getSnapshot(),
    },
    isMounted: () => mounted,
  }
}

export type SelectorSession = ReturnType<typeof createSelectorSession>
