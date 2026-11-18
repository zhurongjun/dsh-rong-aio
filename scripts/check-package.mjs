/** 验证预构建发布包、Tag 与组件版本，检查 npm 和 pnpm 安装后生成 SHA-256。 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../', import.meta.url))

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const tag = process.env.RELEASE_TAG

if (tag) assert.equal(tag, `v${manifest.version}`, 'Tag 必须与根包版本一致')
assert.notEqual(manifest.private, true, '根包必须可被插件索引发现')
assert.ok(manifest.keywords.includes('dsh-plugin'), '根包应提供插件发现关键词')
for (const hook of ['preinstall', 'install', 'postinstall']) {
  assert.equal(manifest.scripts[hook], undefined, '预构建包不能要求安装时执行脚本')
}

const archiveName = `${manifest.name}-${manifest.version}.tgz`

const archive = path.join(root, 'agent_temp/packages', archiveName)

const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)

// 严格按分发白名单检查；自动携带的 npm 元信息文件单独允许。
const allowed = ['package.json', 'README.md', 'LICENSE', ...manifest.files]

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
  assert.ok(!/(^|\/)(agent_temp|node_modules|src|tests|\.github)\//.test(relative), file)
}

await mkdir(path.join(root, 'agent_temp/release'), { recursive: true })

const directory = await mkdtemp(path.join(root, 'agent_temp/release/install-'))

await writeFile(
  path.join(directory, 'package.json'),
  JSON.stringify({ private: true, dependencies: { [manifest.name]: `file:${archive}` } }),
)
await writeFile(
  path.join(directory, 'pnpm-workspace.yaml'),
  'packages: []\nautoInstallPeers: false\n' +
    `storeDir: ${JSON.stringify(path.join(root, 'agent_temp/pnpm-store'))}\n`,
)

// 独立 workspace 不继承工程开发依赖；禁用脚本证明 Release 安装不需要 prepare。
execFileSync(
  'pnpm',
  ['install', '--prod', '--ignore-scripts', '--lockfile=false', '--frozen-lockfile=false'],
  { cwd: directory, stdio: 'inherit', shell: process.platform === 'win32' },
)

const installedRoot = path.join(directory, 'node_modules', manifest.name)

const installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))

assert.equal(installed.name, manifest.name)
assert.equal(installed.version, manifest.version)
assert.deepEqual(installed.dsh, manifest.dsh)

// npm 使用默认脚本策略安装 tarball，离线验证用户安装时不需要获取开发依赖。
const npmDirectory = await mkdtemp(path.join(root, 'agent_temp/release/npm-install-'))

await copyFile(path.join(directory, 'package.json'), path.join(npmDirectory, 'package.json'))
execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund'], {
  cwd: npmDirectory,
  env: { ...process.env, npm_config_cache: path.join(root, 'agent_temp/npm-cache') },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
const npmManifest = path.join(npmDirectory, 'node_modules', manifest.name, 'package.json')

assert.deepEqual(JSON.parse(await readFile(npmManifest, 'utf8')), installed)

/** 核对全部导出目标；通配符导出至少需要一个真实文件匹配。 */
const checkExports = async (exports, base = '') => {
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
  } else {
    for (const value of Object.values(exports)) await checkExports(value, base)
  }
}

await checkExports(installed.exports)

const patch = parse(await readFile(path.join(installedRoot, installed.dsh.bundle.patch), 'utf8'))

assert.ok(Array.isArray(patch), 'bundle patch 必须是 YAML 数组')

const components = await readdir(path.join(root, 'src/components'))

assert.equal(patch.flatMap((entry) => entry.insert ?? []).length, components.length)
for (const id of components) {
  const component = JSON.parse(
    await readFile(path.join(installedRoot, 'lib/components', id, 'package.json'), 'utf8'),
  )
  assert.equal(component.version, manifest.version, `${id} 的版本必须与根包一致`)
  assert.equal(component.private, true, `${id} 只能随根包分发`)
  assert.ok(
    patch.some((entry) => entry.insert?.some((row) => row.name === `${manifest.name}/${id}`)),
  )
  await checkExports(component.exports, `lib/components/${id}/`)
}

const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')

await writeFile(`${archive}.sha256`, `${sha256}  ${archiveName}\n`)
process.stdout.write(`已验证 ${archiveName}：版本、分发文件、组件导出、pnpm 与 npm 安装均通过。\n`)
