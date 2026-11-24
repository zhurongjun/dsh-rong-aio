import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export const root = fileURLToPath(new URL('../', import.meta.url))

export interface RootExportTarget {
  types?: string
  default?: string
}

export interface RootManifest {
  name: string
  version: string
  private?: boolean
  keywords?: string[]
  scripts?: Record<string, string>
  files?: string[]
  exports?: Record<string, string | RootExportTarget>
  dsh?: {
    bundle?: {
      patch?: string
    }
  }
}

export interface ComponentManifest {
  name: string
  version: string
  private?: boolean
  type?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  exports?: Record<string, unknown>
  dsh?: {
    client?: unknown
  }
}

export interface ComponentEntry {
  id: string
  source: string
  manifest: ComponentManifest
  hasHost: boolean
  hasClient: boolean
}

export interface CordisPatchRow {
  id?: string
  name?: string
}

export interface CordisPatchEntry {
  insert?: CordisPatchRow[]
}

export interface WorkspaceManifests {
  root: string
  manifest: RootManifest
  patch: CordisPatchEntry[]
  components: ComponentEntry[]
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

function validateRootManifest(manifest: RootManifest): void {
  if (manifest.private === true) throw new Error('根 package.json 不能设置 private: true')
  if (!manifest.keywords?.includes('dsh-plugin')) {
    throw new Error('根 package.json keywords 缺少 "dsh-plugin"')
  }
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    if (manifest.scripts?.[hook] !== undefined) {
      throw new Error(`根 package.json 不能包含安装期生命周期脚本：${hook}`)
    }
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error('根 package.json dsh.bundle.patch 必须为 ./cordis.patch.yml')
  }
}

async function loadComponentEntry(
  rootDir: string,
  rootManifest: RootManifest,
  id: string,
): Promise<ComponentEntry> {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`非法组件目录名：${id}`)

  const source = `src/components/${id}`
  const component = await readJson<ComponentManifest>(path.join(rootDir, source, 'package.json'))

  if (component.name !== `${rootManifest.name}-${id}` || component.type !== 'module') {
    throw new Error(
      `${id} 的 package.json name 必须为 ${rootManifest.name}-${id}，type 必须为 module`,
    )
  }
  if (component.version !== rootManifest.version) {
    throw new Error(`${id} 的版本（${component.version}）与根包（${rootManifest.version}）不一致`)
  }
  if (component.private !== true) {
    throw new Error(`${id} 的 package.json 必须设置 private: true`)
  }
  if (component.dependencies || component.devDependencies || component.scripts) {
    throw new Error(`${id} 的 package.json 不能声明 dependencies、devDependencies 或 scripts`)
  }

  const rootExport = rootManifest.exports?.[`./${id}`]
  if (typeof rootExport !== 'object' || rootExport?.default !== `./lib/${id}.js`) {
    throw new Error(`根 package.json exports["./${id}"].default 必须为 ./lib/${id}.js`)
  }
  if (rootExport.types !== `./lib/${id}.d.ts`) {
    throw new Error(`根 package.json exports["./${id}"].types 必须为 ./lib/${id}.d.ts`)
  }
  if (rootManifest.exports?.[`./${id}/locale/*.json`] !== `./lib/components/${id}/locale/*.json`) {
    throw new Error(
      `根 package.json exports["./${id}/locale/*.json"] 必须为 ./lib/components/${id}/locale/*.json`,
    )
  }

  const hasHost = await exists(path.join(rootDir, source, 'host/index.ts'))
  const hasClient = Boolean(component.dsh?.client)
  if (!hasHost && !hasClient) throw new Error(`${id} 缺少 host 或 client 入口`)
  if (hasClient && component.exports?.['./client'] !== './client.js') {
    throw new Error(`${id} 的 exports["./client"] 必须为 ./client.js`)
  }

  return { id, source, manifest: component, hasHost, hasClient }
}

function validatePatchFile(
  raw: unknown,
  packageName: string,
  components: ComponentEntry[],
): CordisPatchEntry[] {
  if (!Array.isArray(raw)) throw new Error('cordis.patch.yml 必须为 YAML 数组')
  const patch = raw as CordisPatchEntry[]
  const rows = patch.flatMap((entry) => entry.insert ?? [])

  if (rows.length !== components.length) {
    throw new Error(
      `cordis.patch.yml 组件数量（${rows.length}）与 src/components（${components.length}）不一致`,
    )
  }

  for (const { id } of components) {
    const matched = rows.some(
      (row) => row.id === `rong-aio-${id}` && row.name === `${packageName}/${id}`,
    )
    if (!matched) {
      throw new Error(
        `cordis.patch.yml 缺少组件条目：{ id: "rong-aio-${id}", name: "${packageName}/${id}" }`,
      )
    }
  }

  return patch
}

export async function loadWorkspaceManifests(rootDir = root): Promise<WorkspaceManifests> {
  const manifest = await readJson<RootManifest>(path.join(rootDir, 'package.json'))
  validateRootManifest(manifest)

  const entries = await readdir(path.join(rootDir, 'src/components'), { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const components = await Promise.all(dirs.map((id) => loadComponentEntry(rootDir, manifest, id)))
  const rawPatch: unknown = parseYaml(
    await readFile(path.join(rootDir, 'cordis.patch.yml'), 'utf8'),
  )
  const patch = validatePatchFile(rawPatch, manifest.name, components)

  return { root: rootDir, manifest, patch, components }
}
