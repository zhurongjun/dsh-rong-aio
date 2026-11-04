import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { TestContext } from 'node:test'
import { Paths } from '../../src/components/system-inject/host/paths.ts'
import { SessionStore } from '../../src/components/system-inject/host/session-store.ts'
import { sessionDirectory } from '../../src/components/system-inject/host/session-location.ts'
import { Controller } from '../../src/components/system-inject/host/controller.ts'
import { exportMarkdown } from '../../src/components/system-inject/shared/markdown.ts'
import type { Scope, Prompt } from '../../src/components/system-inject/shared/state.ts'

export const prompt: Prompt = {
  name: 'v41f',
  display_name: '破甲词',
  description: '测试',
  body: '\nLITERAL {{keep}}\n',
}
export const route = { provider: 'fixture', model: 'allowed' }
export async function fixture(t: TestContext) {
  await mkdir(resolve('agent_temp/tests'), { recursive: true })
  const root = await mkdtemp(resolve('agent_temp/tests/system-inject-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'project')
  const paths = new Paths(join(root, 'home/system_inject'))
  await mkdir(workspace, { recursive: true })
  const location = (meta: { id: string; cwd?: string }) =>
    sessionDirectory(join(root, 'sessions'), meta)
  let failFlush = false
  let selectedRoute = route
  const sessions = new SessionStore(
    location,
    async () => {
      if (failFlush) throw new Error('disk failure')
    },
    async () => false,
  )
  const controller = new Controller(paths, sessions, async () => selectedRoute)
  t.after(() => controller.close())
  const entry = await sessions.initialize({ id: 's', cwd: workspace })
  const put = async (value = prompt, scope: Scope = 'user', filename = value.name + '.md') => {
    const directory = paths.prompts(scope, workspace)
    await mkdir(directory, { recursive: true })
    const file = join(directory, filename)
    await writeFile(file, exportMarkdown(value))
    return file
  }
  const configure = async (routes = [route]) => {
    await mkdir(paths.user, { recursive: true })
    await writeFile(paths.config(), JSON.stringify({ version: 1, whitelist: routes }))
  }
  const select = (name: string | null = prompt.name, sessionId = 's') =>
    controller.command({ type: 'select', sessionId, state: { name } })
  return {
    root,
    workspace,
    paths,
    sessions,
    controller,
    entry,
    location,
    put,
    configure,
    select,
    selectRoute(value: typeof route) {
      selectedRoute = value
    },
    failFlush(value: boolean) {
      failFlush = value
    },
  }
}
