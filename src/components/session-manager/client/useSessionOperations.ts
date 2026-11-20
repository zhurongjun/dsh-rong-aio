import { useCallback, useEffect, useRef, useState } from 'react'
import { API, type Action, type BatchResult, type SessionRow } from '../shared/protocol.ts'
import { createSelection } from './selection.ts'

export const actionLabels = { archive: '归档', restore: '复原', delete: '删除' }

async function request<T>(signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(API.slice(1), {
    signal,
    cache: 'no-store',
    ...(body && {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '无法读取会话管理接口')
  return data
}

export function useSessionOperations(refreshSidebar: () => Promise<void>) {
  const [selection] = useState(createSelection)
  const [rows, setRows] = useState<SessionRow[]>([])
  const [busy, setBusy] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<SessionRow[]>([])
  const [notice, setNotice] = useState<{ text: string; toast?: boolean }>()
  const [errors, setErrors] = useState<string[]>([])
  const running = useRef(false)
  const lifetime = useRef<AbortController | null>(null)

  const reload = useCallback(
    async (signal: AbortSignal, syncSidebar: boolean) => {
      const list = request<SessionRow[]>(signal).then((data) => {
        if (!signal.aborted) setRows(data)
      })
      const results = await Promise.allSettled([list, syncSidebar && refreshSidebar()])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    },
    [refreshSidebar],
  )

  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current?.signal
    if (running.current || !signal) return
    running.current = true
    setBusy(true)
    setErrors([])
    setNotice(undefined)
    try {
      await task(signal)
    } catch (error) {
      if (!signal.aborted) setErrors((previous) => [...previous, String(error)])
    } finally {
      if (!signal.aborted) {
        running.current = false
        setBusy(false)
      }
    }
  }, [])

  const refresh = useCallback(
    () =>
      run(async (signal) => {
        selection.replace([])
        await reload(signal, true)
      }),
    [run, reload, selection],
  )

  useEffect(() => {
    lifetime.current = new AbortController()
    void refresh()
    return () => {
      lifetime.current?.abort()
      lifetime.current = null
      running.current = false
    }
  }, [refresh])

  const perform = useCallback(
    (action: Action, items: SessionRow[]) =>
      run(async (signal) => {
        setPendingDelete([])
        const { outcomes, warning } = await request<BatchResult>(signal, {
          action,
          targets: items.map(({ id, createdAt }) => ({ id, createdAt })),
          ...(action === 'delete' && { confirmed: true }),
        })
        if (signal.aborted) return
        const failed = outcomes.filter((result) => result.error)
        const titles = new Map(items.map((row) => [row.id, row.title]))
        const messages = failed.map(
          (result) => (titles.get(result.id) ?? result.id) + '：' + result.error,
        )
        if (warning) messages.push(warning)
        setErrors(messages)
        const succeeded = outcomes.length - failed.length
        if (succeeded || action !== 'delete')
          setNotice({
            text: `已${actionLabels[action]} ${succeeded} 个会话`,
            toast: action === 'delete',
          })
        selection.replace(failed.map((result) => result.id))
        await reload(signal, action === 'delete' && succeeded > 0)
      }),
    [run, selection, reload],
  )

  const onAction = useCallback(
    (action: Action, items: SessionRow[]) => {
      if (running.current || !items.length) return
      if (action === 'delete') setPendingDelete(items)
      else void perform(action, items)
    },
    [perform],
  )

  const openDirectory = useCallback(async ({ id, createdAt }: SessionRow) => {
    const signal = lifetime.current?.signal
    if (signal) await request(signal, { action: 'open-directory', target: { id, createdAt } })
  }, [])

  const feedback = useCallback((text: string, failed = false) => {
    if (!lifetime.current) return
    if (failed) setErrors([text])
    else {
      setErrors([])
      setNotice({ text })
    }
  }, [])

  return {
    rows,
    selection,
    busy,
    refresh,
    onAction,
    openDirectory,
    feedback,
    notice,
    errors,
    dismissNotice: () => setNotice(undefined),
    pendingDelete,
    cancelDelete: () => setPendingDelete([]),
    confirmDelete: () => {
      if (pendingDelete.length) void perform('delete', pendingDelete)
    },
  }
}
