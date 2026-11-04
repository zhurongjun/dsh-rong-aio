import { forwardRef, memo } from 'react'
import { useStore } from 'zustand'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SelectorStore } from './selector-store.ts'

interface Props {
  store: SelectorStore
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  modelName: string
  disabled: boolean
  onClick(): void
}

export const EffortHeading = memo(
  forwardRef<HTMLButtonElement, Props>(function EffortHeading(
    { store, efforts, selected, modelName, disabled, onClick },
    ref,
  ) {
    const preview = useStore(store, (state) => state.preview)
    const effort = efforts.find((entry) => entry.id === preview) ?? selected
    const title = effort?.name ?? (efforts.length ? '请选择强度' : '推理强度')
    return (
      <button
        ref={ref}
        className="rong-model-heading"
        type="button"
        onClick={onClick}
        disabled={disabled}
      >
        <span className="rong-effort-title">{title}</span>
        <span className="rong-model-label">
          <span className="rong-model-name" title={modelName}>
            {modelName}
          </span>
          <IconChevronRightOutlineRegular size={10} />
        </span>
      </button>
    )
  }),
)
