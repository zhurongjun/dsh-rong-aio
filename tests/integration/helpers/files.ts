import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stringify } from 'yaml'

export const prompt = {
  name: 'v41f',
  display_name: '破甲词',
  description: '测试',
  body: '\nLITERAL {{keep}}\n',
}

export const route = { provider: 'fixture', model: 'gpt-6-astra' }

export async function fixture() {
  await mkdir('agent_temp/tests', { recursive: true })
  const root = await mkdtemp(resolve('agent_temp/tests/system-inject-'))
  const cleanup = () => rm(root, { recursive: true, force: true })
  const workspace = join(root, 'project')
  const user = join(root, 'home/system_inject')
  await mkdir(workspace)
  await mkdir(user, { recursive: true })

  async function put({ body, ...metadata } = prompt, scope = 'user') {
    const base = scope === 'user' ? user : join(workspace, '.dsh/system_inject')
    const directory = join(base, 'prompts')
    await mkdir(directory, { recursive: true })
    const file = join(directory, metadata.name + '.md')
    await writeFile(file, `---\n${stringify(metadata)}---\n${body}`)
    return file
  }

  async function configure(routes = [route]) {
    await writeFile(join(user, 'config.json'), JSON.stringify({ version: 1, whitelist: routes }))
  }

  return { root, workspace, user, put, configure, cleanup }
}
