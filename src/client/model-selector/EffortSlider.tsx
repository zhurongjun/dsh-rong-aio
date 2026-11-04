import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { advanceMotion, clamp, detentAt } from '../../shared/slider-motion.ts'
import { energyFor, particlesFor } from '../../shared/particle-motion.ts'

interface Props {
  efforts: readonly ModelReasoningEffort[]
  selected: string | undefined
  disabled: boolean
  onPreview: (id: string | undefined) => void
  onCommit: (id: string) => void
}

export function EffortSlider({ efforts, selected, disabled, onPreview, onCommit }: Props) {
  const selectedIndex = efforts.findIndex((effort) => effort.id === selected)
  const [preview, setPreview] = useState<number | null>(null)
  const [reduced, setReduced] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; index: number } | null>(null)
  const motion = useRef({
    position: Math.max(0, selectedIndex) / Math.max(1, efforts.length - 1),
    velocity: 0,
  })
  const [shown, setShown] = useState(motion.current.position)
  const frame = useRef(0)
  const index = preview ?? selectedIndex
  const target = Math.max(0, index) / Math.max(1, efforts.length - 1)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    let last = performance.now()
    const paint = () => {
      const now = performance.now()
      motion.current = reduced
        ? { position: target, velocity: 0 }
        : advanceMotion(motion.current, target, (now - last) / 1000)
      last = now
      root.current?.style.setProperty('--rong-position', String(motion.current.position))
      setShown(motion.current.position)
      if (motion.current.position !== target || motion.current.velocity !== 0) {
        frame.current = requestAnimationFrame(paint)
      }
    }
    frame.current = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame.current)
  }, [target, reduced])

  const cancel = () => {
    drag.current = null
    setPreview(null)
    onPreview(undefined)
  }
  useEffect(() => {
    // 弹窗失焦不提交未完成手势；pointercancel / Escape 同样回退。
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  })

  const point = (clientX: number) => {
    const rect = root.current!.getBoundingClientRect()
    return clamp((clientX - rect.left - 14) / Math.max(1, rect.width - 28), 0, 1)
  }
  const show = (next: number) => {
    setPreview(next)
    onPreview(efforts[next]?.id)
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (disabled || efforts.length < 2) return
    const base = Math.max(0, selectedIndex)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? efforts.length - 1
          : ['ArrowRight', 'ArrowUp'].includes(event.key)
            ? base + 1
            : ['ArrowLeft', 'ArrowDown'].includes(event.key)
              ? base - 1
              : null
    if (next === null) return
    event.preventDefault()
    onCommit(efforts[clamp(next, 0, efforts.length - 1)]!.id)
  }

  const energy = index < 0 ? 0 : energyFor(shown)
  const particles = reduced || index < 0 ? [] : particlesFor(shown)

  return (
    <div
      ref={root}
      className="rong-effort-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="推理强度"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, efforts.length - 1)}
      aria-valuenow={Math.max(0, index)}
      aria-valuetext={efforts[index]?.name ?? '尚未选择强度'}
      aria-disabled={disabled || efforts.length < 2}
      data-unset={index < 0 || undefined}
      data-dragging={preview !== null || undefined}
      style={{ '--rong-position': motion.current.position } as CSSProperties}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (disabled || efforts.length < 2 || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        const next = Math.round(point(event.clientX) * (efforts.length - 1))
        drag.current = { pointer: event.pointerId, index: next }
        show(next)
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return
        const next = detentAt(point(event.clientX), drag.current.index, efforts.length)
        if (next !== drag.current.index) {
          drag.current.index = next
          show(next)
        }
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return
        const next = efforts[drag.current.index]
        cancel()
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (next && !disabled) onCommit(next.id)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel()
      }}
    >
      <div className="rong-effort-fill" />
      <div
        className="rong-effort-sparkles"
        aria-hidden="true"
        style={{ opacity: 0.6 + 0.4 * energy }}
      >
        {particles.map((particle, i) => (
          <span
            key={i}
            className="rong-effort-star"
            style={{
              top: `${particle.y}%`,
              animationDuration: `${particle.duration.toFixed(3)}s`,
              animationDelay: `${particle.delay.toFixed(3)}s`,
            }}
          >
            <i
              style={{
                opacity: particle.brightness,
                transform: `scale(${particle.brightness.toFixed(3)})`,
              }}
            />
          </span>
        ))}
      </div>
      <div className="rong-effort-ticks" aria-hidden="true">
        {efforts.map((effort, tickIndex) => (
          <i
            key={effort.id}
            title={effort.name}
            data-passed={
              (index >= 0 && tickIndex / Math.max(1, efforts.length - 1) <= shown) || undefined
            }
          />
        ))}
      </div>
      <div className="rong-effort-thumb" aria-hidden="true" />
    </div>
  )
}
