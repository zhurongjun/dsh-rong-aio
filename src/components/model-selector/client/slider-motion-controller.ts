import { advanceMotion } from '../shared/slider-motion.ts'
import { energyFor, particlesFor } from '../shared/particle-motion.ts'

function syncSparkles(el: HTMLDivElement, position: number, active: boolean) {
  el.style.opacity = String(0.6 + 0.4 * (active ? energyFor(position) : 0))
  const particles = active ? particlesFor(position) : []
  while (el.childElementCount > particles.length) el.lastElementChild!.remove()

  particles.forEach((particle, index) => {
    let star = el.children[index] as HTMLSpanElement | undefined
    if (!star) {
      star = document.createElement('span')
      star.className = 'rong-effort-star'
      star.style.top = `${particle.y}%`

      const light = document.createElement('i')
      light.style.opacity = String(particle.brightness)
      light.style.transform = `scale(${particle.brightness.toFixed(3)})`
      star.append(light)
      el.append(star)
    }

    star.style.animationDuration = `${particle.duration.toFixed(3)}s`
    star.style.animationDelay = `${particle.delay.toFixed(3)}s`
  })
}

function syncTicks(el: HTMLDivElement, position: number, active: boolean, count: number) {
  const denom = Math.max(1, count - 1)
  Array.from(el.children).forEach((tick, index) => {
    if (active && index / denom <= position) {
      if (!tick.hasAttribute('data-passed')) tick.setAttribute('data-passed', 'true')
    } else {
      tick.removeAttribute('data-passed')
    }
  })
}

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
    if (sparklesEl) syncSparkles(sparklesEl, position, goal.hasSelection)
    if (ticksEl) syncTicks(ticksEl, position, goal.hasSelection, goal.count)
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
