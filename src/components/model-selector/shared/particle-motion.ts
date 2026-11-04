/** Adapted from Microqian2th/dsh-codex-effort-slider fc5a994 (MIT). See THIRD_PARTY_NOTICES. */
import { clamp } from './slider-motion.ts'

export const PARTICLE_PARAMETERS = {
  count: 22,
  durationMean: 1.5,
  durationSpread: 0.08,
  brightnessMin: 0.5,
  goldenRatio: 0.6180339887498949,
  speedMin: 0.35,
  speedMax: 2,
  heightSlots: 3,
} as const

function hash(index: number, salt: number) {
  const value = ((index + 1) * salt * 2654435761) % 4294967296
  return ((value >>> 8) % 1000) / 1000
}

/** 相位与高度解耦，沿用上游确定性排列，不用每次渲染变化的随机数。 */
function buildParticles() {
  const { count, goldenRatio, heightSlots } = PARTICLE_PARAMETERS
  const out = Array.from({ length: count }, (_, i) => ({
    y: 0,
    phase: ((i + 1) * goldenRatio) % 1,
  }))
  const byPhase = out.map((_, i) => i).sort((a, b) => out[a]!.phase - out[b]!.phase)
  let slots: number[] | undefined
  for (let salt = 71; salt < 4000 && !slots; salt++) {
    const candidate = out.map((_, i) => i).sort((a, b) => hash(a, salt) - hash(b, salt) || a - b)
    if (candidate.every((slot, i) => i === 0 || Math.abs(slot - candidate[i - 1]!) >= heightSlots))
      slots = candidate
  }
  slots ??= out.map((_, i) => (i * 5) % count)
  byPhase.forEach((index, rank) => {
    out[index]!.y = 8 + (slots![rank]! / (count - 1)) * 84
  })
  return out
}

const particles = buildParticles()

export function energyFor(position: number) {
  return clamp((clamp(position, 0, 1) - 1 / 3) / (1 - 1 / 3), 0, 1)
}

export function particlesFor(position: number) {
  const { count, durationMean, durationSpread, brightnessMin, speedMin, speedMax } =
    PARTICLE_PARAMETERS
  const speed = clamp(3 * clamp(position, 0, 1) - 1, speedMin, speedMax)
  return particles.slice(0, Math.round(energyFor(position) * count)).map((particle, i) => {
    const duration =
      ((durationMean * speedMax) / speed) * (1 - durationSpread + 2 * durationSpread * hash(i, 29))
    return {
      y: particle.y,
      duration,
      delay: -((particle.phase + hash(i, 53) * 0.03) % 1) * duration,
      brightness: brightnessMin + (1 - brightnessMin) * hash(i, 61),
    }
  })
}
