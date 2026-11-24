import { forwardRef } from 'react'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCatalogModel,
  ModelReasoningEffort,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { defaultEffortOf } from '../shared/model-selection.ts'
import { useEffortPreview, type SelectorStore } from './selector-store.ts'
import type { SpeedStore } from './speed-store.ts'
import { EffortSlider } from './EffortSlider.tsx'
import { SpeedControl, TeamControl } from './HeaderControls.tsx'
import { SelectionButton } from './SelectionButton.tsx'
import { ResetIcon } from './SelectorIcons.tsx'
import type { TeamSelection, TeamInteraction } from './selector-session.ts'

const EffortHeading = forwardRef<
  HTMLButtonElement,
  {
    efforts: readonly ModelReasoningEffort[]
    selected: ModelReasoningEffort | undefined
    modelName: string
    disabled: boolean
    inactive: boolean
    busy: boolean
    onClick(): void
  }
>(function EffortHeading({ efforts, selected, modelName, disabled, inactive, busy, onClick }, ref) {
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
        <span className="rong-model-name rong-truncate" title={modelName}>
          {modelName}
        </span>
        <IconChevronRightOutlineRegular size={10} />
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
  model: ModelCatalogModel | undefined
  modelName: string
  efforts: readonly ModelReasoningEffort[]
  selected: ModelReasoningEffort | undefined
  open: boolean
  locked: boolean
  selecting: boolean
  onPreview(effort: string | undefined): void
  chooseEffort(effort: string, kind?: 'effort' | 'reset'): Promise<boolean>
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
  const resetEffort = model ? defaultEffortOf(model) : undefined

  return (
    <div className="rong-effort-pane">
      <div className="rong-effort-header" data-has-team={!!team || undefined}>
        <SpeedControl
          store={speedStore}
          identityKey={speedRoute}
          open={open}
          disabled={locked}
          busy={selecting}
        />

        {team && (
          <TeamControl
            team={team}
            interaction={teamInteraction}
            open={open}
            locked={locked}
            busy={selecting}
          />
        )}

        <EffortHeading
          ref={ref}
          efforts={efforts}
          selected={displayed}
          modelName={modelName}
          disabled={locked}
          inactive={!open}
          busy={selecting}
          onClick={showModels}
        />

        <SelectionButton
          className="rong-icon-button rong-header-action"
          aria-label="重置当前模型的推理强度"
          title="重置强度"
          disabled={locked || !resetEffort}
          inactive={!open}
          busy={selecting}
          onClick={() => {
            if (resetEffort) void chooseEffort(resetEffort, 'reset')
          }}
        >
          <ResetIcon />
        </SelectionButton>
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
