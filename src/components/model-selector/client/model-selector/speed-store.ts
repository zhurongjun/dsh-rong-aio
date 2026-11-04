import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../../shared/speed.ts'

export const EMPTY_SPEED: SpeedState = { mode: 'standard', modes: [] }

async function requestSpeed(
  identity: SpeedIdentity,
  signal: AbortSignal,
  mode?: SpeedMode,
): Promise<SpeedState> {
  const route = `api/rong-aio.speed?${new URLSearchParams({ ...identity })}`
  const response = await fetch(route, {
    signal,
    ...(mode
      ? {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...identity, mode }),
        }
      : {}),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? '无法保存速度设置')
  if (
    !Array.isArray(value.modes) ||
    !value.modes.every((item: string) => item in SPEED_LABELS) ||
    !(value.mode in SPEED_LABELS)
  )
    throw new Error('速度接口响应无效')
  return value
}

interface State {
  key: string
  value: SpeedState
  received: boolean
  loading: boolean
  saving: boolean
}

/** 请求与组件生命周期分离；AbortController 留在闭包内，不进入 Immer 草稿。 */
export function createSpeedStore(onError: (message: string) => void) {
  const store = createStore<State>()(
    immer(() => ({
      key: '',
      value: EMPTY_SPEED,
      received: false,
      loading: false,
      saving: false,
    })),
  )
  let identity: SpeedIdentity | undefined
  let reading: AbortController | undefined
  let writing: AbortController | undefined

  const report = (error: unknown) =>
    onError(error instanceof Error ? error.message : '无法保存速度设置')

  const dispose = () => {
    reading?.abort()
    writing?.abort()
    reading = undefined
    writing = undefined
    identity = undefined
  }

  return Object.assign(store, {
    sync(next: SpeedIdentity | undefined, open: boolean) {
      const key = next ? speedKey(next) : ''
      reading?.abort()
      reading = undefined
      if (key !== store.getState().key) {
        dispose()
        store.setState((state) => {
          state.key = key
          state.value = { mode: 'standard', modes: [] }
          state.received = false
          state.saving = false
        })
      }
      identity = next
      // 首次挂载即读取；关闭弹层保留已确认状态，输入框继续显示 Fast。
      const shouldRead = !!next && !writing && (open || !store.getState().received)
      store.setState((state) => {
        state.loading = shouldRead
        state.saving = !!writing
      })
      if (!next || !shouldRead) return () => {}
      const controller = new AbortController()
      reading = controller
      void requestSpeed(next, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return
          store.setState((state) => {
            state.value = { ...value, modes: [...value.modes] }
            state.received = true
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) report(error)
        })
        .finally(() => {
          if (reading !== controller) return
          reading = undefined
          if (!controller.signal.aborted)
            store.setState((state) => {
              state.loading = false
            })
        })
      return () => controller.abort()
    },
    async select(key: string, mode: SpeedMode) {
      const snapshot = store.getState()
      if (
        !identity ||
        key !== snapshot.key ||
        !snapshot.received ||
        snapshot.loading ||
        writing ||
        !snapshot.value.modes.includes(mode) ||
        mode === snapshot.value.mode
      )
        return
      const controller = new AbortController()
      writing = controller
      store.setState((state) => {
        state.saving = true
      })
      try {
        const value = await requestSpeed(identity, controller.signal, mode)
        if (!controller.signal.aborted)
          store.setState((state) => {
            state.value = { ...value, modes: [...value.modes] }
          })
      } catch (error) {
        if (!controller.signal.aborted) report(error)
      } finally {
        if (writing === controller) {
          writing = undefined
          if (!controller.signal.aborted)
            store.setState((state) => {
              state.saving = false
            })
        }
      }
    },
    dispose,
  })
}

export type SpeedStore = ReturnType<typeof createSpeedStore>
