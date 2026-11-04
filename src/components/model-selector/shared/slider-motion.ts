/** Adapted from Microqian2th/dsh-codex-effort-slider fc5a994 (MIT). See THIRD_PARTY_NOTICES. */
export interface MotionState {
  position: number
  velocity: number
}

/** 上游 MOTION_FAST 的完整参数，非官方 Codex 常量。 */
export const MOTION = { K: 60, A: 500, k: 60, amax: 300, vmax: 10, epsX: 0.0015, epsV: 0.02 }

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** 上游 detentTargetIndex：前进 1/3 档、后退 2/3 档，快速移动可跨多档。 */
export function detentAt(position: number, previous: number, count: number) {
  if (count < 2) return 0
  const scaled = clamp(position, 0, 1) * (count - 1)
  const current = clamp(previous, 0, count - 1)
  if (scaled >= current + 1 / 3)
    return Math.min(count - 1, Math.max(current + 1, Math.round(scaled)))
  if (scaled <= current - 2 / 3) return Math.max(0, Math.min(current - 1, Math.round(scaled)))
  return current
}

/** 上游 motionStep：刹车预测、连续速度跟踪、过冲与端点钳制，松手不外推。 */
export function advanceMotion(state: MotionState, target: number, elapsed: number): MotionState {
  const dt = clamp(elapsed, 0, 0.05)
  const error = target - state.position
  const desired =
    Math.sign(error) *
    Math.min(MOTION.K * Math.abs(error), Math.sqrt(2 * MOTION.A * Math.abs(error)), MOTION.vmax)
  const acceleration = clamp(MOTION.k * (desired - state.velocity), -MOTION.amax, MOTION.amax)
  let velocity = clamp(state.velocity + acceleration * dt, -MOTION.vmax, MOTION.vmax)
  if (error !== 0 && Math.abs(velocity * dt) >= Math.abs(error))
    return { position: target, velocity: 0 }
  const raw = state.position + velocity * dt
  const position = clamp(raw, 0, 1)
  if (position !== raw && ((position === 0 && velocity < 0) || (position === 1 && velocity > 0)))
    velocity = 0
  if (Math.abs(target - position) < MOTION.epsX && Math.abs(velocity) < MOTION.epsV)
    return { position: target, velocity: 0 }
  return { position, velocity }
}
