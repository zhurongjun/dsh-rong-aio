import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isSideSession } from '../../../shared/side-session.ts'
import type { SideRow } from '../shared/protocol.ts'
import { loadHistory } from './api.ts'
import type { SideTabs } from './tabs.ts'

// The popup renders order, title and pending status. tabKey identifies which tab to focus.
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

export function useSideHistory(tabs: SideTabs, parent: SessionId, open: boolean) {
  const [rows, setRows] = useState<SideRow[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
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
            setRows((previous) => (sameRows(previous, rows) ? previous : rows))
            setError('')
          }
        } catch (err) {
          if (!signal.aborted && !dirty) setError(String(err))
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
  }, [tabs, parent, open])
  return { rows, error }
}
