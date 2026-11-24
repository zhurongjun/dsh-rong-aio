import { forwardRef, useState } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCatalogModel,
  ModelReasoningEffort,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { ProviderIcon } from '../../../client/providers/ProviderIcon.tsx'
import type { ProviderIconId } from '../../../shared/provider-icon.ts'
import { useEffortPreview, type SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'
import { EffortSlider } from './EffortSlider.tsx'
import { SpeedControl, TeamControl } from './HeaderControls.tsx'
import { SelectionButton } from './SelectionButton.tsx'
import type { TeamSelection, TeamInteraction } from './selector-session.ts'

function createSideReserveTracker() {
  let header: HTMLDivElement | null = null
  let observer: ResizeObserver | undefined
  let lastReserve = -1

  const sync = () => {
    if (!header) return
    const start = header.querySelector<HTMLElement>('.rong-effort-side-start')
    const end = header.querySelector<HTMLElement>('.rong-effort-side-end')
    const reserve = Math.max(start?.offsetWidth ?? 0, end?.offsetWidth ?? 0)
    if (reserve === lastReserve) return
    lastReserve = reserve
    header.style.setProperty('--rong-side-reserve', `${reserve}px`)
  }

  return {
    bind(node: HTMLDivElement | null) {
      if (node === header) {
        if (node) sync()
        return
      }
      observer?.disconnect()
      observer = undefined
      header = node
      lastReserve = -1
      if (!node) return
      sync()
      if (typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(sync)
      const start = node.querySelector<HTMLElement>('.rong-effort-side-start')
      const end = node.querySelector<HTMLElement>('.rong-effort-side-end')
      if (start) observer.observe(start)
      if (end) observer.observe(end)
    },
  }
}

const EffortHeading = forwardRef<
  HTMLButtonElement,
  {
    efforts: readonly ModelReasoningEffort[]
    selected: ModelReasoningEffort | undefined
    providerIcon?: ProviderIconId
    modelName: string
    disabled: boolean
    inactive: boolean
    busy: boolean
    onClick(): void
  }
>(function EffortHeading(
  { efforts, selected, providerIcon, modelName, disabled, inactive, busy, onClick },
  ref,
) {
  const title = selected?.name ?? (efforts.length ? '请选择强度' : '推理强度')

  return (
    <SelectionButton
      ref={ref}
      className="rong-model-heading"
      onClick={onClick}
      disabled={disabled}
      inactive={inactive}
      busy={busy}
    >
      <span className="rong-effort-title">{title}</span>
      <span className="rong-model-label">
        {providerIcon && (
          <ProviderIcon icon={providerIcon} size={12} className="rong-heading-provider" />
        )}
        <span className="rong-model-name rong-truncate" title={modelName}>
          {modelName}
        </span>
        <IconChevronRightOutlineRegular size={10} className="rong-heading-chevron" />
      </span>
    </SelectionButton>
  )
})

interface Props {
  store: SelectorStore
  speedStore: SpeedStore
  team?: TeamSelection
  teamInteraction: TeamInteraction
  routeKey: string
  speedRoute: string
  providerIcon?: ProviderIconId
  model: ModelCatalogModel | undefined
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  open: boolean
  locked: boolean
  selecting: boolean
  onPreview(effort: string | undefined): void
  chooseEffort(effort: string): Promise<boolean>
  showModels(): void
}

export const EffortPanel = forwardRef<HTMLButtonElement, Props>(function EffortPanel(
  {
    store,
    speedStore,
    team,
    teamInteraction,
    routeKey,
    speedRoute,
    providerIcon,
    model,
    modelName,
    efforts,
    selected,
    open,
    locked,
    selecting,
    onPreview,
    chooseEffort,
    showModels,
  },
  ref,
) {
  const effortId = useEffortPreview(store, routeKey, selected?.id)
  const displayed = efforts.find((entry) => entry.id === effortId) ?? selected
  const [reserveTracker] = useState(createSideReserveTracker)
  const bindHeader = (node: HTMLDivElement | null) => reserveTracker.bind(node)

  return (
    <div className="rong-effort-pane">
      <div ref={bindHeader} className="rong-effort-header">
        <div className="rong-effort-side rong-effort-side-start">
          <SpeedControl
            store={speedStore}
            identityKey={speedRoute}
            open={open}
            disabled={locked}
            busy={selecting}
          />
        </div>

        <EffortHeading
          ref={ref}
          efforts={efforts}
          selected={displayed}
          providerIcon={providerIcon}
          modelName={modelName}
          disabled={locked}
          inactive={!open}
          busy={selecting}
          onClick={showModels}
        />

        <div className="rong-effort-side rong-effort-side-end">
          {team && (
            <TeamControl
              team={team}
              interaction={teamInteraction}
              open={open}
              locked={locked}
              busy={selecting}
            />
          )}
        </div>
      </div>

      {efforts.length ? (
        <EffortSlider
          key={routeKey}
          efforts={efforts}
          selected={displayed?.id}
          disabled={locked || !open}
          busy={selecting}
          onPreview={onPreview}
          onCommit={chooseEffort}
        />
      ) : (
        <p className="rong-picker-empty">
          {model ? '此模型未提供可选推理强度' : '当前模型不可用，请重新选择'}
        </p>
      )}
    </div>
  )
})
