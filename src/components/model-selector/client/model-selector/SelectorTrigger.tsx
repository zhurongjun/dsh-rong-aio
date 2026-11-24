/** 输入框模型入口：模型和 Fast 来自确认值，effort 共用面板预览投影；不发起请求。 */

import { forwardRef } from 'react'
import { useStore } from 'zustand'
import {
  IconDataOutlineRegular,
  IconChevronDownOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { FastIcon } from './SelectorIcons.tsx'
import { SPEED_LABELS } from '../../shared/speed.ts'
import type { SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'
import { useEffortPreview } from './useEffortPreview.ts'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  store: SelectorStore
  routeKey: string
  speedStore: SpeedStore
  speedKey: string
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  locked: boolean
  id: string
  onToggle(): void
}

/** 输入框入口的窄订阅视图；Fast 图标只显示当前路由已经确认的速度。 */
export const SelectorTrigger = forwardRef<HTMLButtonElement, Props>(function SelectorTrigger(
  { store, routeKey, speedStore, speedKey, modelName, efforts, selected, locked, id, onToggle },
  ref,
) {
  const open = useStore(store, (state) => state.open)
  const preview = useEffortPreview(store, routeKey, selected?.id)

  // 输入框只关心确认过的速度，不因 GET/POST 的 loading 状态重新渲染。
  const mode = useStore(speedStore, (state) =>
    state.key === speedKey && state.value.modes.includes(state.value.mode)
      ? state.value.mode
      : 'standard',
  )
  const fastActive = mode !== 'standard'
  const effort = efforts.find((entry) => entry.id === preview) ?? selected
  return (
    <button
      ref={ref}
      type="button"
      className="rong-model-trigger"
      disabled={locked}
      aria-label={`选择模型与推理强度：${modelName}${effort ? `，${effort.name}` : ''}${fastActive ? `，${SPEED_LABELS[mode]}模式` : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={onToggle}
    >
      {fastActive ? (
        <span className="rong-trigger-fast" aria-hidden="true" title={`${SPEED_LABELS[mode]}模式`}>
          <FastIcon active />
        </span>
      ) : (
        <IconDataOutlineRegular size={16} className="rong-trigger-icon" />
      )}
      <span className="rong-trigger-name">{modelName}</span>
      <span className="rong-trigger-effort">{effort?.name}</span>
      <IconChevronDownOutlineRegular
        size={12}
        className={open ? 'rong-chevron rong-open' : 'rong-chevron'}
      />
    </button>
  )
})
