/** 选择器编排：连接宿主目录、局部状态、定位与键盘流程；宿主确认结果是选模依据。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  isBehindModal,
  MenuSurface,
  Toast,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ModelCatalogModel,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import {
  currentEffortOf,
  currentModelOf,
  defaultEffortOf,
  effortsOf,
  filterModels,
  selectionFor,
} from '../../shared/model-selection.ts'
import { EffortSlider } from './EffortSlider.tsx'
import { ResetIcon } from './SelectorIcons.tsx'

import { SpeedControl } from './SpeedControl.tsx'
import { speedKey } from '../../shared/speed.ts'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { createSelectorStore } from './selector-store.ts'
import { createSpeedStore } from './speed-store.ts'
import { SelectorTrigger } from './SelectorTrigger.tsx'
import { EffortHeading } from './EffortHeading.tsx'
import { ModelList } from './ModelList.tsx'

/** 复用 DSH 模型插槽契约；available 区分本地会话与独立运行时，locked 控制交互。 */
type Props = ModelSelectInjected &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'sessionId'>

/** 让会话切换重新建立瞬时 UI 状态；持久化状态始终由 DSH 目录持有。 */
export function ModelSelector(props: Props) {
  return <Selector key={props.sessionId} {...props} />
}

/**
 * 单会话选择器实例。先派生宿主已确认数据，再绑定生命周期、定位、提交与键盘事件。
 * 局部 store 只保存交互状态；不将目录数据写进 Immer，也不把 pending 模型展示为已选。
 */
