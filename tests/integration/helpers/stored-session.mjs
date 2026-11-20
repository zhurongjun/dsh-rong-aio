import { dirname } from 'node:path'

export async function storedSession(f, id, workspace = f.ctx.workspaceRegistry.list()[0]) {
  const handle = await f.ctx.agents.create({
    sessionId: id,
    meta: { cwd: workspace.path },
    agentOptions: f.route,
  })
  await f.ctx.sessions.flush(handle.agent.session)
  const { location, header } = await f.ctx.sessionPersistence.stat(id)
  await workspace.attachSession(id)
  await handle.dispose()
  return { directory: dirname(location.path), target: { id, createdAt: header.createdAt } }
}
