import { createStore } from 'zustand/vanilla'
import type { SessionRow } from '../shared/protocol.ts'

// 选择属于当前设置页。行订阅自己的 ID，组头订阅三态，批量工具栏读取完整集合。
export function createSelection() {
  const store = createStore<ReadonlySet<string>>(() => new Set<string>())
  return {
    store,
    select(rows: readonly SessionRow[], checked: boolean) {
      const current = store.getState()
      const next = new Set(current)
      for (const { id } of rows) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      if (next.size !== current.size) store.setState(next, true)
    },
    replace(ids: readonly string[]) {
      if (ids.length || store.getState().size) store.setState(new Set(ids), true)
    },
  }
}

export type SessionSelection = ReturnType<typeof createSelection>
