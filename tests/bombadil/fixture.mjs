import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { runtime } from '../integration/helpers/runtime.mjs'
import { storedSession } from '../integration/helpers/stored-session.mjs'

export async function serve(t, report) {
  const f = await runtime(t, { side: true })
  const snapshot = (id) => {
    const agent = f.ctx.agents.get(id)
    return {
      id,
      current: agent.model.current(),
      header: agent.session.header,
      projections: f.ctx.sessionProjections.snapshot(agent.session).values,
    }
  }
  f.ctx.provide('subagents', {
    rootOf: (agent) =>
      agent.session.header.parentSession
        ? f.ctx.agents.get(agent.session.header.parentSession)
        : agent,
  })
  await f.ctx.plugin(TeamService)
  for (const id of ['another', 'team-child'])
    await f.ctx.agents.create({
      sessionId: id,
      agentOptions: f.route,
      meta: {
        cwd: f.workspace,
        ...(id === 'team-child' ? { parentSession: f.agent.id, origin: 'subagent' } : {}),
      },
    })
  const first = f.ctx.workspaceRegistry.list()[0]
  const otherPath = join(f.root, 'other', 'project')
  await mkdir(otherPath, { recursive: true })
  const second = await f.ctx.workspaceRegistry.create(otherPath)
  await first.setTitle('研发')
  await second.setTitle('研发')
  for (const [id, workspace] of [
    ['alpha', first],
    ['beta', second],
    ['first-session', first],
    ['second-session', first],
  ]) {
    await storedSession(f, id, workspace)
  }
  const commands = {
    async catalog() {
      const models = await f.ctx.llm.listModels(f.route.provider)
      return {
        models: models.map((m) =>
          m.id === f.route.model
            ? {
                ...m,
                reasoning: { efforts: ['off', 'medium', 'high'].map((id) => ({ id, name: id })) },
              }
            : m,
        ),
        sessions: [f.agent.id, 'another', 'team-child'].map(snapshot),
      }
    },
    snapshot: ({ id }) => snapshot(id),
    sidebar: async () => (await f.ctx.sessionQuery.listSessions()).map((s) => s.header.id),
    async model({ id, selection }) {
      await f.ctx.sessionController.selectModel({ sessionId: id, ...selection })
      return snapshot(id).current
    },
    async turn({ id }) {
      return f.run(f.ctx.agents.get(id))
    },
    async team({ id, enabled }) {
      await f.ctx.agentTeams.setEnabled(f.ctx.agents.get(id), enabled)
      return true
    },
  }
  const assets = new Map()
  const bundle = await build({
    entryPoints: ['tests/bombadil/workbench.jsx'],
    outdir: f.root,
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'workbench-primitives',
        setup(build) {
          build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: fileURLToPath(new URL('./primitives.mjs', import.meta.url)),
          }))
        },
      },
    ],
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of bundle.outputFiles)
    assets.set('/workbench.' + file.path.split('.').at(-1), file.contents)
  for (const name of ['model-selector', 'system-inject', 'session-manager', 'side'])
    assets.set(
      '/client/' + name + '.js',
      await readFile(f.ctx.clientModules.clientPath('dsh-rong-aio-' + name)),
    )
  const html =
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH UI fixture</title><link rel="stylesheet" href="/workbench.css"><main></main><aside aria-label="宿主侧栏">previously-deleted</aside><output aria-label="测试剪贴板"></output><output aria-label="宿主选模记录"></output><script src="/workbench.js"></script></html>'
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html;charset=utf-8')
        return res.end(html)
      }
      if (assets.has(url.pathname)) {
        res.setHeader(
          'Content-Type',
          url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        )
        return res.end(assets.get(url.pathname))
      }
      let body = ''
      for await (const chunk of req) body += chunk
      const input = body ? JSON.parse(body) : undefined
      if (url.pathname.startsWith('/api/')) {
        const reply = await f.request(url.pathname.slice(5) + url.search, input)
        res.writeHead(reply.status, { 'Content-Type': 'application/json' })
        return res.end(await reply.text())
      }
      if (url.pathname === '/fixture' && Object.hasOwn(commands, input?.action)) {
        const result = await commands[input.action](input)
        return res.end(JSON.stringify(result))
      }
      if (url.pathname === '/report' && req.method === 'POST') {
        report(input)
        return res.end('ok')
      }
      res.writeHead(404).end()
    } catch (e) {
      res.writeHead(400).end(e.message)
    }
  })
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  )
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
      }),
  )
  return { origin: 'http://127.0.0.1:' + server.address().port, f }
}
