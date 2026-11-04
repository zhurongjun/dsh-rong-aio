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
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
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

type Props = ModelSelectInjected &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'sessionId'>

/** 让会话切换重新建立瞬时 UI 状态；持久化状态始终由 DSH 目录持有。 */
export function ModelSelector(props: Props) {
  return <Selector key={props.sessionId} {...props} />
}

function Selector({ locked, available, directory, load, select, sessionId }: Props) {
  const [store] = useState(createSelectorStore)
  const actions = store.getState().actions
  const [speedStore] = useState(() => createSpeedStore(actions.reportError))
  const { open, mounted, pane, query, saving, error } = useStore(
    store,
    useShallow((state) => ({
      open: state.open,
      mounted: state.mounted,
      pane: state.pane,
      query: state.query,
      saving: state.saving,
      error: state.error,
    })),
  )
  const source = useMemo(
    () => ({
      subscribe: (notify: () => void) => directory.subscribe(notify),
      getSnapshot: () => directory.getSnapshot(),
    }),
    [directory],
  )
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const header = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const id = useId()
  const current = state.pending ?? state.current
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      actions.unmount()
      return
    }
    // 正常在 transform 退场完成后卸载；页面隐藏或过渡被取消时仍能清理。
    const timer = window.setTimeout(actions.unmount, 180)
    return () => window.clearTimeout(timer)
  }, [open, mounted, actions])

  const close = useCallback(
    (restoreFocus = false) => {
      actions.close()
      if (restoreFocus) trigger.current?.focus()
    },
    [actions],
  )

  useEffect(() => {
    if (!open) return
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
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, close])

  useEffect(() => {
    if (locked || !available) close()
  }, [locked, available, close])

  useLayoutEffect(() => {
    if (!mounted) return
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
    if (!open || !mounted) return
    if (pane === 'models') search.current?.focus({ preventScroll: true })
    else header.current?.focus({ preventScroll: true })
  }, [open, mounted, pane, position.visibility])

  useEffect(() => {
    actions.preview(undefined)
  }, [routeKey, actions])

  const submit = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      if (locked || directory.getSnapshot().pending !== null || !actions.startSaving()) return false
      try {
        const result = await select(selection)
        if (!result?.ok) throw new Error(result ? result.error.message : '当前会话无法切换模型')
        return true
      } catch (reason) {
        if (alive.current)
          actions.reportError(reason instanceof Error ? reason.message : '保存失败，请重试')
        return false
      } finally {
        if (alive.current) actions.finishSaving()
      }
    },
    [locked, directory, actions, select],
  )

  const chooseEffort = useCallback(
    (value: string) => {
      if (!current || !efforts.some((entry) => entry.id === value)) return
      if (current.reasoningEffort === value) return
      void submit({ provider: current.provider, model: current.model, reasoningEffort: value })
    },
    [current, efforts, submit],
  )

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

  const toggle = useCallback(() => {
    if (store.getState().open) close(true)
    else {
      actions.show(model ? 'effort' : 'models')
      load()
    }
  }, [store, close, actions, model, load])

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
              {(error || state.error || state.failures.length > 0) && (
                <div className="rong-error" role="alert">
                  <span>
                    {error ??
                      state.error ??
                      `部分模型未能加载：${state.failures.map((failure) => failure.name).join('、')}`}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      actions.reportError(null)
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
    </>
  )
}
