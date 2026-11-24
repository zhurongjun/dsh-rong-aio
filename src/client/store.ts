/** 通用客户端状态与视图辅助：订阅自托管生命期、请求取消作用域、菜单退场计时与高亮滚动。 */

import { createStore, type StoreApi } from 'zustand/vanilla'

/** 为纯 Zustand store 附加基于订阅计数（0→1 激活、1→0 清理）的生命周期钩子。 */
export function withLifecycle<S extends { subscribe: (listener: never) => () => void }>(
  store: S,
  onActive: () => () => void,
): S {
  const rawSubscribe = store.subscribe.bind(store) as (listener: unknown) => () => void
  let subscribers = 0
  let cleanup: (() => void) | undefined

  const subscribe = (listener: unknown) => {
    const unsubscribe = rawSubscribe(listener)
    let ended = false
    if (++subscribers === 1) cleanup = onActive()
    return () => {
      if (ended) return
      ended = true
      unsubscribe()
      if (--subscribers === 0) {
        const stop = cleanup
        cleanup = undefined
        stop?.()
      }
    }
  }

  return Object.assign(store, { subscribe }) as S
}

/** 识别被 AbortController 取消的异常，避免将主动中断当成失败上报。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 请求取消作用域：追踪全部进行中的异步请求，并支持“后来居上”式替换旧请求。 */
export function createAbortScope() {
  const active = new Set<AbortController>()
  let latestController: AbortController | undefined
  let latestToken = 0

  function untrack(controller: AbortController) {
    active.delete(controller)
    if (latestController === controller) latestController = undefined
  }

  return {
    /** 运行可跟踪请求；完成后自动移除追踪。 */
    async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController()
      active.add(controller)
      try {
        return await task(controller.signal)
      } finally {
        untrack(controller)
      }
    },

    /** 取消上一轮 latest 请求并开启新一轮，返回信号与有效性判断。 */
    latest() {
      latestController?.abort()
      const controller = new AbortController()
      latestController = controller
      active.add(controller)
      const token = ++latestToken
      return {
        signal: controller.signal,
        isCurrent: () => token === latestToken && !controller.signal.aborted,
        abort: () => {
          controller.abort()
          untrack(controller)
        },
        finish: () => untrack(controller),
      }
    },

    /** 中止所有未完成请求（含当前 latest 请求）。 */
    abortAll() {
      latestToken++
      latestController = undefined
      for (const controller of active) controller.abort()
      active.clear()
    },
  }
}

export interface MenuPresence {
  expanded: boolean
  mounted: boolean
}

/** 受管菜单开合与退场卸载状态机；关闭后保留退场过渡窗口，卸载订阅时清理定时器。 */
export function createMenuPresence(timeoutMs = 180) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const base = createStore<MenuPresence>(() => ({ expanded: false, mounted: false }))
  const store = withLifecycle(base, () => () => clear())

  function open() {
    clear()
    base.setState({ expanded: true, mounted: true })
  }

  function close() {
    clear()
    if (!base.getState().mounted) return
    base.setState({ expanded: false })
    timer = setTimeout(() => {
      timer = undefined
      base.setState((state) => (state.expanded ? state : { mounted: false }))
    }, timeoutMs)
  }

  function unmount() {
    clear()
    base.setState((state) => (state.expanded ? state : { mounted: false }))
  }

  function toggle() {
    if (base.getState().expanded) close()
    else open()
  }

  return Object.assign(store, { open, close, unmount, toggle }) as StoreApi<MenuPresence> & {
    open(): void
    close(): void
    unmount(): void
    toggle(): void
  }
}

/** 稳定引用 Callback Ref：节点作为高亮项挂载时滚动到可视区最近位置。 */
export function scrollNearest(node: HTMLElement | null): void {
  node?.scrollIntoView({ block: 'nearest' })
}
