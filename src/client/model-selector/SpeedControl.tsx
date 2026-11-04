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
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const enabled = state.modes.length > 1 && !loading && !saving && !disabled

  useEffect(() => {
    if (!open || !enabled) setExpanded(false)
  }, [open, enabled])

  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const anchor = button.current?.getBoundingClientRect()
      if (!anchor || !menu.current) return
      const next = {
        left: Math.max(
          12,
          Math.min(anchor.right + 8, window.innerWidth - menu.current.offsetWidth - 12),
        ),
        top: Math.max(
          12,
          Math.min(anchor.top - 8, window.innerHeight - menu.current.offsetHeight - 12),
        ),
      }
      setPosition((previous) =>
        previous.left === next.left && previous.top === next.top ? previous : next,
      )
    }
    place()
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true })
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
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [expanded])

  function choose(mode: SpeedMode) {
    if (!enabled) return
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
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
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
        onClick={() => setExpanded(!expanded)}
      >
        <FastIcon active={state.mode !== 'standard' && state.modes.length > 1} />
      </button>
      {expanded &&
        createPortal(
          <MenuSurface
            ref={menu}
            id={id}
            role="menu"
            aria-label="速度模式"
            data-rong-speed-menu
            className="rong-speed-menu"
            style={position}
            onKeyDown={(event) => {
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
            {state.modes.map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={state.mode === mode}
                onClick={() => void choose(mode)}
              >
                <span>{SPEED_LABELS[mode]}</span>
                {state.mode === mode && <IconCheckOutlineRegular size={16} />}
              </button>
            ))}
          </MenuSurface>,
          document.body,
        )}
    </>
  )
}
