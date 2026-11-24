import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ModelCatalogModel,
  ModelProviderGroup,
} from '@deepseek-ai/dsh-api-session-controller/types'
import {
  buildModelCatalog,
  defaultEffortOf,
  effortsOf,
  selectionFor,
} from '../../src/components/model-selector/shared/model-selection.ts'
import {
  energyFor,
  particlesFor,
} from '../../src/components/model-selector/shared/particle-motion.ts'
import {
  advanceMotion,
  clamp,
  detentAt,
} from '../../src/components/model-selector/shared/slider-motion.ts'
import { speedRuleFor } from '../../src/components/model-selector/shared/speed.ts'

function makeModel(
  id: string,
  efforts?: Array<{ id: string; name?: string }>,
  defaultEffort?: string,
  name = id,
): ModelCatalogModel {
  return {
    id,
    name,
    ...(efforts
      ? {
          reasoning: {
            efforts: efforts.map((item) => ({ id: item.id, name: item.name ?? item.id })),
            ...(defaultEffort === undefined ? {} : { defaultEffort }),
          },
        }
      : {}),
  } as ModelCatalogModel
}

test('effortsOf 与 defaultEffortOf：过滤保留档位并按优先级回退默认值', () => {
  const withDeclared = makeModel(
    'm1',
    [{ id: 'default' }, { id: 'auto' }, { id: 'provider-default' }, { id: 'low' }, { id: 'high' }],
    'high',
  )
  assert.deepEqual(
    effortsOf(withDeclared).map((e) => e.id),
    ['low', 'high'],
  )
  assert.equal(defaultEffortOf(withDeclared), 'high')
  assert.deepEqual(selectionFor('openai', withDeclared), {
    provider: 'openai',
    model: 'm1',
    reasoningEffort: 'high',
  })

  const prefersMedium = makeModel(
    'm2',
    [{ id: 'off' }, { id: 'low' }, { id: 'medium' }, { id: 'high' }],
    'auto',
  )
  assert.equal(defaultEffortOf(prefersMedium), 'medium')

  const skipsDisabled = makeModel('m3', [{ id: 'off' }, { id: 'disabled' }, { id: 'high' }])
  assert.equal(defaultEffortOf(skipsDisabled), 'high')

  const onlyOff = makeModel('m4', [{ id: 'none' }])
  assert.equal(defaultEffortOf(onlyOff), 'none')

  const noReasoning = makeModel('m5')
  assert.deepEqual(effortsOf(noReasoning), [])
  assert.deepEqual(selectionFor('openai', noReasoning), { provider: 'openai', model: 'm5' })
})

test('buildModelCatalog：支持多词乱序检索、空分组剔除与偏移计算', () => {
  const groups: ModelProviderGroup[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        makeModel('gpt-6-astra', undefined, undefined, 'GPT 6 Astra'),
        makeModel('gpt-6-mini'),
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [makeModel('claude-opus-5', undefined, undefined, 'Claude Opus 5')],
    },
  ] as ModelProviderGroup[]

  const all = buildModelCatalog(groups, '')
  assert.equal(all.groups.length, 2)
  assert.equal(all.groups[0].offset, 0)
  assert.equal(all.groups[1].offset, 2)
  assert.equal(all.rows.length, 3)

  const filtered = buildModelCatalog(groups, '  astra openai ')
  assert.equal(filtered.groups.length, 1)
  assert.equal(filtered.groups[0].offset, 0)
  assert.deepEqual(
    filtered.rows.map((r) => r.model.id),
    ['gpt-6-astra'],
  )

  const empty = buildModelCatalog(groups, 'not-found')
  assert.deepEqual(empty, { groups: [], rows: [] })
})

test('speedRuleFor：匹配精确型号、别名、日期后缀并拒绝未开放型号', () => {
  assert.deepEqual(speedRuleFor('gpt-6-astra')?.modes, ['standard', 'fast', 'ultrafast'])
  assert.deepEqual(speedRuleFor('catalog-alias', 'GPT 6 Astra')?.modes, [
    'standard',
    'fast',
    'ultrafast',
  ])
  assert.deepEqual(speedRuleFor('gpt-6-astra-2026-09-01')?.modes, ['standard', 'fast', 'ultrafast'])

  const claude = speedRuleFor('claude-opus-5-20260901')
  assert.equal(claude?.family, 'anthropic')
  assert.equal(claude?.beta, 'fast-mode-2026-02-01')

  assert.equal(speedRuleFor('gpt-6-astra-mini'), undefined)
  assert.equal(speedRuleFor('deepseek-v4'), undefined)
})

test('slider-motion：档位滞回吸附、数值夹紧与运动收敛边界', () => {
  assert.equal(clamp(-2, 0, 1), 0)
  assert.equal(clamp(3, 0, 1), 1)
  assert.equal(detentAt(0.9, 0, 1), 0)

  assert.equal(detentAt(0.1, 0, 3), 0)
  assert.equal(detentAt(0.2, 0, 3), 1)
  assert.equal(detentAt(1.5, -1, 3), 2)

  assert.equal(detentAt(0.8, 2, 3), 2)
  assert.equal(detentAt(0.6, 2, 3), 1)
  assert.equal(detentAt(-0.5, 9, 3), 0)

  let state = { position: 0, velocity: 0 }
  for (let i = 0; i < 120; i++) {
    state = advanceMotion(state, 1, 0.016)
  }
  assert.deepEqual(state, { position: 1, velocity: 0 })

  assert.deepEqual(advanceMotion({ position: 1, velocity: 5 }, 1, 0.01), {
    position: 1,
    velocity: 0,
  })
  assert.deepEqual(advanceMotion({ position: 0, velocity: -5 }, 0, 0.01), {
    position: 0,
    velocity: 0,
  })
})

test('particle-motion：低档无粒子，高档位输出确定性且范围内的粒子序列', () => {
  assert.equal(energyFor(-0.5), 0)
  assert.equal(energyFor(1 / 3), 0)
  assert.ok(Math.abs(energyFor(2 / 3) - 0.5) < 1e-12)
  assert.equal(energyFor(1.5), 1)

  assert.deepEqual(particlesFor(0), [])
  assert.deepEqual(particlesFor(1 / 3), [])

  const high = particlesFor(1)
  assert.equal(high.length, 22)
  assert.deepEqual(particlesFor(1), high)
  for (const particle of high) {
    assert.ok(particle.y > 0 && particle.y < 100)
    assert.ok(particle.duration > 0)
    assert.ok(particle.delay <= 0 && particle.delay > -particle.duration)
    assert.ok(particle.brightness >= 0.5 && particle.brightness <= 1)
  }
})
