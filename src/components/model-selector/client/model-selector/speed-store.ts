/** Fast 请求状态：按完整会话/模型路由隔离读取与保存，拒绝迟到响应和重复提交。 */

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../../shared/speed.ts'

/** 未取得本路由有效数据时的保守显示值：标准档且无可交互能力。 */
export const EMPTY_SPEED: SpeedState = { mode: 'standard', modes: [] }

/**
 * 读取或保存完整路由的速度。mode 省略时为 GET，否则 PUT。
 * 校验响应档位后返回，HTTP 或格式错误抛出，由 store 决定是否仍需呈现。
 */
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

/** 速度的已确认快照与请求状态；路由更换会清空之前的接收标记。 */
interface State {
  /** value 所属完整路由键；渲染时再次与调用方路由核对。 */
  key: string

  /** 最近一次宿主确认的速度与能力，不做乐观更新。 */
  value: SpeedState

  /** 本路由是否已收到有效响应；首次加载前禁止修改。 */
  received: boolean

  /** 当前路由 GET 进行中。 */
  loading: boolean

  /** 当前路由 PUT 进行中。 */
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

  /** 归一化异常为用户文案，由选择器统一显示 Toast。 */
  const report = (error: unknown) =>
    onError(error instanceof Error ? error.message : '无法保存速度设置')

  /** 中止当前路由全部请求并解除身份；过期响应的控制器状态会阻止提交。 */
  const dispose = () => {
    reading?.abort()
    writing?.abort()
    reading = undefined
    writing = undefined
    identity = undefined
  }

  return Object.assign(store, {
    /**
     * 同步路由和主弹层状态。首次出现即读取，弹层重开重新读取，关闭保留已确认提示。
     * 返回本次 GET 的取消函数；更换身份同时中止上一模型的写入。
     */
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

    /**
     * 仅保存当前已确认路由支持的新档位；路由不匹配、加载中或重复提交直接忽略。
     * 成功响应后才替换 value，失败保持原速度。
     */
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
