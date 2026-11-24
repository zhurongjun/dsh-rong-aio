/** 会话管理操作状态机：订阅激活时加载目录并托管 AbortController，操作统一经由 store 方法驱动。 */

import { createStore } from 'zustand/vanilla'
import { requestJson } from '../../../client/http.ts'
import { withLifecycle } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import { API, type Action, type BatchResult, type SessionRow } from '../shared/protocol.ts'

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

export const actionLabels = { archive: '归档', restore: '复原', delete: '删除' }

function request<T>(signal: AbortSignal, body?: object): Promise<T> {
  return requestJson<T>(API.slice(1), {
    ...(body ? { method: 'POST', body } : {}),
    signal,
    fallbackError: '无法读取会话管理接口',
  })
}

interface OperationsState {
  rows: SessionRow[]
  busy: boolean
  pendingDelete: SessionRow[]
  notice?: { text: string; toast?: boolean }
  errors: string[]
}

export function createSessionOperationsStore(refreshSidebar: () => Promise<void>) {
  const store = createStore<OperationsState>(() => ({
    rows: [],
    busy: true,
    pendingDelete: [],
    errors: [],
  }))
  const selection = createSelection()
  let running = false
  let lifetime: AbortController | null = null

  async function reload(signal: AbortSignal, syncSidebar: boolean) {
    const list = request<SessionRow[]>(signal).then((data) => {
      if (!signal.aborted) store.setState({ rows: data })
    })
    const results = await Promise.allSettled([list, syncSidebar && refreshSidebar()])
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime?.signal
    if (running || !signal) return
    running = true
    store.setState({ busy: true, errors: [], notice: undefined })
    try {
      await task(signal)
    } catch (error) {
      if (!signal.aborted) {
        store.setState((previous) => ({ errors: [...previous.errors, errorMessage(error)] }))
      }
    } finally {
      if (!signal.aborted) {
        running = false
        store.setState({ busy: false })
      }
    }
  }

  const refresh = () =>
    run(async (signal) => {
      selection.replace([])
      await reload(signal, true)
    })

  const perform = (action: Action, items: SessionRow[]) =>
    run(async (signal) => {
      const { outcomes, warning } = await request<BatchResult>(signal, {
        action,
        targets: items.map(({ id, createdAt }) => ({ id, createdAt })),
        ...(action === 'delete' && { confirmed: true }),
      })
      if (signal.aborted) return
      store.setState({ pendingDelete: [] })
      const failed = outcomes.filter((result) => result.error)
      const titles = new Map(items.map((row) => [row.id, row.title]))
      const messages = failed.map(
        (result) => (titles.get(result.id) ?? result.id) + '：' + result.error,
      )
      if (warning) messages.push(warning)
      const succeeded = outcomes.length - failed.length
      store.setState({
        errors: messages,
        ...(succeeded || action !== 'delete'
          ? {
              notice: {
                text: `已${actionLabels[action]} ${succeeded} 个会话`,
                toast: action === 'delete',
              },
            }
          : {}),
      })
      selection.replace(failed.map((result) => result.id))
      await reload(signal, action === 'delete' && succeeded > 0)
    })

  const api = Object.assign(store, {
    selection,
    refresh,
    onAction(action: Action, items: SessionRow[]) {
      if (running || !items.length) return
      if (action === 'delete') store.setState({ pendingDelete: items })
      else void perform(action, items)
    },
    async openDirectory({ id, createdAt }: SessionRow) {
      const signal = lifetime?.signal
      if (signal) await request(signal, { action: 'open-directory', target: { id, createdAt } })
    },
    feedback(text: string, failed = false) {
      if (!lifetime) return
      if (failed) store.setState({ errors: [text] })
      else store.setState({ errors: [], notice: { text } })
    },
    dismissNotice: () => store.setState({ notice: undefined }),
    cancelDelete: () => store.setState({ pendingDelete: [] }),
    confirmDelete: () => {
      const pendingDelete = store.getState().pendingDelete
      if (pendingDelete.length) void perform('delete', pendingDelete)
    },
  })

  return withLifecycle(api, () => {
    lifetime = new AbortController()
    void refresh()
    return () => {
      lifetime?.abort()
      lifetime = null
      running = false
    }
  })
}
