/** 选择器编排：连接宿主目录、局部状态、定位与键盘流程；宿主确认结果是选模依据。 */

import { useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  isBehindModal,
  MenuSurface,
  Toast,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createAnchoredPopover } from '../../../../client/anchored-popover.ts'
import { useComposerToastAnchor } from '../../../../client/useComposerToastAnchor.ts'
import { buildModelCatalog } from '../../shared/model-selection.ts'
import { speedKey } from '../../shared/speed.ts'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { SelectorTrigger } from './SelectorTrigger.tsx'
import { EffortPanel } from './EffortPanel.tsx'
import { useModelSelection } from './useModelSelection.ts'
import { ModelList } from './ModelList.tsx'
import { type TeamSelection } from './team-store.ts'
import { TeamDisableDialog } from './TeamControl.tsx'
import { handlePopoverKeyDown } from './popover-keyboard.ts'
import { createSelectorSession } from './selector-session.ts'

function focusWhenFront(el: HTMLElement | null) {
  if (el && !isBehindModal(el)) el.focus({ preventScroll: true })
}

/** 复用 DSH 模型插槽契约；available 区分本地会话与独立运行时，locked 控制交互。 */
type Props = Omit<ModelSelectInjected, 'resolveText'> &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'sessionId'> & {
    /** 原生能力与根会话投影均可用时提供。 */
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

  /** 关闭弹层；仅显式键盘/按钮操作需要把焦点恢复到触发按钮。 */
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

  /** 进入模型列表并以当前模型在扁平结果中的位置初始化键盘高亮。 */
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

  /** 关闭时恢复入口焦点；打开时初始化面板并触发宿主目录加载。 */
  const toggle = () => {
    if (store.getState().open) close(true)
    else {
      actions.show(model ? 'effort' : 'models')
      refresh()
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
            aria-hidden={!effectiveOpen || undefined}
            aria-busy={selecting || state.status === 'loading'}
            className="rong-model-popover"
            data-open={effectiveOpen}
            data-pane={pane}
            style={
              {
                ...(position ?? { visibility: 'hidden' }),

                // 内距 18 + 工具栏 26 + 间距 8；无结果时也留一行显示状态。
                '--rong-list-height': `${Math.min(344, 52 + Math.max(1, rows.length) * 33 + groups.length * 26)}px`,
              } as CSSProperties
            }
            onKeyDown={(event) =>
              handlePopoverKeyDown(event, {
                store,
                pane,
                hasModel: !!model,
                busy,
                rows,
                menu: event.currentTarget,
                search,
                close,
                chooseModel,
              })
            }
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
