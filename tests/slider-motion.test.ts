import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceMotion, detentAt } from '../src/shared/slider-motion.ts'

test('离散迟滞在档位边缘不会反复跳动，端点始终有效', () => {
  assert.equal(detentAt(0.32, 0, 2), 0)
  assert.equal(detentAt(0.34, 0, 2), 1)
  assert.equal(detentAt(0.4, 1, 2), 1)
  assert.equal(detentAt(0.32, 1, 2), 0)
  assert.equal(detentAt(5, 0, 6), 5)
  assert.equal(detentAt(-5, 4, 6), 0)
  assert.equal(detentAt(0.5, 0, 1), 0)
})

test('常见帧率下收敛、不越过目标；快速反向保留连续状态', () => {
  for (const hz of [30, 60, 120, 144]) {
    let state = { position: 0, velocity: 0 }
    for (let i = 0; i < hz; i++) {
      state = advanceMotion(state, 1, 1 / hz)
      assert.ok(state.position >= 0 && state.position <= 1)
    }
    assert.deepEqual(state, { position: 1, velocity: 0 })
    for (let i = 0; i < hz; i++) state = advanceMotion(state, 0.25, 1 / hz)
    assert.deepEqual(state, { position: 0.25, velocity: 0 })
  }
  const moving = advanceMotion({ position: 0, velocity: 0 }, 1, 1 / 60)
  const reversed = advanceMotion(moving, 0, 1 / 60)
  assert.ok(Math.abs(reversed.position - moving.position) < 0.17)
})

test('后台切回的长时间间隔被限制，不产生越界或 NaN', () => {
  const next = advanceMotion({ position: 0.25, velocity: 1 }, 0.5, 10)
  assert.ok(Number.isFinite(next.position))
  assert.ok(next.position <= 0.5)
})
