/** 粒子排布与速度参数的纯计算；确定性种子保证重渲染时视觉连续。 */

/** Adapted from Microqian2th/dsh-codex-effort-slider fc5a994 (MIT). See THIRD_PARTY_NOTICES. */
import { clamp } from './slider-motion.ts'

/** 固定上游参数；改变它们会改变动画手感，需与上游输出 fixture 一并核对。 */
export const PARTICLE_PARAMETERS = {
  /** 最大粒子数；实际数量按滑块能量线性取整。 */
  count: 22,

  /** 最高速度下单次横穿的平均秒数。 */
  durationMean: 1.5,

  /** 时长离散幅度，避免粒子完全同步。 */
  durationSpread: 0.08,

  /** 最低亮度，同时用于粒子的缩放系数。 */
  brightnessMin: 0.5,

  /** 黄金比分布相位，让负延迟错开粒子位置。 */
  goldenRatio: 0.6180339887498949,

  /** 滑块低位置时的最小速度因子。 */
  speedMin: 0.35,

  /** 滑块高位置时的最大速度因子。 */
  speedMax: 2,

  /** 相邻相位粒子在高度槽中的最小间隔。 */
  heightSlots: 3,
} as const

/** 从索引和盐生成稳定的 0–1 离散值；不使用运行时随机数。 */
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

/** 滑块前 1/3 不产生粒子能量，之后线性增长到 1。 */
export function energyFor(position: number) {
  return clamp((clamp(position, 0, 1) - 1 / 3) / (1 - 1 / 3), 0, 1)
}

/**
 * 为当前位置生成可绘制粒子参数：高度百分比、横穿秒数、负延迟和亮度。
 * 返回新数组，固定粒子基表不被修改。
 */
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
