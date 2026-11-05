/** 基础文件夹具：所有用户/工程/会话路径位于 agent_temp，注入可控选模和写盘故障。 */

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

/**
 * 建立一个独立文件环境并注册测试结束清理。
 * 返回控制器、会话和文件辅助方法；正常测试无需访问真实 DSH_HOME。
 */
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

  /** 将指定模板写入用户/工程直属目录，允许显式文件名以验证索引与文件名的区别。 */
  const put = async (value = prompt, scope: Scope = 'user', filename = value.name + '.md') => {
    const directory = paths.prompts(scope, workspace)
    await mkdir(directory, { recursive: true })
    const file = join(directory, filename)
    await writeFile(file, exportMarkdown(value))
    return file
  }

  /** 直接准备用户白名单；生产代码仍必须经 ConfigStore 校验读取。 */
  const configure = async (routes = [route]) => {
    await mkdir(paths.user, { recursive: true })
    await writeFile(paths.config(), JSON.stringify({ version: 1, whitelist: routes }))
  }

  /** 通过实际 Controller 命令选择破甲词，默认使用夹具会话与模板。 */
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
