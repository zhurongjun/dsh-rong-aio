import {
  useEffect,
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
  MenuSurface,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconDataOutlineRegular,
  IconSearchOutlineRegular,
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
import { FastIcon, ResetIcon } from './SelectorIcons.tsx'

import { SpeedControl } from './SpeedControl.tsx'
import { useSpeedSelection } from './useSpeedSelection.ts'
import { SPEED_LABELS } from '../../shared/speed.ts'

type Props = ModelSelectInjected &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'sessionId'>

/** 让会话切换重新建立瞬时 UI 状态；持久化状态始终由 DSH 目录持有。 */
export function ModelSelector(props: Props) {
  return <Selector key={props.sessionId} {...props} />
}

function Selector({ locked, available, directory, load, select, sessionId }: Props) {
  const state = useSyncExternalStore(
    (notify) => directory.subscribe(notify),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pane, setPane] = useState<'effort' | 'models'>('effort')
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [preview, setPreview] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const header = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const id = useId()
  const current = state.pending ?? state.current
  const model = currentModelOf(state.groups, current)
  const efforts = effortsOf(model)
  const effort = efforts.find((entry) => entry.id === preview) ?? currentEffortOf(model, current)
  const groups = filterModels(state.groups, query)
  const rows = groups.flatMap((group) => group.models.map((model) => ({ group, model })))
  const busy = saving || state.pending !== null || locked
  const title = effort?.name ?? (efforts.length ? '请选择强度' : '推理强度')
  const modelName = model?.name ?? current?.model ?? '选择模型'
  const routeKey = JSON.stringify([
    current?.provider,
    current?.model,
    efforts.map((entry) => entry.id),
  ])

  const speed = useSpeedSelection(
    available && current
      ? { sessionId, provider: current.provider, model: current.model }
      : undefined,
    open,
    setError,
  )
  const fastActive = speed.state.mode !== 'standard' && speed.state.modes.includes(speed.state.mode)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 120)
    return () => window.clearTimeout(timer)
  }, [open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    setPreview(undefined)
    if (restoreFocus) trigger.current?.focus()
  }

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
  }, [open])

  useEffect(() => {
    if (locked || !available) close()
  }, [locked, available])

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
      setPosition({ left: x, top: Math.max(top + 12, y) })
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
    if (pane === 'models') search.current?.focus()
    else header.current?.focus({ preventScroll: true })
  }, [open, mounted, pane, position.visibility])

  useEffect(() => {
    setPreview(undefined)
  }, [routeKey])

  useEffect(() => {
    if (pane === 'models') {
      menu.current
        ?.querySelector(`[data-model-index="${highlight}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlight, pane])

  async function submit(selection: ModelSelection): Promise<boolean> {
    if (inFlight.current || locked || state.pending !== null) return false
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await select(selection)
      if (!result?.ok) throw new Error(result ? result.error.message : '当前会话无法切换模型')
      return true
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '保存失败，请重试')
      return false
    } finally {
      inFlight.current = false
      if (alive.current) {
        setSaving(false)
        setPreview(undefined)
      }
    }
  }

  function chooseEffort(value: string) {
    if (!current || !efforts.some((entry) => entry.id === value)) return
    if (current.reasoningEffort === value) return
    void submit({ provider: current.provider, model: current.model, reasoningEffort: value })
  }

  async function chooseModel(provider: string, next: ModelCatalogModel) {
    const result = await submit(selectionFor(provider, next))
    if (result && alive.current) {
      setPane('effort')
      setPreview(undefined)
    }
  }

  const showModels = () => {
    setQuery('')
    setHighlight(
      Math.max(
        0,
        rows.findIndex(
          (row) => row.group.id === current?.provider && row.model.id === current.model,
        ),
      ),
    )
    setPane('models')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (pane === 'models' && model) setPane('effort')
      else close(true)
    }
    if (pane === 'models' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      setHighlight((value) =>
        rows.length
          ? (value + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
          : 0,
      )
      search.current?.focus()
    }
    if (pane === 'models' && event.target === search.current && event.key === 'Enter') {
      event.preventDefault()
      const row = rows[highlight]
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
      <button
        ref={trigger}
        type="button"
        className="rong-model-trigger"
        disabled={locked}
        aria-label={`选择模型与推理强度：${modelName}${effort ? `，${effort.name}` : ''}${fastActive ? `，${SPEED_LABELS[speed.state.mode]}模式` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) {
            close(true)
            return
          }
          setQuery('')
          setError(null)
          setPreview(undefined)
          setPane(model ? 'effort' : 'models')
          setOpen(true)
          setMounted(true)
          load()
        }}
      >
        {fastActive ? (
          <span
            className="rong-trigger-fast"
            aria-hidden="true"
            title={`${SPEED_LABELS[speed.state.mode]}模式`}
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
                '--rong-list-height': `${Math.min(344, 90 + rows.length * 33 + groups.length * 26)}px`,
              } as CSSProperties
            }
            onKeyDown={onKeyDown}
          >
            {pane === 'effort' ? (
              <div className="rong-effort-pane" key="effort">
                <div className="rong-effort-header">
                  <SpeedControl
                    identity={{
                      sessionId,
                      provider: current?.provider ?? '',
                      model: current?.model ?? '',
                    }}
                    open={open && !!current}
                    disabled={busy}
                    {...speed}
                  />
                  <button
                    ref={header}
                    className="rong-model-heading"
                    type="button"
                    onClick={showModels}
                    disabled={busy}
                  >
                    <span className="rong-effort-title">{title}</span>
                    <span className="rong-model-label">
                      <span className="rong-model-name" title={modelName}>
                        {modelName}
                      </span>
                      <IconChevronRightOutlineRegular size={10} />
                    </span>
                  </button>
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
                    selected={currentEffortOf(model, current)?.id}
                    disabled={busy || !open}
                    onPreview={setPreview}
                    onCommit={chooseEffort}
                  />
                ) : (
                  <p className="rong-empty">
                    {model ? '此模型未提供可选推理强度' : '当前模型不可用，请重新选择'}
                  </p>
                )}
              </div>
            ) : (
              <div className="rong-models-pane" key="models">
                <div className="rong-list-heading">
                  <button
                    className="rong-icon-button"
                    type="button"
                    aria-label="返回强度选择"
                    disabled={!model}
                    onClick={() => setPane('effort')}
                  >
                    <IconChevronLeftOutlineRegular size={18} />
                  </button>
                  <strong>选择模型</strong>
                  <span />
                </div>
                <div className="rong-search">
                  <IconSearchOutlineRegular size={16} />
                  <input
                    ref={search}
                    placeholder="搜索模型…"
                    aria-label="搜索模型"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setHighlight(0)
                    }}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={`${id}-list`}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      rows[highlight] ? `${id}-option-${highlight}` : undefined
                    }
                  />
                </div>
                <div className="rong-model-list" role="listbox" id={`${id}-list`} aria-label="模型">
                  {groups.map((group) => (
                    <div key={group.id} role="group" aria-label={group.name}>
                      <div className="rong-provider-name">{group.name}</div>
                      {group.models.map((entry) => {
                        const rowIndex = rows.findIndex(
                          (row) => row.group.id === group.id && row.model.id === entry.id,
                        )
                        const selected =
                          current?.provider === group.id && current.model === entry.id
                        return (
                          <button
                            type="button"
                            role="option"
                            key={entry.id}
                            id={`${id}-option-${rowIndex}`}
                            tabIndex={-1}
                            data-model-index={rowIndex}
                            data-highlighted={rowIndex === highlight || undefined}
                            aria-selected={selected}
                            disabled={busy}
                            className="rong-model-option"
                            onPointerMove={() => setHighlight(rowIndex)}
                            onClick={() => void chooseModel(group.id, entry)}
                          >
                            <span title={entry.name}>{entry.name}</span>
                            {selected && <IconCheckOutlineRegular size={18} />}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                  {!rows.length && (
                    <p className="rong-empty">
                      {state.status === 'loading'
                        ? '正在加载模型…'
                        : query
                          ? '没有匹配的模型'
                          : '暂无可用模型'}
                    </p>
                  )}
                </div>
              </div>
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
                    setError(null)
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
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}