function Selector({ locked, available, directory, load, select, sessionId }: Props) {
  const [store] = useState(createSelectorStore)
  const actions = store.getState().actions
  const [speedStore] = useState(() => createSpeedStore(actions.reportError))
  const { open, mounted, pane, query, saving, error, errorSequence } = useStore(
    store,
    useShallow((state) => ({
      open: state.open,
      mounted: state.mounted,
      pane: state.pane,
      query: state.query,
      saving: state.saving,
      error: state.error,
      errorSequence: state.errorSequence,
    })),
  )

  // 宿主目录只读订阅：稳定 subscribe/getSnapshot，避免重建模型数据或冻结宿主对象。
  const source = useMemo(
    () => ({
      subscribe: (notify: () => void) => directory.subscribe(notify),
      getSnapshot: () => directory.getSnapshot(),
    }),
    [directory],
  )
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)

  // 与原生选择器一致：目录读取错误留在菜单提供重试，操作拒绝只显示 toast。
  const lastAction = useRef<'load' | 'select'>('load')
  const visibleError = lastAction.current === 'load' ? state.error : null
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const header = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const id = useId()

  // 宿主确认之前保持已接受的模型，避免被拒绝的候选短暂改写文字、effort 与 Fast 状态。
  // 数据派生：实际模型、明确档位、过滤列表及速度身份都只基于已确认选择。
  const current = state.current
  const model = useMemo(
    () => currentModelOf(state.groups, current),
    [state.groups, current?.provider, current?.model],
  )
  const efforts = useMemo(() => effortsOf(model), [model])
  const selected = useMemo(() => currentEffortOf(model, current), [model, current?.reasoningEffort])
  const catalog = useMemo(() => {
    const filtered = filterModels(state.groups, query)
    const rows = filtered.flatMap((group) => group.models.map((model) => ({ group, model })))
    let offset = 0
    const groups = filtered.map((group) => {
      const entry = { group, offset }
      offset += group.models.length
      return entry
    })
    return { groups, rows }
  }, [state.groups, query])
  const { groups, rows } = catalog
  const busy = saving || state.pending !== null || locked
  const modelName = model?.name ?? current?.model ?? '选择模型'
  const routeKey = useMemo(
    () => JSON.stringify([current?.provider, current?.model, efforts.map((entry) => entry.id)]),
    [current?.provider, current?.model, efforts],
  )
  const identity = useMemo(
    () =>
      available && current
        ? { sessionId, provider: current.provider, model: current.model }
        : undefined,
    [available, sessionId, current?.provider, current?.model],
  )
  const speedRoute = identity ? speedKey(identity) : ''

  // 资源生命周期：路由读取、异步结果归属、弹层退场和外部事件成对清理。
  useEffect(() => speedStore.sync(identity, open), [speedStore, identity, open])
  useEffect(() => () => speedStore.dispose(), [speedStore])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (open || !mounted) return
    // 正常在 transform 退场完成后卸载；页面隐藏或过渡被取消时仍能清理。
    const timer = window.setTimeout(actions.unmount, 180)
    return () => window.clearTimeout(timer)
  }, [open, mounted, actions])

  /** 关闭弹层；仅显式键盘/按钮操作需要把焦点恢复到触发按钮。 */
  const close = useCallback(
    (restoreFocus = false) => {
      actions.close()
      if (restoreFocus) trigger.current?.focus()
    },
    [actions],
  )

  useEffect(() => {
    if (!open) return

    /** 忽略主面板、触发按钮及独立 Fast 门户内部的指针事件，其余位置关闭。 */
    const outside = (event: PointerEvent) => {
      if (
        menu.current?.contains(event.target as Node) ||
        trigger.current?.contains(event.target as Node) ||
        (event.target instanceof Element && event.target.closest('[data-rong-speed-menu]'))
      )
        return
      close()
    }

    document.addEventListener('pointerdown', outside)

    /** 原生 Modal 接管焦点时立即卸载当前面板，避免残留退场材质遮住模态内容。 */
    const yieldToModal = () => {
      if (!isBehindModal(menu.current)) return
      close()

      // 原生模态窗拥有焦点时直接释放浮层，避免退出动画盖住模态内容。
      actions.unmount()
    }

    document.addEventListener('focusin', yieldToModal)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', yieldToModal)
    }
  }, [open, close, actions])

  useEffect(() => {
    if (locked || !available) close()
  }, [locked, available, close])

  // 定位与焦点：在 DOM 已挂载后测量；同位置返回原对象以避免无效渲染。
  useLayoutEffect(() => {
    if (!mounted) return

    /** 以触发按钮右边缘对齐面板，优先向上展开，并把整个面板限制在可视视口内。 */
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      const surface = menu.current
      if (!anchor || !surface) return
      const width = surface.offsetWidth
      const height = surface.offsetHeight
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const vw = viewport?.width ?? window.innerWidth
      const vh = viewport?.height ?? window.innerHeight
      const x = Math.max(left + 12, Math.min(anchor.right - width, left + vw - width - 12))
      const above = anchor.top - 8 - height
      const y = above >= top + 12 ? above : Math.min(anchor.bottom + 8, top + vh - height - 12)
      const next = { left: x, top: Math.max(top + 12, y) }
      setPosition((previous) =>
        previous.left === next.left && previous.top === next.top ? previous : next,
      )
    }

    place()
    const observer = new ResizeObserver(place)
    if (menu.current) observer.observe(menu.current)
    if (trigger.current) observer.observe(trigger.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [mounted, pane])

  useEffect(() => {
    if (!open || !mounted || isBehindModal(menu.current)) return
    if (pane === 'models') search.current?.focus({ preventScroll: true })
    else header.current?.focus({ preventScroll: true })
  }, [open, mounted, pane, position.visibility])

  useEffect(() => {
    actions.preview(undefined)
  }, [routeKey, actions])

  /**
   * 串行提交原生 ModelSelection，失败保持目录已确认值并显示 Toast。
   * 卸载后忽略结果；finally 释放本实例保存标记。
   */
  const submit = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      if (locked || directory.getSnapshot().pending !== null || !actions.startSaving()) return false
      lastAction.current = 'select'
      try {
        const result = await select(selection)
        if (!result?.ok) throw new Error(result ? result.error.message : '当前会话无法切换模型')
        return true
      } catch (reason) {
        // toast 属于本会话，菜单关闭后仍可反馈；卸载后不向另一会话写入迟到结果。
        if (alive.current)
          actions.reportError(reason instanceof Error ? reason.message : '保存失败，请重试')
        return false
      } finally {
        if (alive.current) actions.finishSaving()
      }
    },
    [locked, directory, actions, select],
  )

  /** 只提交当前模型目录中的明确档位；相同选择不产生重复写入。 */
  const chooseEffort = useCallback(
    async (value: string): Promise<boolean> => {
      if (!current || !efforts.some((entry) => entry.id === value)) return false
      if (current.reasoningEffort === value) return true
      return submit({ provider: current.provider, model: current.model, reasoningEffort: value })
    },
    [current, efforts, submit],
  )

  /** 按新模型的明确默认档构造选择，宿主确认成功后回到强度面板。 */
  const chooseModel = useCallback(
    async (provider: string, next: ModelCatalogModel) => {
      const result = await submit(selectionFor(provider, next))
      if (result && alive.current) {
        actions.setPane('effort')
        actions.preview(undefined)
      }
    },
    [submit, actions],
  )

  /** 进入模型列表并以当前模型在扁平结果中的位置初始化键盘高亮。 */
  const showModels = useCallback(() => {
    actions.showModels(
      Math.max(
        0,
        rows.findIndex(
          (row) => row.group.id === current?.provider && row.model.id === current.model,
        ),
      ),
    )
  }, [actions, rows, current])

  /** 关闭时恢复入口焦点；打开时初始化面板并触发宿主目录加载。 */
  const toggle = useCallback(() => {
    if (store.getState().open) close(true)
    else {
      lastAction.current = 'load'
      actions.show(model ? 'effort' : 'models')
      load()
    }
  }, [store, close, actions, model, load])

  /** 处理主面板层级：Escape 返回/关闭、方向键切换高亮、Enter 提交和 Tab 焦点循环。 */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (pane === 'models' && model) actions.setPane('effort')
      else close(true)
    }
    if (pane === 'models' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      const value = store.getState().highlight
      actions.highlight(
        rows.length
          ? (value + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
          : 0,
      )
      search.current?.focus({ preventScroll: true })
    }
    if (pane === 'models' && event.target === search.current && event.key === 'Enter') {
      event.preventDefault()
      const row = rows[store.getState().highlight]
      if (row && !busy) void chooseModel(row.group.id, row.model)
    }
    if (event.key === 'Tab') {
      const controls = Array.from(
        menu.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]') ??
          [],
      ).filter((element) => element.tabIndex >= 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  // 渲染边界：独立运行时不接管模型控件；可见 UI 由下方子视图按职责组成。
  if (!available) return null
  return (
    <>
      <SelectorTrigger
        ref={trigger}
        store={store}
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
            ref={menu}
            id={id}
            role="dialog"
            aria-label="模型与推理强度"
            aria-hidden={!open || undefined}
            aria-busy={saving || state.status === 'loading'}
            className="rong-model-popover"
            data-open={open}
            data-pane={pane}
            style={
              {
                ...position,

                // 内距 18 + 工具栏 26 + 间距 8；无结果时也留一行显示状态。
                '--rong-list-height': `${Math.min(344, 52 + Math.max(1, rows.length) * 33 + groups.length * 26)}px`,
              } as CSSProperties
            }
            onKeyDown={onKeyDown}
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === 'transform' &&
                !open
              )
                actions.unmount()
            }}
          >
            <div className="rong-model-content">
              {pane === 'effort' ? (
                <div className="rong-effort-pane" key="effort">
                  <div className="rong-effort-header">
                    <SpeedControl
                      store={speedStore}
                      identityKey={speedRoute}
                      open={open && !!current}
                      disabled={busy}
                    />
                    <EffortHeading
                      ref={header}
                      store={store}
                      efforts={efforts}
                      selected={selected}
                      modelName={modelName}
                      disabled={busy}
                      onClick={showModels}
                    />
                    <button
                      className="rong-icon-button rong-header-action"
                      type="button"
                      aria-label="重置当前模型的推理强度"
                      title="重置强度"
                      disabled={busy || !model || !defaultEffortOf(model)}
                      onClick={() => {
                        if (model) chooseEffort(defaultEffortOf(model)!)
                      }}
                    >
                      <ResetIcon />
                    </button>
                  </div>
                  {efforts.length ? (
                    <EffortSlider
                      key={routeKey}
                      efforts={efforts}
                      selected={selected?.id}
                      disabled={busy || !open}
                      onPreview={actions.preview}
                      onCommit={chooseEffort}
                    />
                  ) : (
                    <p className="rong-empty">
                      {model ? '此模型未提供可选推理强度' : '当前模型不可用，请重新选择'}
                    </p>
                  )}
                </div>
              ) : (
                <ModelList
                  ref={search}
                  store={store}
                  groups={groups}
                  rowCount={rows.length}
                  query={query}
                  current={current}
                  busy={busy}
                  hasModel={!!model}
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      lastAction.current = 'load'
                      load()
                    }}
                  >
                    重新加载
                  </button>
                </div>
              )}
              <span className="rong-sr-only" role="status" aria-live="polite">
                {saving ? '正在保存选择' : ''}
              </span>
            </div>
          </MenuSurface>,
          document.body,
        )}
      {error && (
        <Toast
          key={errorSequence}
          text={error}
          icon={<IconWarningOutlineRegular />}
          anchor={trigger.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          holdMs={5000}
          onDone={() => actions.dismissError(errorSequence)}
        />
      )}
    </>
  )
}
