import { forwardRef } from 'react'
import { useStore } from 'zustand'
import {
  IconDataOutlineRegular,
  IconChevronDownOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { ProviderIcon } from '../../../client/providers/ProviderIcon.tsx'
import type { ProviderIconId } from '../../../shared/provider-icon.ts'
import { FastIcon } from './SelectorIcons.tsx'
import { SPEED_LABELS } from '../shared/speed.ts'
import { useEffortPreview, type SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'

interface Props {
  store: SelectorStore
  routeKey: string
  speedStore: SpeedStore
  speedKey: string
  providerIcon?: ProviderIconId
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  locked: boolean
  id: string
  onToggle(): void
}

export const SelectorTrigger = forwardRef<HTMLButtonElement, Props>(function SelectorTrigger(
  {
    store,
    routeKey,
    speedStore,
    speedKey,
    providerIcon,
    modelName,
    efforts,
    selected,
    locked,
    id,
    onToggle,
  },
  ref,
) {
  const open = useStore(store, (state) => state.open)
  const preview = useEffortPreview(store, routeKey, selected?.id)

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
      className="rong-composer-trigger rong-model-trigger"
      disabled={locked}
      aria-label={`选择模型与推理强度：${modelName}${effort ? `，${effort.name}` : ''}${fastActive ? `，${SPEED_LABELS[mode]}模式` : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={onToggle}
    >
      {providerIcon && (
        <ProviderIcon icon={providerIcon} size={14} className="rong-trigger-provider" />
      )}
      {fastActive ? (
        <span className="rong-trigger-fast" aria-hidden="true" title={`${SPEED_LABELS[mode]}模式`}>
          <FastIcon active />
        </span>
      ) : (
        !providerIcon && <IconDataOutlineRegular size={16} className="rong-trigger-icon" />
      )}
      <span className="rong-trigger-name rong-truncate">{modelName}</span>
      <span className="rong-trigger-effort rong-truncate">{effort?.name}</span>
      <IconChevronDownOutlineRegular size={12} className="rong-composer-chevron" />
    </button>
  )
})
