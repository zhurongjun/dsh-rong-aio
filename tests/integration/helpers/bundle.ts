import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { parse } from 'yaml'
import type { CordisPatchEntry } from '../../../tools/manifest.ts'

let cachedTemplate: Promise<string> | undefined

function ensureBuiltTemplate(): Promise<string> {
  cachedTemplate ??= (async () => {
    await mkdir('agent_temp/tests', { recursive: true })
    const dir = await mkdtemp(resolve('agent_temp/tests/bundle-template-'))
    process.once('exit', () => {
      rmSync(dir, { recursive: true, force: true })
    })
    for (const entry of ['package.json', 'cordis.patch.yml', 'tools', 'src']) {
      await cp(entry, join(dir, entry), { recursive: true })
    }
    execFileSync(process.execPath, ['tools/build.ts'], { cwd: dir })
    return dir
  })()
  return cachedTemplate
}

async function installSpillStub(pkg: string): Promise<void> {
  const dir = join(pkg, 'node_modules/@deepseek-ai/dsh-spill-local')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@deepseek-ai/dsh-spill-local',
      version: '0.2.2-rc.5',
      type: 'module',
      exports: './index.js',
    }),
  )
  await writeFile(
    join(dir, 'index.js'),
    [
      "import { join } from 'node:path'",
      "export const name = 'spill-local'",
      'export function apply() {}',
      'export function sessionDir(rootDir, id) { return join(rootDir, id) }',
      'export async function discoverDefaultRoots() { return [] }',
      "export function privateRoot() { return '' }",
    ].join('\n'),
  )
}

export async function prepareBundle(ctx: Context, root: string, options?: { spills?: boolean }) {
  const template = await ensureBuiltTemplate()
  const pkg = join(root, 'package')
  await mkdir(pkg, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'lib']) {
    await cp(join(template, entry), join(pkg, entry), { recursive: true })
  }
  if (options?.spills) await installSpillStub(pkg)

  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(pkg, 'package.json')).href })
  const patch = parse(await readFile(join(pkg, 'cordis.patch.yml'), 'utf8')) as CordisPatchEntry[]
  return patch
    .flatMap((entry) => entry.insert ?? [])
    .map((row) => ({ id: row.id ?? '', name: row.name ?? '' }))
}
