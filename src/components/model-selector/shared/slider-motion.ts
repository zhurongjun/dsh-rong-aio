/** 滑杆的纯运动计算。位置归一化为 0–1，速度按每秒位置变化量计算。 */

/** Adapted from Microqian2th/dsh-codex-effort-slider fc5a994 (MIT). See THIRD_PARTY_NOTICES. */
interface MotionState {
  /** 轨道归一化位置，取值 0–1。 */
  position: number

  /** 每秒归一化位移，带正负方向；切换目标时继续使用当前速度。 */
  velocity: number
}

/** 上游 MOTION_FAST 的完整参数，非官方 Codex 常量。 */
export const MOTION = {
  /** 位置误差到目标速度的比例系数。 */
  K: 60,

  /** 刹停预测使用的加速度，限制靠近目标时的期望速度。 */
  A: 500,

  /** 当前速度追踪目标速度的响应系数。 */
  k: 60,

  /** 实际积分使用的加速度绝对上限。 */
  amax: 300,

  /** 每秒归一化位移的绝对上限。 */
  vmax: 10,

  /** 吸附到目标的最大位置误差。 */
  epsX: 0.0015,

  /** 吸附时允许的最大残余速度。 */
  epsV: 0.02,
}

/** 把有限输入限制在闭区间内；由调用者保证输入属于运动计算所需的数值域。 */
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 上游 detentTargetIndex：前进 1/3 档、后退 2/3 档，快速移动可跨多档。
 * @param position 指针对应的归一化轨道位置。
 * @param previous 上一预览档位索引，用于保持跨档迟滞。
 * @param count 当前模型的档位数量；不足两档时固定返回 0。
 * @returns 合法的离散档位索引，不修改持久化选择。
 */
export function detentAt(position: number, previous: number, count: number) {
  if (count < 2) return 0
  const scaled = clamp(position, 0, 1) * (count - 1)
  const current = clamp(previous, 0, count - 1)
  if (scaled >= current + 1 / 3)
    return Math.min(count - 1, Math.max(current + 1, Math.round(scaled)))
  if (scaled <= current - 2 / 3) return Math.max(0, Math.min(current - 1, Math.round(scaled)))
  return current
}

/**
 * 上游 motionStep：刹车预测、连续速度跟踪、过冲与端点钳制，松手不外推。
 * @param state 上一帧的位置和速度，函数不修改此对象。
 * @param target 目标归一化位置，由调用方保证在 0–1 内。
 * @param elapsed 距上一帧的秒数；单次积分最多推进 0.05 秒。
 * @returns 新的位置和速度；满足收敛条件时精确返回目标位置及零速度。
 */
export function advanceMotion(state: MotionState, target: number, elapsed: number): MotionState {
  const dt = clamp(elapsed, 0, 0.05)
  const error = target - state.position

  // 目标速度同时受距离比例、可刹停速度和最高速度约束。
  const desired =
    Math.sign(error) *
    Math.min(MOTION.K * Math.abs(error), Math.sqrt(2 * MOTION.A * Math.abs(error)), MOTION.vmax)
  const acceleration = clamp(MOTION.k * (desired - state.velocity), -MOTION.amax, MOTION.amax)
  let velocity = clamp(state.velocity + acceleration * dt, -MOTION.vmax, MOTION.vmax)
  if (error !== 0 && Math.abs(velocity * dt) >= Math.abs(error))
    return { position: target, velocity: 0 }

  // 越过目标直接吸附；到达轨道端点时清除继续向外的速度。
  const raw = state.position + velocity * dt
  const position = clamp(raw, 0, 1)
  if (position !== raw && ((position === 0 && velocity < 0) || (position === 1 && velocity > 0)))
    velocity = 0

  // 足够接近时归零速度，让 RAF 能在明确的静止条件下停止。
  if (Math.abs(target - position) < MOTION.epsX && Math.abs(velocity) < MOTION.epsV)
    return { position: target, velocity: 0 }
  return { position, velocity }
}
