import { useEffect, useRef, useState } from 'react'
import {
  SPEED_LABELS,
  speedKey,
  type SpeedIdentity,
  type SpeedMode,
  type SpeedState,
} from '../../shared/speed.ts'

const EMPTY: SpeedState = { mode: 'standard', modes: [] }

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

/** 由始终挂载的选择器持有状态，关闭弹层后输入框仍能显示实际速度。 */
export function useSpeedSelection(
  identity: SpeedIdentity | undefined,
  open: boolean,
  onError: (message: string) => void,
) {
  const key = identity ? speedKey(identity) : ''
  const [record, setRecord] = useState<{ key: string; state: SpeedState }>()
  const [loadingKey, setLoadingKey] = useState<string>()
  const [savingKey, setSavingKey] = useState<string>()
  const operation = useRef<AbortController>()
  const report = useRef(onError)
  report.current = onError
  const state = record?.key === key ? record.state : EMPTY
  const loading = !!identity && (record?.key !== key || loadingKey === key)
  const saving = savingKey === key

  useEffect(() => {
    // 首次挂载即读取；已有当前模型状态时，关闭弹层无需再发请求。
    setLoadingKey(undefined)
    if (!identity || operation.current || (!open && record?.key === key)) return
    const controller = new AbortController()
    setLoadingKey(key)
    void requestSpeed(identity, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setRecord({ key, state: value })
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) report.current(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingKey(undefined)
      })
    return () => controller.abort()
  }, [key, open])

  useEffect(() => {
    setSavingKey(undefined)
    return () => {
      operation.current?.abort()
      operation.current = undefined
    }
  }, [key])

  async function select(mode: SpeedMode) {
    if (
      !identity ||
      loading ||
      saving ||
      operation.current ||
      !state.modes.includes(mode) ||
      mode === state.mode
    )
      return
    const controller = new AbortController()
    operation.current = controller
    setSavingKey(key)
    try {
      const value = await requestSpeed(identity, controller.signal, mode)
      if (!controller.signal.aborted) setRecord({ key, state: value })
    } catch (error) {
      if (!controller.signal.aborted)
        report.current(error instanceof Error ? error.message : '无法保存速度设置')
    } finally {
      if (operation.current === controller) operation.current = undefined
      if (!controller.signal.aborted) setSavingKey(undefined)
    }
  }

  return { state, loading, saving, select }
}
