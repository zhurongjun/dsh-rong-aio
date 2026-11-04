import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  currentEffortOf,
  currentModelOf,
  defaultEffortOf,
  effortsOf,
  filterModels,
  selectionFor,
} from '../src/components/model-selector/shared/model-selection.ts'

const model = {
  id: 'model/opaque',
  name: 'Test Model',
  reasoning: { efforts: ['off', 'low', 'medium', 'high', 'max'].map((id) => ({ id, name: id })) },
}

test('显式默认优先；否则 Medium，再首个非 Off，只有 Off 时不创造档位', () => {
  assert.equal(
    defaultEffortOf({ ...model, reasoning: { ...model.reasoning, defaultEffort: 'high' } }),
    'high',
  )
  assert.equal(defaultEffortOf(model), 'medium')
  assert.equal(
    defaultEffortOf({
      ...model,
      reasoning: { efforts: model.reasoning.efforts.filter((v) => v.id !== 'medium') },
    }),
    'low',
  )
  assert.equal(
    defaultEffortOf({ ...model, reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }),
    'off',
  )
  assert.equal(defaultEffortOf({ id: 'empty', name: 'Empty' }), undefined)
})

test('不展示虚拟 Default；非法默认值不能成为提交参数', () => {
  const entry = {
    ...model,
    reasoning: {
      defaultEffort: 'default',
      efforts: [{ id: 'default', name: 'Default' }, ...model.reasoning.efforts],
    },
  }
  assert.equal(
    effortsOf(entry).some((v) => v.id === 'default'),
    false,
  )
  assert.equal(selectionFor('provider/opaque', entry).reasoningEffort, 'medium')
})

test('旧会话的隐式 Default 不冒充 Medium；实际显式默认仍可显示', () => {
  const current = { provider: 'one', model: model.id }
  assert.equal(currentEffortOf(model, current), undefined)
  assert.equal(
    currentEffortOf({ ...model, reasoning: { ...model.reasoning, defaultEffort: 'high' } }, current)
      ?.id,
    'high',
  )
  assert.equal(currentEffortOf(model, { ...current, reasoningEffort: 'max' })?.id, 'max')
})

test('模型身份按完整 provider/model 比较；切换时明确提交默认档，不遗留前模型档位', () => {
  const groups = [
    { id: 'p/1', name: 'One', models: [model] },
    { id: 'p/2', name: 'Two', models: [{ ...model, name: 'Second' }] },
  ]
  assert.equal(currentModelOf(groups, { provider: 'p/2', model: model.id })?.name, 'Second')
  assert.equal(currentModelOf(groups, { provider: 'missing', model: model.id }), undefined)
  assert.deepEqual(selectionFor('p/2', model), {
    provider: 'p/2',
    model: model.id,
    reasoningEffort: 'medium',
  })
  assert.deepEqual(selectionFor('p/2', { id: 'plain', name: 'Plain' }), {
    provider: 'p/2',
    model: 'plain',
  })
  assert.equal(filterModels(groups, 'two SECOND')[0]?.id, 'p/2')
  assert.deepEqual(filterModels(groups, 'no-match'), [])
})
