import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SPEED_LABELS, type SpeedMode } from '../../shared/speed.ts'
import { FastIcon } from './SelectorIcons.tsx'
import { useSpeedSelection } from './useSpeedSelection.ts'
import type { SpeedStore } from './speed-store.ts'

interface Props {
  store: SpeedStore
  identityKey: string
  open: boolean
  disabled: boolean
}

export const SpeedControl = memo(function SpeedControl(props: Props) {
  return <Control key={props.identityKey} {...props} />
})

function Control({ store, identityKey, open, disabled }: Props) {
  const { state, loading, saving, select } = useSpeedSelection(store, identityKey)
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const enabled = state.modes.length > 1 && !loading && !saving && !disabled
  const visible = expanded && open && enabled

  useEffect(() => {
    if (!open || !enabled) setExpanded(false)
  }, [open, enabled])

  useLayoutEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    if (!mounted) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
      return
    }
    // 正常由 transitionend 卸载；取消过渡、隐藏页面等情况由这个兜底清理。
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [visible, mounted])

  useLayoutEffect(() => {
    if (!visible || !mounted) return
    const place = () => {
      const anchor = button.current?.getBoundingClientRect()
      const surface = menu.current
      if (!anchor || !surface) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const preferredLeft = anchor.right + 6
      const x = Math.max(
        left + 12,
        Math.min(
          preferredLeft + surface.offsetWidth <= left + width - 12
            ? preferredLeft
            : anchor.left - 6 - surface.offsetWidth,
          left + width - surface.offsetWidth - 12,
        ),
      )
      const y = Math.max(
        top + 12,
        Math.min(anchor.top - 4, top + height - surface.offsetHeight - 12),
      )
      const next = {
        left: x,
        top: y,
        transformOrigin: `${Math.max(0, Math.min(surface.offsetWidth, anchor.left + anchor.width / 2 - x))}px ${Math.max(0, Math.min(surface.offsetHeight, anchor.top + anchor.height / 2 - y))}px`,
      }
      setPosition((previous) =>
        previous.left === next.left &&
        previous.top === next.top &&
        previous.transformOrigin === next.transformOrigin
          ? previous
          : next,
      )
    }
    place()
    const observer = new ResizeObserver(place)
    if (menu.current) observer.observe(menu.current)
    if (button.current) observer.observe(button.current)
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !button.current?.contains(event.target as Node)
      )
        setExpanded(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [visible, mounted])

  useLayoutEffect(() => {
    if (!visible || !mounted || position.visibility === 'hidden') return
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true })
  }, [visible, mounted, position.visibility])

  function choose(mode: SpeedMode) {
    if (!visible) return
    setExpanded(false)
    button.current?.focus()
    void select(mode)
  }

  return (
    <>
      <button
        ref={button}
        className="rong-icon-button rong-header-action rong-fast"
        type="button"
        disabled={!enabled}
        aria-label={
          state.modes.length > 1
            ? `速度：${SPEED_LABELS[state.mode]}`
            : `Fast 不可用：${state.reason ?? (loading ? '正在读取速度设置' : '此模型不在支持规则内')}`
        }
        aria-haspopup="menu"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            if (!expanded) setExpanded(true)
            else {
              const items = menu.current?.querySelectorAll<HTMLButtonElement>('button')
              const index = event.key === 'ArrowDown' ? 0 : (items?.length ?? 1) - 1
              items?.[index]?.focus()
            }
          }
          if (expanded && event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setExpanded(false)
          }
          if (event.key === 'Tab') setExpanded(false)
        }}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <FastIcon active={state.mode !== 'standard' && state.modes.length > 1} />
      </button>
      {mounted &&
        createPortal(
          <MenuSurface
            compact
            ref={menu}
            id={id}
            role={visible ? 'menu' : undefined}
            aria-hidden={!visible || undefined}
            aria-label="速度模式"
            data-rong-speed-menu
            data-open={visible}
            className="rong-speed-menu"
            style={position}
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === 'transform' &&
                !visible
              )
                setMounted(false)
            }}
            onKeyDown={(event) => {
              if (!visible) return
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
              )
              const current = items.indexOf(document.activeElement as HTMLButtonElement)
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const index =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                        items.length
                items[index]?.focus()
              }
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault()
                setExpanded(false)
                button.current?.focus()
              }
              event.stopPropagation()
            }}
          >
            <div className="rong-speed-items">
              {state.modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={state.mode === mode}
                  disabled={!visible}
                  onClick={() => void choose(mode)}
                >
                  <span>{SPEED_LABELS[mode]}</span>
                  <span className="rong-speed-check" aria-hidden="true">
                    {state.mode === mode && <IconCheckOutlineRegular size={16} />}
                  </span>
                </button>
              ))}
            </div>
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}
