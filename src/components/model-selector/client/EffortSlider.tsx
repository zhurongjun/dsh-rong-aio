/** 滑杆手势层：指针拖动只预览，释放才提交；键盘直接选择，取消手势不提交。 */

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

/** 可访问的离散档位滑杆；视觉位置由连续动画驱动，但提交值始终是目录 ID。 */
export function EffortSlider({ efforts, selected, disabled, busy, onPreview, onCommit }: Props) {
  const index = efforts.findIndex((effort) => effort.id === selected)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointer: number; index: number } | null>(null)
  const dragAbort = useRef<AbortController | null>(null)
  const blocked = disabled || busy
  const activeDragging = dragging && !blocked
  const target = Math.max(0, index) / Math.max(1, efforts.length - 1)
  const [motion] = useState(createSliderMotion)

  const cancel = () => {
    if (!drag.current) return
    drag.current = null
    dragAbort.current?.abort()
    dragAbort.current = null
    setDragging(false)
    onPreview(undefined)
  }

  const point = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect()
    return clamp((clientX - rect.left - 14) / Math.max(1, rect.width - 28), 0, 1)
  }

  const show = (next: number) => {
    onPreview(efforts[next]?.id)
  }

  const commit = (next: number) => {
    if (blocked) return
    const effort = efforts[next]
    if (!effort) return
    void onCommit(effort.id)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (blocked || efforts.length < 2) return
    const base = Math.max(0, index)
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
    void commit(clamp(next, 0, efforts.length - 1))
  }

  const hasSelection = index >= 0
  const effortCount = efforts.length
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
        const next = Math.round(point(event.currentTarget, event.clientX) * (efforts.length - 1))
        drag.current = { pointer: event.pointerId, index: next }
        setDragging(true)
        show(next)
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return
        const next = detentAt(
          point(event.currentTarget, event.clientX),
          drag.current.index,
          efforts.length,
        )
        if (next !== drag.current.index) {
          drag.current.index = next
          show(next)
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
          void commit(next)
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
