import { forwardRef, memo } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  IconDataOutlineRegular,
  IconChevronDownOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { FastIcon } from './SelectorIcons.tsx'
import { SPEED_LABELS } from '../../shared/speed.ts'
import type { SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'

interface Props {
  store: SelectorStore
  speedStore: SpeedStore
  speedKey: string
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  locked: boolean
  id: string
  onToggle(): void
}

export const SelectorTrigger = memo(
  forwardRef<HTMLButtonElement, Props>(function SelectorTrigger(
    { store, speedStore, speedKey, modelName, efforts, selected, locked, id, onToggle },
    ref,
  ) {
    const { open, preview } = useStore(
      store,
      useShallow((state) => ({ open: state.open, preview: state.preview })),
    )
    // 输入框只关心确认过的速度，不因 GET/PUT 的 loading 状态重新渲染。
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
          <span
            className="rong-trigger-fast"
            aria-hidden="true"
            title={`${SPEED_LABELS[mode]}模式`}
          >
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
  }),
)
