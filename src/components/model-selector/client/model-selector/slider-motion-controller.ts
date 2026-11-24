/** 滑杆绘制控制器：Layout Ref 挂载期运行 RAF 与粒子 DOM 更新，卸载时取消帧调度。 */

import { advanceMotion } from '../../shared/slider-motion.ts'
import { energyFor, particlesFor } from '../../shared/particle-motion.ts'

/** 动画拥有滑杆位置 CSS 变量和粒子 DOM；逐帧位移不进入 React / Zustand 状态。 */
export function createSliderMotion() {
  let rootEl: HTMLDivElement | null = null
  let sparklesEl: HTMLDivElement | null = null
  let ticksEl: HTMLDivElement | null = null
  let motion = { position: 0, velocity: 0 }
  let goal = { target: 0, hasSelection: false, count: 0 }
  let initialized = false
  let frame = 0
  let last = 0

  function paint(position: number) {
    rootEl?.style.setProperty('--rong-position', String(position))
    if (sparklesEl) {
      sparklesEl.style.opacity = String(0.6 + 0.4 * (goal.hasSelection ? energyFor(position) : 0))
      const particles = goal.hasSelection ? particlesFor(position) : []
      while (sparklesEl.childElementCount > particles.length) sparklesEl.lastElementChild!.remove()
      particles.forEach((particle, index) => {
        let star = sparklesEl!.children[index] as HTMLSpanElement | undefined
        if (!star) {
          star = document.createElement('span')
          star.className = 'rong-effort-star'
          star.style.top = `${particle.y}%`
          const light = document.createElement('i')
          light.style.opacity = String(particle.brightness)
          light.style.transform = `scale(${particle.brightness.toFixed(3)})`
          star.append(light)
          sparklesEl!.append(star)
        }
        star.style.animationDuration = `${particle.duration.toFixed(3)}s`
        star.style.animationDelay = `${particle.delay.toFixed(3)}s`
      })
    }
    if (ticksEl) {
      Array.from(ticksEl.children).forEach((tick, index) => {
        const passed = goal.hasSelection && index / Math.max(1, goal.count - 1) <= position
        if (passed) {
          if (!tick.hasAttribute('data-passed')) tick.setAttribute('data-passed', 'true')
        } else tick.removeAttribute('data-passed')
      })
    }
  }

  function step() {
    frame = 0
    if (!rootEl) return
    const now = performance.now()
    motion = advanceMotion(motion, goal.target, (now - last) / 1000)
    last = now
    paint(motion.position)
    if (motion.position !== goal.target || motion.velocity !== 0) {
      frame = requestAnimationFrame(step)
    }
  }

  function ensureAnimating() {
    if (!rootEl || frame !== 0) return
    if (motion.position !== goal.target || motion.velocity !== 0) {
      last = performance.now()
      frame = requestAnimationFrame(step)
    }
  }

  function stop() {
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }

  return {
    bindRoot(el: HTMLDivElement | null) {
      rootEl = el
      if (!el) {
        stop()
        return
      }
      paint(motion.position)
      ensureAnimating()
    },

    bindSparkles(el: HTMLDivElement | null) {
      sparklesEl = el
      if (el && rootEl) paint(motion.position)
    },

    bindTicks(el: HTMLDivElement | null) {
      ticksEl = el
      if (el && rootEl) paint(motion.position)
    },

    update(target: number, hasSelection: boolean, count: number) {
      if (!initialized) {
        initialized = true
        motion = { position: target, velocity: 0 }
      }
      goal = { target, hasSelection, count }
      if (!rootEl) return
      paint(motion.position)
      ensureAnimating()
    },
  }
}
