/** 滑杆手势层：指针拖动只预览，释放才提交；键盘直接选择，取消手势不提交。 */

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { clamp, detentAt } from '../../shared/slider-motion.ts'
import { useSliderMotion } from './useSliderMotion.ts'

/** 本视图所需的输入契约；数据保存与宿主副作用由外层负责。 */
interface Props {
  /** 模型目录提供的明确档位，顺序即滑杆方向。 */
  efforts: readonly ModelReasoningEffort[]

  /** 宿主确认的 effort ID；undefined 表示没有明确选择。 */
  selected: string | undefined

  /** 保存中、锁定或弹层关闭时禁止提交手势。 */
  disabled: boolean

  /** 仅同步拖动标题；undefined 清理预览，不发请求。 */
  onPreview: (id: string | undefined) => void

  /** 提交明确 ID；宿主完成确认或拒绝后结束 Promise，再清理待确认预览。 */
  onCommit: (id: string) => Promise<boolean>
}

/** 可访问的离散档位滑杆；视觉位置由连续动画驱动，但提交值始终是目录 ID。 */
export const EffortSlider = memo(function EffortSlider({
  efforts,
  selected,
  disabled,
  onPreview,
  onCommit,
}: Props) {
  const selectedIndex = efforts.findIndex((effort) => effort.id === selected)
  const [preview, setPreview] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; index: number } | null>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  const index = preview ?? selectedIndex
  const target = Math.max(0, index) / Math.max(1, efforts.length - 1)

  const { sparkles, ticks } = useSliderMotion({
    root,
    target,
    hasSelection: index >= 0,
    count: efforts.length,
  })

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** 取消正在进行的拖动并清理预览；不提交未完成选择。 */
  const cancel = useCallback(() => {
    // 松手后的 blur / lostpointercapture 不得取消正在等待宿主确认的预览。
    if (!drag.current) return
    drag.current = null
    setPreview(null)
    onPreview(undefined)
  }, [onPreview])
  useEffect(() => {
    // 弹窗失焦不提交未完成手势；pointercancel / Escape 同样回退。
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [cancel])

  /** 把屏幕横坐标换算为滑块圆心在有效轨道中的 0–1 位置。 */
  const point = (clientX: number) => {
    const rect = root.current!.getBoundingClientRect()
    return clamp((clientX - rect.left - 14) / Math.max(1, rect.width - 28), 0, 1)
  }

  /** 同步局部档位和标题预览，持久化留到手势结束。 */
  const show = (next: number) => {
    setPreview(next)
    onPreview(efforts[next]?.id)
  }

  /**
   * 松手与键盘共用提交边界；等待期间保留目标位置，避免先回旧档再跳到新档。
   * 已确认值始终来自 selected；失败后回退一次，卸载后的迟到结果不能清理新面板预览。
   */
  const commit = async (next: number) => {
    if (disabled || pending.current) return
    const effort = efforts[next]
    if (!effort) return
    pending.current = true
    show(next)
    try {
      await onCommit(effort.id)
    } finally {
      pending.current = false
      if (alive.current) {
        setPreview(null)
        onPreview(undefined)
      }
    }
  }

  /** Escape 取消拖动；方向键和 Home/End 直接提交合法档位。 */
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (disabled || pending.current || efforts.length < 2) return
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
    void commit(clamp(next, 0, efforts.length - 1))
  }

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
      data-dragging={!!drag.current || undefined}
      aria-busy={pending.current || undefined}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (disabled || pending.current || efforts.length < 2 || event.button !== 0) return
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
        const next = drag.current.index
        if (disabled) cancel()
        else {
          drag.current = null
          void commit(next)
        }
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel()
      }}
    >
      <div className="rong-effort-fill" />
      <div ref={sparkles} className="rong-effort-sparkles" aria-hidden="true" />
      <div ref={ticks} className="rong-effort-ticks" aria-hidden="true">
        {efforts.map((effort) => (
          <i key={effort.id} title={effort.name} />
        ))}
      </div>
      <div className="rong-effort-thumb" aria-hidden="true" />
    </div>
  )
})
