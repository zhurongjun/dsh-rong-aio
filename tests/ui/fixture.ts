import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import TeamService from '@deepseek-ai/dsh-agent-team'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { build } from 'esbuild'
import { runtime, storedSession } from '../integration/helpers/runtime.ts'

export async function serve(
  t: TestContext,
  report: (entry: { name: string; error?: string }) => void,
) {
  const f = await runtime(t, { side: true })

  const snapshot = (id: string) => {
    const agent = f.getAgent(id)
    return {
      id,
      current: agent.model.current(),
      header: agent.session.header,
      projections: f.ctx.sessionProjections.snapshot(agent.session).values,
    }
  }

  f.ctx.provide(
    'subagents' as never,
    {
      rootOf: (agent: { session: { header: { parentSession?: string } } }) =>
        agent.session.header.parentSession ? f.getAgent(agent.session.header.parentSession) : agent,
    } as never,
  )
  await f.ctx.plugin(TeamService as Parameters<typeof f.ctx.plugin>[0])

  for (const id of ['another', 'team-child']) {
    await f.ctx.agents.create({
      sessionId: id as SessionId,
      agentOptions: f.route,
      meta: {
        cwd: f.workspace,
        ...(id === 'team-child' ? { parentSession: f.agent.id, origin: 'subagent' } : {}),
      },
    })
  }

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
  ] as const) {
    await storedSession(f, id, workspace)
  }

  const commands: Record<string, (args: Record<string, any>) => unknown> = {
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
    snapshot: ({ id }) => snapshot(id as string),
    sidebar: async () => (await f.ctx.sessionQuery.listSessions()).map((s) => s.header.id),
    async model({ id, selection }) {
      await f.ctx.sessionController.selectModel({ sessionId: id, ...selection })
      return snapshot(id as string).current
    },
    turn: ({ id }) => f.run(f.getAgent(id as string)),
    async team({ id, enabled }) {
      await f.ctx.agentTeams.setEnabled(f.getAgent(id as string), enabled as boolean)
      return true
    },
  }

  const assets = new Map<string, Uint8Array>()
  const bundle = await build({
    entryPoints: ['tests/ui/workbench.jsx'],
    outdir: f.root,
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'workbench-primitives',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: fileURLToPath(new URL('./primitives.mjs', import.meta.url)),
          }))
        },
      },
    ],
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  for (const file of bundle.outputFiles) {
    assets.set('/workbench.' + file.path.split('.').at(-1), file.contents)
  }
  for (const name of ['model-selector', 'system-inject', 'session-manager', 'side']) {
    assets.set(
      '/client/' + name + '.js',
      await readFile(f.ctx.clientModules.clientPath('dsh-rong-aio-' + name)!),
    )
  }

  const html =
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH UI fixture</title>' +
    '<link rel="stylesheet" href="/workbench.css"><main></main>' +
    '<aside aria-label="宿主侧栏">previously-deleted</aside>' +
    '<output aria-label="测试剪贴板"></output><output aria-label="宿主选模记录"></output>' +
    '<script src="/workbench.js"></script></html>'

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
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
      const input = body ? (JSON.parse(body) as Record<string, any>) : undefined

      if (url.pathname.startsWith('/api/')) {
        const reply = await f.request(url.pathname.slice(5) + url.search, input)
        res.writeHead(reply.status, { 'Content-Type': 'application/json' })
        return res.end(await reply.text())
      }
      if (url.pathname === '/fixture' && input && Object.hasOwn(commands, input.action)) {
        const result = await commands[input.action](input)
        return res.end(JSON.stringify(result))
      }
      if (url.pathname === '/report' && req.method === 'POST' && input) {
        res.end('ok', () => report(input as { name: string; error?: string }))
        return
      }
      res.writeHead(404).end()
    } catch (e) {
      res.writeHead(400).end(e instanceof Error ? e.message : String(e))
    }
  })

  await new Promise<void>((resolveListen, rejectListen) =>
    server.once('error', rejectListen).listen(0, '127.0.0.1', resolveListen),
  )
  t.after(
    () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
        server.closeAllConnections()
      }),
  )

  return { origin: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, f }
}
