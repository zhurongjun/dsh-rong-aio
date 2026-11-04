import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { advanceMotion } from '../src/shared/slider-motion.ts'
import { particlesFor } from '../src/shared/particle-motion.ts'

// fixture 来自固定提交的 __internals 实际输出，不由本项目实现生成。
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/upstream-motion.json', import.meta.url), 'utf8'),
)

test('滑块运动与固定上游提交逐帧一致，包括运动中反向', () => {
  for (const sample of fixture.frames) {
    assert.deepEqual(advanceMotion(sample.before, sample.target, sample.elapsed), sample.expected)
  }
})

test('粒子数量、高度、速度、亮度和负相位与固定上游提交一致', () => {
  for (const sample of fixture.stars)
    assert.deepEqual(particlesFor(sample.position), sample.expected)
})
