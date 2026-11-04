import { useCallback } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_SPEED, type SpeedStore } from './speed-store.ts'
import type { SpeedMode } from '../../shared/speed.ts'

/** 在订阅时按路由屏蔽旧状态，不等待 effect 清理，避免模型切换闪现旧图标。 */
export function useSpeedSelection(store: SpeedStore, key: string) {
  const view = useStore(
    store,
    useShallow((state) => ({
      state: state.key === key ? state.value : EMPTY_SPEED,
      loading: !!key && (state.key !== key || !state.received || state.loading),
      saving: state.key === key && state.saving,
    })),
  )
  const select = useCallback((mode: SpeedMode) => store.select(key, mode), [store, key])
  return { ...view, select }
}
