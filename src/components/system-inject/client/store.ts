import { createStore } from 'zustand/vanilla'
import { requestConditionalJson, requestJson } from '../../../client/http.ts'
import { createAbortScope, isAbortError, withLifecycle } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import { API, isInjectSelectionError, type Command, type StateView } from '../shared/protocol.ts'
import type { Prompt } from '../shared/state.ts'
import { sessionState } from './session-state.ts'

interface State {
  data?: StateView
  error?: string
  errorId: number
  saving: boolean
  verified: boolean
  dismissedNotice?: string
}

export function createInjectStore(
  sessionId?: string,
  workspace = '',
  onRelease?: () => void,
  onBlockChange?: (reason: string | undefined) => void,
) {
  const store = createStore<State>(() => ({ saving: false, verified: false, errorId: 0 }))

  const endpoint =
    API.replace(/^\//, '') +
    (sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : workspace
        ? `?workspace=${encodeURIComponent(workspace)}`
        : '')

  let disposed = false
  const scope = createAbortScope()
  let lastEtag: string | undefined
  let retainCount = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let pollMs = 0
  let pendingAcknowledgement: number | undefined
  let acknowledging = false
  let lastBlock: string | undefined
  let hasReportedBlock = false

  function emitBlock(next: string | undefined) {
    if (!onBlockChange) return
    if (hasReportedBlock && lastBlock === next) return
    hasReportedBlock = true
    lastBlock = next
    onBlockChange(next)
  }

  function currentBlock(): string | undefined {
    if (disposed || retainCount === 0) return undefined
    const s = store.getState()
    return sessionState(s.data, s.verified, s.saving, s.error, s.errorId).block
  }

  if (sessionId && onBlockChange) {
    store.subscribe(() => {
      if (!disposed && retainCount > 0) emitBlock(currentBlock())
    })
  }

  const pollTick = () => {
    if (!document.hidden) void refresh()
  }

  function startTimer(ms: number) {
    if (disposed || retainCount === 0) return
    if (timer && pollMs === ms) return
    clearInterval(timer)
    pollMs = ms
    timer = setInterval(pollTick, ms)
  }

  function validateView(data: StateView): StateView {
    if (
      (!sessionId &&
        (!Array.isArray(data.config?.templates) || data.config.workspace !== workspace)) ||
      (sessionId && data.session?.sessionId !== sessionId)
    ) {
      throw new Error('破甲模式接口返回无效状态')
    }
    return data
  }

  function postRpc<T>(body: object, fallbackError: string): Promise<T> {
    return scope.run((signal) =>
      requestJson<T>(endpoint, { method: 'POST', body, signal, fallbackError }),
    )
  }

  function syncPolling() {
    if (!sessionId || disposed || retainCount === 0) return
    const current = store.getState()
    const view = current.data?.session
    const frozenIdle =
      current.verified &&
      view &&
      !view.resolved.editable &&
      !view.error &&
      pendingAcknowledgement === undefined
    startTimer(frozenIdle ? 2500 : 1200)
  }

  function accept(data: StateView, etag?: string) {
    if (disposed) return
    lastEtag = etag
    store.setState((state) => ({
      data:
        !etag && state.data && JSON.stringify(state.data) === JSON.stringify(data)
          ? state.data
          : data,
      error: undefined,
      verified: true,
    }))
    syncPolling()
  }

  async function acknowledgeNotice() {
    const noticeId = pendingAcknowledgement
    if (!sessionId || noticeId === undefined || disposed || acknowledging) return

    acknowledging = true
    try {
      await postRpc({ type: 'acknowledge-error', sessionId, noticeId }, '无法读取破甲模式状态')
      if (pendingAcknowledgement === noticeId) pendingAcknowledgement = undefined
      if (!disposed) {
        const current = store.getState().data
        if (current?.session?.error?.id === noticeId) {
          store.setState({
            data: { ...current, session: { ...current.session, error: undefined } },
          })
        }
      }
      syncPolling()
    } catch {
    } finally {
      acknowledging = false
    }
  }

  async function refresh(invalidate = false) {
    if (disposed || store.getState().saving) return
    if (invalidate) store.setState({ verified: false })

    const req = scope.latest()
    try {
      const etag = store.getState().data ? lastEtag : undefined
      const result = await requestConditionalJson<StateView>(endpoint, {
        etag,
        signal: req.signal,
        fallbackError: '无法读取破甲模式状态',
      })
      if (disposed || !req.isCurrent()) return

      if (!result.modified) {
        const s = store.getState()
        if (!s.verified || s.error !== undefined) {
          store.setState({ error: undefined, verified: true })
        }
        syncPolling()
      } else {
        accept(validateView(result.data), result.etag)
      }
      void acknowledgeNotice()
    } catch (error) {
      if (disposed || !req.isCurrent() || isAbortError(error)) return
      store.setState((state) => ({
        error: errorMessage(error, '读取失败'),
        errorId: state.errorId + 1,
        verified: false,
      }))
    } finally {
      req.finish()
    }
  }

  const focused = () => {
    if (!document.hidden) void refresh()
  }

  const detach = () => {
    window.removeEventListener('focus', focused)
    document.removeEventListener('visibilitychange', focused)
  }

  const retain = () => {
    if (++retainCount === 1) {
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', focused)
        document.addEventListener('visibilitychange', focused)
      }
      emitBlock(currentBlock())
      void refresh(true)
      startTimer(sessionId ? 1200 : 5000)
    }

    let released = false
    return () => {
      if (released) return
      released = true
      if (--retainCount === 0) {
        clearInterval(timer)
        timer = undefined
        pollMs = 0
        if (typeof window !== 'undefined') detach()
        scope.latest().abort()
        emitBlock(undefined)
        onRelease?.()
      }
    }
  }

  const api = Object.assign(store, {
    refresh,

    isRetained() {
      return retainCount > 0
    },

    dismissNotice(expectedKey?: string) {
      const current = store.getState()
      const notice = sessionState(
        current.data,
        current.verified,
        current.saving,
        current.error,
        current.errorId,
      ).notice

      if (!notice || (expectedKey !== undefined && notice.key !== expectedKey)) return
      store.setState({ dismissedNotice: notice.key })
      if (notice.failureId !== undefined) {
        pendingAcknowledgement = notice.failureId
        void acknowledgeNotice()
      }
    },

    async execute(command: Command): Promise<boolean> {
      if (disposed || store.getState().saving) return false
      scope.latest().abort()
      store.setState({ saving: true, error: undefined })

      try {
        const result = validateView(await postRpc<StateView>(command, '无法读取破甲模式状态'))
        accept(result)
        return !disposed
      } catch (error) {
        const prevData = store.getState().data
        if (!disposed && isInjectSelectionError(error) && prevData?.session) {
          const failure = error as Error & { details: { noticeId: number } }
          store.setState({
            data: {
              ...prevData,
              session: {
                ...prevData.session,
                error: { id: failure.details.noticeId, message: failure.message },
              },
            },
          })
        } else if (!disposed) {
          store.setState((state) => ({
            error: errorMessage(error, '保存失败'),
            errorId: state.errorId + 1,
            verified: false,
          }))
        }
        return false
      } finally {
        if (!disposed) store.setState({ saving: false })
      }
    },

    async parseMarkdown(markdown: string): Promise<Prompt> {
      const result = await postRpc<{ prompt: Prompt }>(
        { type: 'parse-markdown', markdown },
        '导入失败',
      )
      return result.prompt
    },

    async formatMarkdown(template: Prompt): Promise<string> {
      const result = await postRpc<{ markdown: string }>(
        { type: 'format-markdown', template },
        '导出失败',
      )
      return result.markdown
    },

    retain,

    dispose() {
      disposed = true
      emitBlock(undefined)
      if (typeof window !== 'undefined') detach()
      clearInterval(timer)
      timer = undefined
      pollMs = 0
      scope.abortAll()
    },
  })

  return withLifecycle(api, retain)
}

export type InjectStore = ReturnType<typeof createInjectStore>
