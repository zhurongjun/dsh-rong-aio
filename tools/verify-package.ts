import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  loadWorkspaceManifests,
  type ComponentManifest,
  type CordisPatchEntry,
  type RootManifest,
} from './manifest.ts'

const { root: rootDir, manifest, components } = await loadWorkspaceManifests()

const tag = process.env.RELEASE_TAG
if (tag) assert.equal(tag, `v${manifest.version}`, 'Tag 必须与根包版本一致')

const archiveName = `${manifest.name}-${manifest.version}.tgz`
const archive = path.join(rootDir, 'agent_temp/packages', archiveName)

const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)
const allowed = ['package.json', 'README.md', 'LICENSE', ...(manifest.files ?? [])]

for (const file of files) {
  assert.ok(file.startsWith('package/'), `安装包出现非 package 路径：${file}`)
  const relative = file.slice('package/'.length)
  assert.ok(!relative.split('/').includes('..'), `安装包出现越界路径：${file}`)
  assert.ok(
    allowed.some((entry) =>
      entry.endsWith('/') ? relative.startsWith(entry) : relative === entry,
    ),
    `安装包包含白名单以外的文件：${file}`,
  )
  assert.ok(
    !/(^|\/)(agent_temp|node_modules|scripts|src|tests|tools|\.github)\//.test(relative),
    file,
  )
}

await mkdir(path.join(rootDir, 'agent_temp/release'), { recursive: true })
const directory = await mkdtemp(path.join(rootDir, 'agent_temp/release/install-'))

await writeFile(
  path.join(directory, 'package.json'),
  JSON.stringify({ private: true, dependencies: { [manifest.name]: `file:${archive}` } }),
)
await writeFile(
  path.join(directory, 'pnpm-workspace.yaml'),
  'packages: []\nautoInstallPeers: false\n' +
    `storeDir: ${JSON.stringify(path.join(rootDir, 'agent_temp/pnpm-store'))}\n`,
)

execFileSync(
  'pnpm',
  ['install', '--prod', '--ignore-scripts', '--lockfile=false', '--frozen-lockfile=false'],
  { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' },
)

const installedRoot = path.join(directory, 'node_modules', manifest.name)
const installed = JSON.parse(
  await readFile(path.join(installedRoot, 'package.json'), 'utf8'),
) as RootManifest

assert.equal(installed.name, manifest.name)
assert.equal(installed.version, manifest.version)
assert.deepEqual(installed.dsh, manifest.dsh)

const npmDirectory = await mkdtemp(path.join(rootDir, 'agent_temp/release/npm-install-'))
await copyFile(path.join(directory, 'package.json'), path.join(npmDirectory, 'package.json'))
execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund'], {
  cwd: npmDirectory,
  env: { ...process.env, npm_config_cache: path.join(rootDir, 'agent_temp/npm-cache') },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const npmManifest = path.join(npmDirectory, 'node_modules', manifest.name, 'package.json')
assert.deepEqual(JSON.parse(await readFile(npmManifest, 'utf8')), installed)

function checkExports(exports: unknown, base = ''): void {
  if (typeof exports === 'string') {
    assert.ok(exports.startsWith('./'), `导出必须是包内路径：${exports}`)
    const target = `package/${base}${exports.slice(2)}`
    const pattern = new RegExp(
      `^${target.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+')}$`,
    )
    assert.ok(
      files.some((file) => pattern.test(file)),
      `导出目标未打包：${target}`,
    )
    return
  }
  if (exports && typeof exports === 'object') {
    for (const value of Object.values(exports)) checkExports(value, base)
  }
}

checkExports(installed.exports)

const patchPath = installed.dsh?.bundle?.patch
assert.ok(patchPath, '已安装包缺少 dsh.bundle.patch')
const patch = parseYaml(
  await readFile(path.join(installedRoot, patchPath), 'utf8'),
) as CordisPatchEntry[]
assert.ok(Array.isArray(patch), 'bundle patch 必须是 YAML 数组')

const patchRows = patch.flatMap((entry) => entry.insert ?? [])
assert.equal(patchRows.length, components.length)
for (const { id } of components) {
  const component = JSON.parse(
    await readFile(path.join(installedRoot, 'lib/components', id, 'package.json'), 'utf8'),
  ) as ComponentManifest
  assert.equal(component.version, manifest.version, `${id} 的版本必须与根包一致`)
  assert.equal(component.private, true, `${id} 只能随根包分发`)
  assert.ok(
    patchRows.some((row) => row.id === `rong-aio-${id}` && row.name === `${manifest.name}/${id}`),
  )
  checkExports(component.exports, `lib/components/${id}/`)
}

const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')

await writeFile(`${archive}.sha256`, `${sha256}  ${archiveName}\n`)
process.stdout.write(`已验证 ${archiveName}：版本、分发文件、组件导出、pnpm 与 npm 安装均通过。\n`)
