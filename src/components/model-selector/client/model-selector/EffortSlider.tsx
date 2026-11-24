/** 滑杆手势层：指针拖动只预览，释放才提交；键盘直接选择，取消手势不提交。 */

import { useRef, useState, type KeyboardEvent } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { clamp, detentAt } from '../../shared/slider-motion.ts'
import { createSliderMotion } from './slider-motion-controller.ts'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 模型目录提供的明确档位，顺序即滑杆方向。 */
  efforts: readonly ModelReasoningEffort[]

  /** 面板投影后的显示 ID；手势、待确认和已确认状态共用此受控值。 */
  selected: string | undefined

  /** 锁定或弹层关闭时禁止交互并退出 Tab 顺序。 */
  disabled: boolean

  /** 请求处理中只阻止新手势，保留当前焦点和视觉状态。 */
  busy: boolean

  /** 仅同步拖动标题；undefined 清理预览，不发请求。 */
  onPreview: (id: string | undefined) => void

  /** 提交与待确认预览交给控制器；滑杆不持有异步请求副本。 */
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

  /** 取消正在进行的拖动并清理预览与失焦监听；不提交未完成选择。 */
  const cancel = () => {
    // 松手后的 blur / lostpointercapture 不得取消正在等待宿主确认的预览。
    if (!drag.current) return
    drag.current = null
    dragAbort.current?.abort()
    dragAbort.current = null
    setDragging(false)
    onPreview(undefined)
  }

  /** 把屏幕横坐标换算为滑块圆心在有效轨道中的 0–1 位置。 */
  const point = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect()
    return clamp((clientX - rect.left - 14) / Math.max(1, rect.width - 28), 0, 1)
  }

  /** 只发布档位 ID；面板、入口与滑杆从同一 store 投影显示。 */
  const show = (next: number) => {
    onPreview(efforts[next]?.id)
  }

  /** 松手和键盘只发一次提交；保存、拒绝回退及跨挂载清理由控制器负责。 */
  const commit = (next: number) => {
    if (blocked) return
    const effort = efforts[next]
    if (!effort) return
    void onCommit(effort.id)
  }

  /** Escape 取消拖动；方向键和 Home/End 直接提交合法档位。 */
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
