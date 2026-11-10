/** 滑杆绘制层：RAF 拥有运动样式与粒子节点，React 仅提供容器和可访问性结构。 */

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { advanceMotion } from '../../shared/slider-motion.ts'
import { energyFor, particlesFor } from '../../shared/particle-motion.ts'

/** 动画输入与 DOM 所有权；不接收完整 React 业务状态。 */
interface Props {
  /** 滑杆根节点，承载归一化位置 CSS 变量。 */
  root: RefObject<HTMLDivElement>

  /** 目标位置 0–1，模型档位索引在调用方换算。 */
  target: number

  /** 是否存在真实/预览档位；没有时不显示粒子和经过标记。 */
  hasSelection: boolean

  /** 档位圆点数量，用于计算经过状态。 */
  count: number
}

/** 动画拥有这些 DOM 样式和粒子节点；逐帧位移不进入 React / Immer 状态。 */
export function useSliderMotion({ root, target, hasSelection, count }: Props) {
  const sparkles = useRef<HTMLDivElement>(null)
  const ticks = useRef<HTMLDivElement>(null)
  const motion = useRef({ position: target, velocity: 0 })

  useLayoutEffect(() => {
    paint(motion.current.position)

    /** 绘制一个连续位置：复用已有粒子节点，仅按数量增删，并更新圆点经过标记。 */
    function paint(position: number) {
      root.current?.style.setProperty('--rong-position', String(position))
      const container = sparkles.current
      if (!container) return
      container.style.opacity = String(0.6 + 0.4 * (hasSelection ? energyFor(position) : 0))
      const particles = hasSelection ? particlesFor(position) : []
      while (container.childElementCount > particles.length) container.lastElementChild!.remove()
      particles.forEach((particle, index) => {
        let star = container.children[index] as HTMLSpanElement | undefined
        if (!star) {
          star = document.createElement('span')
          star.className = 'rong-effort-star'
          star.style.top = `${particle.y}%`
          const light = document.createElement('i')
          light.style.opacity = String(particle.brightness)
          light.style.transform = `scale(${particle.brightness.toFixed(3)})`
          star.append(light)
          container.append(star)
        }
        star.style.animationDuration = `${particle.duration.toFixed(3)}s`
        star.style.animationDelay = `${particle.delay.toFixed(3)}s`
      })
      if (ticks.current)
        Array.from(ticks.current.children).forEach((tick, index) => {
          const passed = hasSelection && index / Math.max(1, count - 1) <= position
          if (passed) {
            if (!tick.hasAttribute('data-passed')) tick.setAttribute('data-passed', 'true')
          } else tick.removeAttribute('data-passed')
        })
    }

    // 同一次挂载只维护一个循环；目标变化时保留当前速度，延续原有运动曲线。
    let frame = 0
    let last = performance.now()

    /** 计算秒级帧间隔并推进运动；静止后停止循环，目标变化会由 effect 重启。 */
    const step = () => {
      const now = performance.now()
      motion.current = advanceMotion(motion.current, target, (now - last) / 1000)
      last = now
      paint(motion.current.position)
      if (motion.current.position !== target || motion.current.velocity !== 0)
        frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [root, target, hasSelection, count])

  return { sparkles, ticks }
}
