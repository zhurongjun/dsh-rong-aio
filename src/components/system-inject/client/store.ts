import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import { API, type Command, type StateView } from '../shared/protocol.ts'
import { isInjectSelectionError } from '../shared/selection-error.ts'
import { sessionState } from './session-state.ts'

interface State {
  data?: StateView
  error?: string
  saving: boolean
  verified: boolean
  dismissedNotice?: string
}
/** 设置范围在创建时绑定；全局与各工程使用独立实例，禁止切换范围复用迟到响应。 */
export function createInjectStore(sessionId?: string, workspace = '') {
  const store = createStore<State>()(immer(() => ({ saving: false, verified: false })))
  let disposed = false
  let reading: AbortController | undefined
  let version = 0
  const requests = new Set<AbortController>()
  let retainCount = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let pendingAcknowledgement: number | undefined
  let acknowledging = false
  async function request(command?: Command): Promise<StateView> {
    const controller = new AbortController()
    requests.add(controller)
    if (!command) {
      reading?.abort()
      reading = controller
    }
    try {
      const response = await fetch(
        API.replace(/^\//, '') +
          (sessionId
            ? `?sessionId=${encodeURIComponent(sessionId)}`
            : workspace
              ? `?workspace=${encodeURIComponent(workspace)}`
              : ''),
        {
          signal: controller.signal,
          cache: 'no-store',
          ...(command
            ? {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(command),
              }
            : {}),
        },
      )
      const data = await response.json()
      if (!response.ok)
        throw Object.assign(new Error(data.error ?? '无法读取破甲模式状态'), {
          code: data.code,
          details: data.details,
        })
      if (
        (!sessionId &&
          (!Array.isArray(data.config?.templates) || data.config.workspace !== workspace)) ||
        (sessionId && data.session?.sessionId !== sessionId)
      )
        throw new Error('破甲模式接口返回无效状态')
      return data as StateView
    } finally {
      requests.delete(controller)
    }
  }
  function accept(data: StateView) {
    if (disposed) return
    store.setState((state) => {
      if (JSON.stringify(state.data) !== JSON.stringify(data)) state.data = data
      state.error = undefined
      state.verified = true
    })
  }
  async function acknowledgeNotice() {
    const noticeId = pendingAcknowledgement
    if (!sessionId || noticeId === undefined || disposed || acknowledging) return
    acknowledging = true
    try {
      // 确认只消费对应通知；响应中的状态可能已经过期，不能覆盖并行选词/选模的结果。
      await request({ type: 'acknowledge-error', sessionId, noticeId })
      if (pendingAcknowledgement === noticeId) pendingAcknowledgement = undefined
      if (!disposed)
        store.setState((state) => {
          if (state.data?.session?.error?.id === noticeId) state.data.session.error = undefined
        })
    } catch {
      // 本地已确认结果跨视图挂载保留；网络失败仅推迟宿主清理，下一次刷新重试。
    } finally {
      acknowledging = false
    }
  }
  async function refresh(invalidate = false) {
    if (disposed || store.getState().saving) return
    const token = ++version
    if (invalidate) store.setState({ verified: false })
    try {
      const data = await request()
      if (token === version) {
        accept(data)
        void acknowledgeNotice()
      }
    } catch (error) {
      if (disposed || token !== version || (error instanceof Error && error.name === 'AbortError'))
        return
      store.setState({
        error: error instanceof Error ? error.message : '读取失败',
        verified: false,
      })
    }
  }
  const focused = () => {
    if (!document.hidden) void refresh()
  }
  const detach = () => {
    window.removeEventListener('focus', focused)
    document.removeEventListener('visibilitychange', focused)
  }
  return Object.assign(store, {
    refresh,
    dismissNotice(expectedKey?: string) {
      const current = store.getState()
      const notice = sessionState(
        current.data,
        current.verified,
        current.saving,
        current.error,
      ).notice
      // 旧 toast 的退出回调不能确认并清掉后来到达的拒绝。
      if (!notice || (expectedKey !== undefined && notice.key !== expectedKey)) return
      store.setState({ dismissedNotice: notice.key })
      if (notice.failureId !== undefined) {
        pendingAcknowledgement = notice.failureId
        void acknowledgeNotice()
      }
    },
    async execute(command: Command): Promise<boolean> {
      if (disposed || store.getState().saving) return false
      version++
      reading?.abort()
      store.setState({ saving: true, error: undefined })
      try {
        accept(await request(command))
        return !disposed
      } catch (error) {
        if (!disposed && isInjectSelectionError(error) && store.getState().data?.session) {
          const failure = error as Error & { details: { noticeId: number } }
          store.setState((state) => {
            state.data!.session!.error = { id: failure.details.noticeId, message: failure.message }
          })
        } else if (!disposed)
          store.setState({
            error: error instanceof Error ? error.message : '保存失败',
            verified: false,
          })
        return false
      } finally {
        if (!disposed) store.setState({ saving: false })
      }
    },
    retain() {
      if (++retainCount === 1) {
        window.addEventListener('focus', focused)
        document.addEventListener('visibilitychange', focused)
        void refresh(true)
        timer = setInterval(
          () => {
            if (!document.hidden) void refresh()
          },
          sessionId ? 1200 : 5000,
        )
      }
      return () => {
        if (--retainCount === 0) {
          clearInterval(timer)
          detach()
          reading?.abort()
        }
      }
    },
    dispose() {
      disposed = true
      if (typeof window !== 'undefined') detach()
      clearInterval(timer)
      for (const controller of requests) controller.abort()
    },
  })
}
export type InjectStore = ReturnType<typeof createInjectStore>
