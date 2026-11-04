import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import ClientModules from '@deepseek-ai/dsh-client-modules'
import { defineComponent } from '../src/runtime/host/component.ts'

test('真实 Loader：组件独立客户端身份、单独启停、总包重载及异步资源清理', async () => {
  await mkdir('agent_temp/tests', { recursive: true })
  const directory = await mkdtemp(path.resolve('agent_temp/tests/runtime-'))
  const ctx = new Context()
  const live = new Set()
  const events = []
  const key = Symbol('component-test')
  globalThis[key] = { live, events }
  try {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(`${directory}/`).href })
    await ctx.plugin(ClientModules)
    for (const name of ['first', 'second']) {
      const target = path.join(directory, name)
      await mkdir(target)
      await writeFile(
        path.join(target, 'package.json'),
        JSON.stringify({
          name: `fixture-${name}`,
          type: 'module',
          exports: { './client': './client.js' },
          dsh: { client: { platform: 'web', inject: [] } },
        }),
      )
      await writeFile(
        path.join(target, 'client.js'),
        `window.__ModuleLoader__.load({id:'fixture-${name}',factory:()=>({apply(){}})});`,
      )
      // 临时模块只记录生命周期；装配器不接收额外状态或开关。
      await writeFile(
        path.join(target, 'index.js'),
        `export function apply(ctx) {
        ctx.effect(() => {
          const state = globalThis[Object.getOwnPropertySymbols(globalThis).find(s => s.description === 'component-test')];
          state.live.add('${name}');
          return async () => { await Promise.resolve(); state.live.delete('${name}'); state.events.push('${name}'); };
        });
      }`,
      )
      ctx.loader.builtins[name] = defineComponent(pathToFileURL(path.join(target, 'index.js')))
    }
    const entries = () => ['first', 'second'].map((id) => ({ id, name: `cordis:${id}` }))
    const settle = async () => {
      await ctx.loader.await()
      await setImmediate()
    }
    const expect = (names) => {
      assert.deepEqual([...live].sort(), names)
      assert.deepEqual(
        ctx.clientModules
          .graph()
          .entries.map((entry) => entry.id)
          .sort(),
        names.map((name) => `fixture-${name}`),
      )
    }
    await ctx.loader.root.update(entries())
    await settle()
    expect(['first', 'second'])
    assert.equal(ctx.loader.resolve('first:implementation').parent.tree.ctx.fiber.entry.id, 'first')
    const secondRevision = ctx.clientModules
      .graph()
      .entries.find((entry) => entry.id === 'fixture-second').rev
    await ctx.loader.update('first', { disabled: true })
    await settle()
    expect(['second'])
    assert.equal(ctx.clientModules.graph().entries[0].rev, secondRevision)
    await ctx.loader.update('first', { disabled: false })
    await settle()
    expect(['first', 'second'])
    const fibers = entries().map(({ id }) => ctx.loader.resolve(id).fiber)
    await ctx.loader.root.update([])
    await Promise.all(fibers.map((fiber) => fiber.await()))
    await settle()
    expect([])
    assert.deepEqual([...ctx.loader.entries()], [])
    assert.equal(events.length, 3)
    await ctx.loader.root.update(entries())
    await settle()
    expect(['first', 'second'])
  } finally {
    await ctx.fiber.dispose()
    delete globalThis[key]
  }
  assert.equal(live.size, 0)
})

test('真实 Loader：异步初始化途中停用不会遗留内部条目', async () => {
  await mkdir('agent_temp/tests', { recursive: true })
  const directory = await mkdtemp(path.resolve('agent_temp/tests/loading-'))
  const filename = path.join(directory, 'index.mjs')
  const key = Symbol('loading-component-test')
  let started
  let release
  const ready = new Promise((resolve) => {
    started = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  globalThis[key] = { started, gate, live: false }
  await writeFile(
    filename,
    `export async function apply(ctx) {
    const state = globalThis[Object.getOwnPropertySymbols(globalThis).find(s => s.description === 'loading-component-test')];
    ctx.effect(() => { state.live = true; return () => { state.live = false }; });
    state.started(); await state.gate;
  }`,
  )
  const ctx = new Context()
  try {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(`${directory}/`).href })
    ctx.loader.builtins.loading = defineComponent(pathToFileURL(filename))
    await ctx.loader.root.update([{ id: 'loading', name: 'cordis:loading' }])
    await ready
    const entry = ctx.loader.resolve('loading')
    const stopping = entry.fiber.dispose()
    release()
    await stopping
    assert.equal(globalThis[key].live, false)
    assert.deepEqual([...entry.subtree.entries()], [])
  } finally {
    release()
    await ctx.fiber.dispose()
    delete globalThis[key]
  }
})
