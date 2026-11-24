/** 会话级选择器控制器：统一托管目录订阅、速度同步、Team 与退出定时器生命周期。 */

import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { withLifecycle } from '../../../../client/store.ts'
import { createSelectorStore } from './selector-store.ts'
import { createSpeedStore } from './speed-store.ts'
import { createTeamStore } from './team-store.ts'

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
