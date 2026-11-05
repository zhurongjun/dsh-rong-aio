/** HTTP 状态容器：读取宿主权威结果、协调保存与轮询、确认通知并清理请求。 */

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import { API, type Command, type StateView } from '../shared/protocol.ts'
import { isInjectSelectionError } from '../shared/selection-error.ts'
import { sessionState } from './session-state.ts'

/** 传输与展示状态，不保存第二份模板库、模型授权或会话解析结果。 */
interface State {
  /** 最近一次接受的宿主视图；明确拒绝不会清除已确认选择。 */
  data?: StateView

  /** 通信、读取或未知保存失败；与宿主结构化拒绝通知分开。 */
  error?: string

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
 * 范围在创建后不变。AbortController 和请求版本留在闭包内，不进入 Immer 数据。
 * retain/release 管理可见视图订阅，dispose 由插件生命周期负责最终释放。
 */
export function createInjectStore(sessionId?: string, workspace = '') {
  const store = createStore<State>()(immer(() => ({ saving: false, verified: false })))

  // 生命周期与请求协调：版本用于丢弃迟到读取，AbortController 用于释放实际网络占用。
  let disposed = false
  let reading: AbortController | undefined
  let version = 0
  const requests = new Set<AbortController>()
  let retainCount = 0
  let timer: ReturnType<typeof setInterval> | undefined

  // 通知确认不与业务写入共用 saving；确认响应不能改写会话解析结果。
  let pendingAcknowledgement: number | undefined
  let acknowledging = false

  /**
   * 发起同范围 GET 或 POST，并核对响应所属会话/工作区。
   * 写入失败保留宿主结构化错误；请求结束无论成功失败都会移出控制器集合。
   */
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

  /** 接受未被卸载的宿主结果；内容相同时保留 data 引用，减少重复轮询导致的渲染。 */
  function accept(data: StateView) {
    if (disposed) return
    store.setState((state) => {
      if (JSON.stringify(state.data) !== JSON.stringify(data)) state.data = data
      state.error = undefined
      state.verified = true
    })
  }

  /** 串行确认当前待清理通知。忽略确认响应的业务视图，防止迟到响应覆盖并行选择。 */
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

  /**
   * 刷新权威视图；写入期间跳过，只有最新读取版本可提交。
   * invalidate 用于重新挂载时暂时撤销可信标记；取消与过期响应不生成错误提示。
   */
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

  /** 页面重新可见或窗口恢复焦点时刷新，补上后台期间发生的文件变动。 */
  const focused = () => {
    if (!document.hidden) void refresh()
  }

  /** 只移除本 store 注册的页面监听器，可在释放最后订阅者和最终卸载时重复调用。 */
  const detach = () => {
    window.removeEventListener('focus', focused)
    document.removeEventListener('visibilitychange', focused)
  }

  return Object.assign(store, {
    refresh,

    /** 仅关闭仍匹配 expectedKey 的通知；结构化拒绝还需按 ID 向宿主确认。 */
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

    /**
     * 串行提交一条命令，开始时使旧读取失效。
     * 返回是否成功接受宿主结果；明确拒绝只更新通知，未知失败撤销可信标记。
     */
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

    /** 增加可见视图引用；首个订阅者启动刷新与轮询，最后一个离开时停止读取。 */
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

    /** 最终卸载：中止读写与确认请求、移除监听和定时器，并屏蔽迟到响应。 */
    dispose() {
      disposed = true
      if (typeof window !== 'undefined') detach()
      clearInterval(timer)
      for (const controller of requests) controller.abort()
    },
  })
}

export type InjectStore = ReturnType<typeof createInjectStore>
