import { useRef, useState, type KeyboardEvent } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { clamp, detentAt } from '../shared/slider-motion.ts'
import { createSliderMotion } from './slider-motion-controller.ts'

interface Props {
  efforts: readonly ModelReasoningEffort[]
  selected: string | undefined
  disabled: boolean
  busy: boolean
  onPreview: (id: string | undefined) => void
  onCommit: (id: string) => Promise<boolean>
}

function targetIndexForKey(key: string, current: number, count: number): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowUp') return clamp(current + 1, 0, count - 1)
  if (key === 'ArrowLeft' || key === 'ArrowDown') return clamp(current - 1, 0, count - 1)
  return null
}

function trackPosition(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect()
  return clamp((clientX - rect.left - 14) / Math.max(1, rect.width - 28), 0, 1)
}

export function EffortSlider({ efforts, selected, disabled, busy, onPreview, onCommit }: Props) {
  const index = efforts.findIndex((effort) => effort.id === selected)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointer: number; index: number } | null>(null)
  const dragAbort = useRef<AbortController | null>(null)
  const [motion] = useState(createSliderMotion)

  const blocked = disabled || busy
  const activeDragging = dragging && !blocked
  const target = Math.max(0, index) / Math.max(1, efforts.length - 1)
  const hasSelection = index >= 0
  const effortCount = efforts.length

  const cancel = () => {
    if (!drag.current) return
    drag.current = null
    dragAbort.current?.abort()
    dragAbort.current = null
    setDragging(false)
    onPreview(undefined)
  }

  const commit = (next: number) => {
    const effort = !blocked ? efforts[next] : undefined
    if (effort) void onCommit(effort.id)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (blocked || efforts.length < 2) return

    const next = targetIndexForKey(event.key, Math.max(0, index), efforts.length)
    if (next === null) return
    event.preventDefault()
    commit(next)
  }

  const bindRoot = (el: HTMLDivElement | null) => {
    motion.bindRoot(el)
    if (!el) {
      dragAbort.current?.abort()
      dragAbort.current = null
      drag.current = null
    }
  }
  const bindFill = (el: HTMLDivElement | null) => {
    if (el) motion.update(target, hasSelection, effortCount)
  }
  const bindSparkles = (el: HTMLDivElement | null) => motion.bindSparkles(el)
  const bindTicks = (el: HTMLDivElement | null) => motion.bindTicks(el)
  const cancelWhenBlocked = (el: HTMLDivElement | null) => {
    if (el && drag.current) cancel()
  }

  return (
    <div
      ref={bindRoot}
      className="rong-effort-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="推理强度"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, efforts.length - 1)}
      aria-valuenow={Math.max(0, index)}
      aria-valuetext={efforts[index]?.name ?? '尚未选择强度'}
      aria-disabled={blocked || efforts.length < 2}
      data-unset={index < 0 || undefined}
      data-dragging={activeDragging || undefined}
      aria-busy={busy || undefined}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (blocked || efforts.length < 2 || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)

        dragAbort.current?.abort()
        const abort = new AbortController()
        dragAbort.current = abort
        window.addEventListener('blur', cancel, { signal: abort.signal })

        const next = Math.round(
          trackPosition(event.currentTarget, event.clientX) * (efforts.length - 1),
        )
        drag.current = { pointer: event.pointerId, index: next }
        setDragging(true)
        onPreview(efforts[next]?.id)
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return
        const next = detentAt(
          trackPosition(event.currentTarget, event.clientX),
          drag.current.index,
          efforts.length,
        )
        if (next !== drag.current.index) {
          drag.current.index = next
          onPreview(efforts[next]?.id)
        }
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return
        const next = drag.current.index
        dragAbort.current?.abort()
        dragAbort.current = null

        if (blocked) cancel()
        else {
          drag.current = null
          setDragging(false)
          commit(next)
        }
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel()
      }}
    >
      <div className="rong-effort-fill" ref={bindFill} />
      <div ref={bindSparkles} className="rong-effort-sparkles" aria-hidden="true" />
      <div ref={bindTicks} className="rong-effort-ticks" aria-hidden="true">
        {efforts.map((effort) => (
          <i key={effort.id} title={effort.name} />
        ))}
      </div>
      <div
        className="rong-effort-thumb"
        aria-hidden="true"
        ref={blocked ? cancelWhenBlocked : undefined}
      />
    </div>
  )
}
