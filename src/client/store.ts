import { createStore, type StoreApi } from 'zustand/vanilla'

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

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function createAbortScope() {
  const active = new Set<AbortController>()
  let latestController: AbortController | undefined
  let latestToken = 0

  function untrack(controller: AbortController) {
    active.delete(controller)
    if (latestController === controller) latestController = undefined
  }

  return {
    async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController()
      active.add(controller)
      try {
        return await task(controller.signal)
      } finally {
        untrack(controller)
      }
    },

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

export function scrollNearest(node: HTMLElement | null): void {
  node?.scrollIntoView({ block: 'nearest' })
}
