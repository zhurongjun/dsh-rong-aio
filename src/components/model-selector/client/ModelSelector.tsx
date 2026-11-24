/** 选择器编排与原生插槽适配：连接宿主目录、局部状态、定位、Team 能力与键盘流程。 */

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  isBehindModal,
  MenuSurface,
  Toast,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-team/client'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import { useStore, type StoreApi } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { createAnchoredPopover, useComposerToastAnchor } from '../../../client/anchored-popover.ts'
import { handlePickerKeyDown, trapFocusTabKey } from '../../../client/ModelPickerList.tsx'
import { buildModelCatalog } from '../shared/model-selection.ts'
import { speedKey } from '../shared/speed.ts'
import { SelectorTrigger } from './SelectorTrigger.tsx'
import { EffortPanel } from './EffortPanel.tsx'
import { useModelSelection } from './useModelSelection.ts'
import { ModelList } from './ModelList.tsx'
import { TeamDisableDialog } from './HeaderControls.tsx'
import { createSelectorSession, type TeamSelection } from './selector-session.ts'

export type TeamCommand = Context['remote']['agentTeams']['setEnabled']
export type TeamCapability = { setEnabled: TeamCommand } | undefined

export interface SelectorInjected extends Omit<ModelSelectInjected, 'resolveText'> {
  /** 只观察可选原生 Remote 的生命周期，不保存 Team 业务状态。 */
  teamCommands: StoreApi<{ capability: TeamCapability }>
}

/** 使用宿主标准 hooks，不另建会话投影或持久化库；两种子会话身份均不呈现开关。 */
export function ModelSelectorSlot(
  props: PropsRuntime<'conversation.input.model'> & SelectorInjected,
) {
  // DSH 插槽契约通过 props 传入 hooks，不适合 React Compiler 自动记忆化；内层 ModelSelector 仍正常编译。
  'use no memo'
  const capability = useStore(props.teamCommands, (state) => state.capability)
  const command = capability?.setEnabled
  const addressedChild = props.useSession((snapshot) => snapshot.subagent !== null)
  const listedChild = props.useSessions(
    (state) => state.byId[props.sessionId]?.origin === 'subagent',
  )
  const team = props.useProjection('agentTeam')
  const model = props.useProjection('modelSelection')
  const selectEnabled = (enabled: boolean) => {
    if (!command) return Promise.reject(new Error('Agent Team 服务不可用'))
    return command(props.sessionId, enabled)
  }
  return (
    <ModelSelector
      {...props}
      team={
        command && team && !addressedChild && !listedChild
          ? {
              enabled: team.enabled,
              ready: model !== undefined,
              needsConfirmation: model !== undefined && model.lastUsed !== null,
              selectEnabled,
            }
          : undefined
      }
    />
  )
}

function focusWhenFront(el: HTMLElement | null) {
  if (el && !isBehindModal(el)) el.focus({ preventScroll: true })
}

type Props = Omit<ModelSelectInjected, 'resolveText'> &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'sessionId'> & {
    team?: TeamSelection
  }

/** 让会话切换重新建立瞬时 UI 状态；独立运行时提前跳过渲染，避免创建会话订阅。 */
export function ModelSelector(props: Props) {
  if (!props.available) return null
  return <Selector key={props.sessionId} {...props} />
}

/**
 * 单会话外壳负责菜单生命周期、定位和键盘导航；数据与提交由控制器负责。
 * 子视图只订阅各自需要的投影，粒子逐帧运动与请求刷新互不驱动。
 */
