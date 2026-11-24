/** HTTP 状态容器：读取宿主权威结果、协调保存与条件轮询、确认通知并清理请求。 */

import { createStore } from 'zustand/vanilla'
import { requestConditionalJson, requestJson } from '../../../client/http.ts'
import { withLifecycle } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import { API, type Command, type StateView } from '../shared/protocol.ts'
import { isInjectSelectionError } from '../shared/selection-error.ts'
import type { Prompt } from '../shared/state.ts'
import { sessionState } from './session-state.ts'

/** 传输与展示状态，不保存第二份模板库、模型授权或会话解析结果。 */
interface State {
  /** 最近一次接受的宿主视图；明确拒绝不会清除已确认选择。 */
  data?: StateView

  /** 通信、读取或未知保存失败；与宿主结构化拒绝通知分开。 */
  error?: string

  /** 读取/保存未知失败的单调递增序号；避免同文案重试被旧 dismissedNotice 吞掉。 */
  errorId: number

  /** 写命令进行中，阻止并发写入和轮询覆盖。 */
  saving: boolean

  /** 视图是否由有效响应确认；读取失败时不宣称当前状态可信。 */
  verified: boolean

  /** 本地已关闭的通知键，跨组件重新挂载保留以免重复提示。 */
  dismissedNotice?: string
}

/**
 * 创建固定范围的破甲客户端 store。
 *
 * sessionId 存在时绑定会话；否则 workspace 为空表示全局设置，非空表示当前工程设置。
 * 范围在创建后不变。AbortController、ETag 和请求版本留在闭包内。
 */
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
  let reading: AbortController | undefined
  let version = 0
  let lastEtag: string | undefined
  const requests = new Set<AbortController>()
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

  async function postCommand(command: Command): Promise<StateView> {
    const controller = new AbortController()
    requests.add(controller)
    try {
      const data = await requestJson<StateView>(endpoint, {
        method: 'POST',
        body: command,
        signal: controller.signal,
        fallbackError: '无法读取破甲模式状态',
      })
      return validateView(data)
    } finally {
      requests.delete(controller)
    }
  }

  /** 已冻结且无待确认错误/通知的会话放缓轮询频率至 2500ms（配合 ETag 304 零渲染），既降开销又不漏发后拒绝通知。 */
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
      await postCommand({ type: 'acknowledge-error', sessionId, noticeId })
      if (pendingAcknowledgement === noticeId) pendingAcknowledgement = undefined
      if (!disposed) {
        const current = store.getState().data
        if (current?.session?.error?.id === noticeId) {
          store.setState({
            data: {
              ...current,
              session: { ...current.session, error: undefined },
            },
          })
        }
      }
      syncPolling()
    } catch {
      // 网络失败仅推迟宿主清理，下一次刷新重试。
    } finally {
      acknowledging = false
    }
  }

  async function refresh(invalidate = false) {
    if (disposed || store.getState().saving) return
    const token = ++version
    if (invalidate) store.setState({ verified: false })
    const controller = new AbortController()
    requests.add(controller)
    reading?.abort()
    reading = controller
    try {
      const etag = store.getState().data ? lastEtag : undefined
      const result = await requestConditionalJson<StateView>(endpoint, {
        etag,
        signal: controller.signal,
        fallbackError: '无法读取破甲模式状态',
      })
      if (disposed || token !== version) return
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
      if (disposed || token !== version || (error instanceof Error && error.name === 'AbortError'))
        return
      store.setState((state) => ({
        error: errorMessage(error, '读取失败'),
        errorId: state.errorId + 1,
        verified: false,
      }))
    } finally {
      requests.delete(controller)
      if (reading === controller) reading = undefined
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
        reading?.abort()
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
      version++
      reading?.abort()
      store.setState({ saving: true, error: undefined })
      try {
        const result = await postCommand(command)
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
      const controller = new AbortController()
      requests.add(controller)
      try {
        const result = await requestJson<{ prompt: Prompt }>(endpoint, {
          method: 'POST',
          body: { type: 'parse-markdown', markdown },
          signal: controller.signal,
          fallbackError: '导入失败',
        })
        return result.prompt
      } finally {
        requests.delete(controller)
      }
    },

    async formatMarkdown(template: Prompt): Promise<string> {
      const controller = new AbortController()
      requests.add(controller)
      try {
        const result = await requestJson<{ markdown: string }>(endpoint, {
          method: 'POST',
          body: { type: 'format-markdown', template },
          signal: controller.signal,
          fallbackError: '导出失败',
        })
        return result.markdown
      } finally {
        requests.delete(controller)
      }
    },

    retain,

    dispose() {
      disposed = true
      emitBlock(undefined)
      if (typeof window !== 'undefined') detach()
      clearInterval(timer)
      timer = undefined
      pollMs = 0
      for (const controller of requests) controller.abort()
    },
  })

  return withLifecycle(api, retain)
}

export type InjectStore = ReturnType<typeof createInjectStore>
