/** 图标选项菜单：Fast 与 Agent Team 共用定位、退场、键盘导航和焦点恢复。 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SelectionButton } from './SelectionButton.tsx'

interface Props<Value extends string> {
  /** 已确认选项与菜单文案；组件不持有业务选择。 */
  value: Value
  items: readonly { value: Value; label: string }[]
  label: string
  menuLabel: string
  icon: ReactNode
  className: string
  /** 主菜单生命周期及业务可用性。 */
  open: boolean
  disabled: boolean
  busy: boolean
  onSelect(value: Value): void
}

/** 业务组件按会话或模型身份重建本组件；只维护 UI 生命周期。 */
export function OptionControl<Value extends string>({
  value,
  items,
  label,
  menuLabel,
  icon,
  className,
  open,
  disabled,
  busy,
  onSelect,
}: Props<Value>) {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const enabled = open && !disabled && !busy
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
    // 正常由 transitionend 卸载；取消过渡、隐藏页面等情况由这个兜底清理。
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [visible, mounted])

  useLayoutEffect(() => {
    if (!visible || !mounted) return

    /** 按图标按钮锚点选择左右侧并夹紧到视口；缩放原点始终靠近锚点。 */
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

    /** 点击按钮和独立门户以外的位置时关闭；不影响主模型面板的事件处理。 */
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

  /** 先收起菜单并恢复按钮焦点，再委托业务保存；不提前改写显示值。 */
  function choose(next: Value) {
    if (!visible) return
    setExpanded(false)
    button.current?.focus()
    onSelect(next)
  }

  return (
    <>
      <SelectionButton
        ref={button}
        className={`rong-icon-button rong-header-action ${className}`}
        disabled={disabled}
        inactive={!open}
        busy={busy}
        aria-label={label}
        title={label}
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
        {icon}
      </SelectionButton>
      {mounted &&
        createPortal(
          <MenuSurface
            compact
            ref={menu}
            id={id}
            role={visible ? 'menu' : undefined}
            aria-hidden={!visible || undefined}
            aria-label={menuLabel}
            data-rong-option-menu
            data-open={visible}
            className="rong-option-menu"
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
            <div className="rong-option-items">
              {items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === item.value}
                  disabled={!visible}
                  onClick={() => void choose(item.value)}
                >
                  <span>{item.label}</span>
                  <span className="rong-option-check" aria-hidden="true">
                    {value === item.value && <IconCheckOutlineRegular size={16} />}
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
