/** 白名单浮层定位：只负责自身几何与视口约束，材质和模态焦点由宿主组件管理。 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** 跟随锚点、滚动和尺寸变化；空间不足时向上展开，卸载时释放全部观察资源。 */
export function usePickerPosition(
  anchor: RefObject<HTMLElement>,
  panel: RefObject<HTMLElement>,
): CSSProperties | null {
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    const trigger = anchor.current
    const surface = panel.current
    if (!trigger || !surface) return
    const update = () => {
      const rect = trigger.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const width = Math.min(surface.offsetWidth, Math.max(0, window.innerWidth - margin * 2))
      // 滚动可能把锚点带出视口，浮层仍保留在可见边界内。
      const top = Math.max(margin, rect.bottom + gap)
      const bottom = Math.max(margin, window.innerHeight - rect.top + gap)
      const below = Math.max(0, window.innerHeight - top - margin)
      const above = Math.max(0, window.innerHeight - bottom - margin)
      const opensBelow = below >= Math.min(surface.scrollHeight, above) || below >= above
      setPosition({
        position: 'fixed',
        left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)),
        ...(opensBelow ? { top } : { bottom }),
        maxHeight: Math.min(344, opensBelow ? below : above),
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(trigger)
    observer.observe(surface)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor, panel])
  return position
}
