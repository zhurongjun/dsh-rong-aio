import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  loadWorkspaceManifests,
  type ComponentEntry,
  type ComponentManifest,
  type CordisPatchEntry,
  type RootManifest,
} from './manifest.ts'

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function runQuiet(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  try {
    execFileSync(command, args, {
      cwd,
      env,
      stdio: 'pipe',
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string }
    const details = [failed.stderr, failed.stdout].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} 失败${details ? `：\n${details}` : ''}`)
  }
}

function verifyArchiveEntries(files: string[], manifest: RootManifest): void {
  const allowed = ['package.json', 'README.md', 'LICENSE', ...(manifest.files ?? [])]
  const forbidden = /(^|\/)(agent_temp|node_modules|scripts|src|tests|tools|\.github)\//

  for (const file of files) {
    ensure(file.startsWith('package/'), `归档路径缺少 package/ 前缀：${file}`)
    const relative = file.slice('package/'.length)
    ensure(!relative.split('/').includes('..'), `归档包含越界路径：${file}`)
    ensure(
      allowed.some((entry) =>
        entry.endsWith('/') ? relative.startsWith(entry) : relative === entry,
      ),
      `归档包含未声明文件：${file}`,
    )
    ensure(!forbidden.test(relative), `归档包含禁止打包路径：${file}`)
  }
}

function verifyExports(exports: unknown, files: Set<string>, base = ''): void {
  if (typeof exports === 'string') {
    ensure(exports.startsWith('./'), `导出路径非包内相对路径：${exports}`)
    const target = `package/${base}${exports.slice(2)}`
    const pattern = new RegExp(
      `^${target.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+')}$`,
    )
    ensure(
      [...files].some((file) => pattern.test(file)),
      `导出目标未打包：${target}`,
    )
    return
  }

  if (exports && typeof exports === 'object') {
    for (const value of Object.values(exports)) verifyExports(value, files, base)
  }
}

async function verifyInstalledManifest(
  installedRoot: string,
  manifest: RootManifest,
  components: ComponentEntry[],
  files: Set<string>,
): Promise<RootManifest> {
  const installed = JSON.parse(
    await readFile(path.join(installedRoot, 'package.json'), 'utf8'),
  ) as RootManifest

  ensure(installed.name === manifest.name, `已安装 package.json name 不匹配：${installed.name}`)
  ensure(
    installed.version === manifest.version,
    `已安装 package.json version 不匹配：${installed.version}`,
  )
  ensure(
    JSON.stringify(installed.dsh) === JSON.stringify(manifest.dsh),
    '已安装 package.json dsh 配置与源清单不一致',
  )

  verifyExports(installed.exports, files)

  const patchPath = installed.dsh?.bundle?.patch
  ensure(patchPath, '已安装包缺少 dsh.bundle.patch')
  const patch = parseYaml(await readFile(path.join(installedRoot, patchPath), 'utf8'))
  ensure(Array.isArray(patch), 'cordis.patch.yml 必须为 YAML 数组')

  const patchRows = (patch as CordisPatchEntry[]).flatMap((entry) => entry.insert ?? [])
  ensure(
    patchRows.length === components.length,
    `cordis.patch.yml 条目数（${patchRows.length}）与组件数（${components.length}）不一致`,
  )

  for (const { id } of components) {
    const component = JSON.parse(
      await readFile(path.join(installedRoot, 'lib/components', id, 'package.json'), 'utf8'),
    ) as ComponentManifest
    ensure(component.version === manifest.version, `${id} 版本（${component.version}）与根包不一致`)
    ensure(component.private === true, `${id}/package.json 必须设置 private: true`)
    ensure(
      patchRows.some((row) => row.id === `rong-aio-${id}` && row.name === `${manifest.name}/${id}`),
      `cordis.patch.yml 缺少组件条目：${manifest.name}/${id}`,
    )
    verifyExports(component.exports, files, `lib/components/${id}/`)
  }

  return installed
}

async function verifyIsolatedInstalls(
  rootDir: string,
  archive: string,
  manifest: RootManifest,
  components: ComponentEntry[],
  files: Set<string>,
): Promise<void> {
  const releaseDir = path.join(rootDir, 'agent_temp/release')
  await mkdir(releaseDir, { recursive: true })

  const pnpmDir = await mkdtemp(path.join(releaseDir, 'install-'))
  const npmDir = await mkdtemp(path.join(releaseDir, 'npm-install-'))

  try {
    const consumerPkg = JSON.stringify({
      private: true,
      dependencies: { [manifest.name]: `file:${archive}` },
    })

    await writeFile(path.join(pnpmDir, 'package.json'), consumerPkg)
    await writeFile(
      path.join(pnpmDir, 'pnpm-workspace.yaml'),
      'packages: []\nautoInstallPeers: false\n' +
        `storeDir: ${JSON.stringify(path.join(rootDir, 'agent_temp/pnpm-store'))}\n`,
    )
    runQuiet(
      'pnpm',
      ['install', '--prod', '--ignore-scripts', '--lockfile=false', '--frozen-lockfile=false'],
      pnpmDir,
    )

    const pnpmInstalled = await verifyInstalledManifest(
      path.join(pnpmDir, 'node_modules', manifest.name),
      manifest,
      components,
      files,
    )

    await copyFile(path.join(pnpmDir, 'package.json'), path.join(npmDir, 'package.json'))
    runQuiet('npm', ['install', '--offline', '--no-audit', '--no-fund'], npmDir, {
      ...process.env,
      npm_config_cache: path.join(rootDir, 'agent_temp/npm-cache'),
    })

    const npmManifest = JSON.parse(
      await readFile(path.join(npmDir, 'node_modules', manifest.name, 'package.json'), 'utf8'),
    ) as RootManifest
    ensure(
      JSON.stringify(npmManifest) === JSON.stringify(pnpmInstalled),
      'npm 与 pnpm 安装得到的 package.json 不一致',
    )
  } finally {
    await Promise.all([
      rm(pnpmDir, { recursive: true, force: true }),
      rm(npmDir, { recursive: true, force: true }),
    ])
  }
}

const { root: rootDir, manifest, components } = await loadWorkspaceManifests()

const tag = process.env.RELEASE_TAG
if (tag) {
  ensure(
    tag === `v${manifest.version}`,
    `RELEASE_TAG (${tag}) 与包版本 (v${manifest.version}) 不一致`,
  )
}

const archiveName = `${manifest.name}-${manifest.version}.tgz`
const archive = path.join(rootDir, 'agent_temp/packages', archiveName)
const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/)

verifyArchiveEntries(files, manifest)
await verifyIsolatedInstalls(rootDir, archive, manifest, components, new Set(files))

const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')

await writeFile(`${archive}.sha256`, `${sha256}  ${archiveName}\n`)
console.log(
  `包验证：${archiveName}（${files.length} 个文件，${components.length} 个组件，sha256: ${sha256.slice(0, 12)}）`,
)
