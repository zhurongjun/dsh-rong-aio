/** 侧聊历史订阅 store：列表展开订阅时启动加载与状态监听，收起卸载时自动中止。 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createStore } from 'zustand/vanilla'
import { withLifecycle } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import { isSideSession, type SideRow } from '../shared/protocol.ts'
import { loadHistory } from './store.ts'
import type { SideTabs } from './tabs.ts'

function sameRows(left: SideRow[] | undefined, right: SideRow[]) {
  return (
    left?.length === right.length &&
    left.every((row, i) => {
      const next = right[i]
      return (
        row.id === next.id &&
        row.title === next.title &&
        row.pending === next.pending &&
        row.tabKey === next.tabKey
      )
    })
  )
}

interface HistoryState {
  rows?: SideRow[]
  error: string
}

export function createSideHistoryStore(tabs: SideTabs, parent: SessionId) {
  const store = createStore<HistoryState>(() => ({ error: '' }))

  return withLifecycle(store, () => {
    const lifetime = new AbortController()
    const { signal } = lifetime
    let loading = false
    let dirty = false
    let known: Set<SessionId> | undefined

    async function refresh() {
      if (loading) {
        dirty = true
        return
      }
      loading = true
      do {
        dirty = false
        try {
          const { rows } = await loadHistory(parent, signal)
          if (signal.aborted) return
          known = new Set(rows.map((r) => r.id as SessionId))
          if (!dirty) {
            store.setState((previous) => ({
              rows: sameRows(previous.rows, rows) ? previous.rows : rows,
              error: '',
            }))
          }
        } catch (err) {
          if (!signal.aborted && !dirty) store.setState({ error: errorMessage(err) })
        }
      } while (dirty && !signal.aborted)
      loading = false
    }

    const status = tabs.sessionStatus
    let previous = status.getSnapshot()
    const stop = status.subscribe(() => {
      const current = status.getSnapshot()
      const changed =
        [...current].some(([id, state]) => {
          if (!isSideSession(id)) return false
          const before = previous.get(id)
          if (!before) return true
          return (
            (!known || known.has(id)) &&
            (before.running !== state.running ||
              before.pendingInteraction !== state.pendingInteraction)
          )
        }) || [...(known ?? [])].some((id) => previous.has(id) && !current.has(id))
      previous = current
      if (changed) void refresh()
    })

    tabs.historyChanges.addEventListener(parent, refresh, { signal })
    window.addEventListener('focus', refresh, { signal })
    void refresh()

    return () => {
      lifetime.abort()
      stop()
    }
  })
}

export type SideHistoryStore = ReturnType<typeof createSideHistoryStore>
