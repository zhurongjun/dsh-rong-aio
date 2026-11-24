import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { createStore } from 'zustand/vanilla'
import { requestJson } from '../../../client/http.ts'
import { createAbortScope, isAbortError } from '../../../client/store.ts'
import { errorMessage } from '../../../shared/error.ts'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../shared/speed.ts'

const EMPTY_SPEED: SpeedState = { mode: 'standard', modes: [] }

async function requestSpeed(
  identity: SpeedIdentity,
  signal: AbortSignal,
  mode?: SpeedMode,
): Promise<SpeedState> {
  const route = `api/rong-aio.speed?${new URLSearchParams({ ...identity })}`
  const value = await requestJson<SpeedState>(route, {
    ...(mode ? { method: 'POST', body: { ...identity, mode } } : {}),
    signal,
    fallbackError: '无法保存速度设置',
  })

  if (
    !Array.isArray(value.modes) ||
    !value.modes.every((item) => item in SPEED_LABELS) ||
    !(value.mode in SPEED_LABELS)
  ) {
    throw new Error('速度接口响应无效')
  }
  return value
}

export interface SpeedViewState {
  key: string
  value: SpeedState
  received: boolean
  loading: boolean
  saving: boolean
}

export function createSpeedStore(onError: (message: string) => void) {
  const store = createStore<SpeedViewState>(() => ({
    key: '',
    value: EMPTY_SPEED,
    received: false,
    loading: false,
    saving: false,
  }))
  const scope = createAbortScope()
  let identity: SpeedIdentity | undefined
  let writing = false

  const report = (error: unknown) => onError(errorMessage(error, '无法保存速度设置'))

  const dispose = () => {
    scope.abortAll()
    writing = false
    identity = undefined
  }

  return Object.assign(store, {
    sync(next: SpeedIdentity | undefined, open: boolean) {
      const key = next ? speedKey(next) : ''
      if (key !== store.getState().key) {
        dispose()
        store.setState({ key, value: EMPTY_SPEED, received: false, saving: false })
      }
      identity = next

      const shouldRead = !!next && !writing && (open || !store.getState().received)
      store.setState({ loading: shouldRead, saving: writing })
      if (!next || !shouldRead) {
        scope.latest().abort()
        return () => {}
      }

      const req = scope.latest()
      void requestSpeed(next, req.signal)
        .then((value) => {
          if (req.isCurrent()) store.setState({ value, received: true })
        })
        .catch((error: unknown) => {
          if (req.isCurrent() && !isAbortError(error)) report(error)
        })
        .finally(() => {
          if (req.isCurrent()) store.setState({ loading: false })
          req.finish()
        })
      return req.abort
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
      ) {
        return
      }

      const activeIdentity = identity
      writing = true
      store.setState({ saving: true })

      try {
        await scope.run(async (signal) => {
          const value = await requestSpeed(activeIdentity, signal, mode)
          if (!signal.aborted) store.setState({ value })
        })
      } catch (error) {
        if (!isAbortError(error)) report(error)
      } finally {
        writing = false
        store.setState({ saving: false })
      }
    },

    dispose,
  })
}

export type SpeedStore = ReturnType<typeof createSpeedStore>

export function useSpeedSelection(store: SpeedStore, key: string) {
  const view = useStore(
    store,
    useShallow((state) => ({
      state: state.key === key ? state.value : EMPTY_SPEED,
      loading: !!key && (state.key !== key || !state.received || state.loading),
      saving: state.key === key && state.saving,
    })),
  )
  return { ...view, select: (mode: SpeedMode) => store.select(key, mode) }
}