function Selector({ locked, available, directory, load, select, sessionId, team }: Props) {
  const [session] = useState(() => createSelectorSession(sessionId, directory))
  const store = session.selectorStore
  const actions = store.getState().actions
  const speedStore = session.speedStore
  const { open, mounted, pane, query, error, errorSequence } = useStore(
    store,
    useShallow((state) => ({
      open: state.open,
      mounted: state.mounted,
      pane: state.pane,
      query: state.query,
      error: state.error,
      errorSequence: state.errorSequence,
    })),
  )

  const {
    state,
    current,
    model,
    efforts,
    selected,
    routeKey,
    chooseEffort,
    chooseModel,
    preview,
    refresh,
    selecting,
    visibleError,
  } = useModelSelection({ directory, select, load, available, locked, session })

  const { bindTrigger, toastAnchor } = useComposerToastAnchor()
  const search = useRef<HTMLInputElement>(null)
  const id = useId()

  const [popover] = useState(() =>
    createAnchoredPopover({
      placement: 'above-end',
      onMount(surface, signal, { getAnchor }) {
        const outside = (event: PointerEvent) => {
          if (
            surface.contains(event.target as Node) ||
            getAnchor()?.contains(event.target as Node) ||
            (event.target instanceof Element && event.target.closest('[data-rong-option-menu]'))
          ) {
            return
          }
          actions.close()
        }
        const yieldToModal = () => {
          if (!isBehindModal(surface)) return
          actions.close()
          actions.unmount()
        }
        document.addEventListener('pointerdown', outside, { signal })
        document.addEventListener('focusin', yieldToModal, { signal })
      },
    }),
  )
  const position = useStore(popover.store, (state) => state.position)
  const positioned = position !== null
  const effectiveOpen = open && !locked

  const { groups, rows } = buildModelCatalog(state.groups, query)
  const busy = selecting || locked
  const modelName = model?.name ?? current?.model ?? '选择模型'
  const provider = current?.provider
  const modelId = current?.model
  const speedRoute = provider && modelId ? speedKey({ sessionId, provider, model: modelId }) : ''

  const close = (restoreFocus = false) => {
    actions.close()
    if (restoreFocus) popover.focusAnchor()
  }

  const teamState = useStore(session.teamStore)
  const teamInteraction = {
    pending: teamState.pending,
    confirming: Boolean(team) && teamState.rawConfirming,
    select: (enabled: boolean) =>
      session.teamStore.select(
        team,
        locked,
        () => {
          close(true)
          actions.unmount()
        },
        enabled,
      ),
    confirm: () => session.teamStore.confirm(team, locked),
    cancel: () => session.teamStore.cancel(),
  }

  const showModels = () => {
    actions.showModels(
      Math.max(
        0,
        rows.findIndex(
          (row) => row.group.id === current?.provider && row.model.id === current.model,
        ),
      ),
    )
  }

  const toggle = () => {
    if (store.getState().open) close(true)
    else {
      actions.show(model ? 'effort' : 'models')
      refresh()
    }
  }

  const onPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (pane === 'models' && model) actions.setPane('effort')
      else close(true)
      return
    }
    if (pane === 'models') {
      handlePickerKeyDown(event, {
        container: event.currentTarget,
        searchInput: search.current,
        onStepHighlight: (delta) => {
          const highlight = store.getState().highlight
          actions.highlight(rows.length ? (highlight + delta + rows.length) % rows.length : 0)
        },
        onConfirm: () => {
          const row = rows[store.getState().highlight]
          if (row && !busy) void chooseModel(row.group.id, row.model)
        },
      })
    } else {
      trapFocusTabKey(event, event.currentTarget)
    }
  }

  const bindTriggerButton = (el: HTMLButtonElement | null) => {
    bindTrigger(el)
    popover.bindAnchor(el)
  }
  const bindSurface = (el: HTMLDivElement | null) => popover.bindSurface(el)
  const bindContent = (el: HTMLDivElement | null) => {
    popover.bindContent(el)
    if (el && locked && store.getState().open) actions.close()
  }

  return (
    <>
      <SelectorTrigger
        ref={bindTriggerButton}
        store={store}
        routeKey={routeKey}
        speedStore={speedStore}
        speedKey={speedRoute}
        modelName={modelName}
        efforts={efforts}
        selected={selected}
        locked={locked}
        id={id}
        onToggle={toggle}
      />
      {mounted &&
        createPortal(
          <MenuSurface
            ref={bindSurface}
            id={id}
            role="dialog"
            aria-label="模型与推理强度"
            aria-hidden={!effectiveOpen || !positioned || undefined}
            aria-busy={selecting || state.status === 'loading'}
            className="rong-popover-surface rong-model-popover"
            data-open={effectiveOpen}
            data-pane={pane}
            style={
              {
                ...(position ?? { visibility: 'hidden' }),

                // 内距 18 + 工具栏 26 + 间距 8；无结果时也留一行显示状态。
                '--rong-list-height': `${Math.min(344, 52 + Math.max(1, rows.length) * 33 + groups.length * 26)}px`,
              } as CSSProperties
            }
            onKeyDown={onPopoverKeyDown}
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === 'transform' &&
                !effectiveOpen
              )
                actions.unmount()
            }}
          >
            <div key={pane} className="rong-model-content" ref={bindContent}>
              {pane === 'effort' ? (
                <EffortPanel
                  ref={effectiveOpen && positioned ? focusWhenFront : undefined}
                  store={store}
                  speedStore={speedStore}
                  team={team}
                  teamInteraction={teamInteraction}
                  routeKey={routeKey}
                  speedRoute={speedRoute}
                  model={model}
                  modelName={modelName}
                  efforts={efforts}
                  selected={selected}
                  open={effectiveOpen}
                  locked={locked}
                  selecting={selecting}
                  onPreview={preview}
                  chooseEffort={chooseEffort}
                  showModels={showModels}
                />
              ) : (
                <ModelList
                  ref={search}
                  store={store}
                  groups={groups}
                  rowCount={rows.length}
                  query={query}
                  current={current}
                  busy={selecting}
                  locked={locked}
                  hasModel={!!model}
                  focusReady={effectiveOpen && positioned}
                  status={state.status}
                  id={id}
                  chooseModel={chooseModel}
                />
              )}
              {(visibleError || state.failures.length > 0) && (
                <div className="rong-error" role="alert">
                  <span>
                    {visibleError ??
                      `部分模型未能加载：${state.failures.map((failure) => failure.name).join('、')}`}
                  </span>
                  <button type="button" disabled={busy} onClick={refresh}>
                    重新加载
                  </button>
                </div>
              )}
              <span className="rong-sr-only" role="status" aria-live="polite">
                {selecting ? '正在保存选择' : ''}
              </span>
            </div>
          </MenuSurface>,
          document.body,
        )}
      <TeamDisableDialog interaction={teamInteraction} disabled={locked || !team?.ready} />
      {error && (
        <Toast
          key={errorSequence}
          text={error}
          icon={<IconWarningOutlineRegular />}
          anchor={toastAnchor}
          holdMs={5000}
          onDone={() => actions.dismissError(errorSequence)}
        />
      )}
    </>
  )
}
