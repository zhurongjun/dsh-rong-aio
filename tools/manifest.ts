import assert from 'node:assert/strict'
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

export async function loadWorkspaceManifests(rootDir = root): Promise<WorkspaceManifests> {
  const manifest = await readJson<RootManifest>(path.join(rootDir, 'package.json'))
  assert.notEqual(manifest.private, true, '根包必须可被插件索引发现')
  assert.ok(manifest.keywords?.includes('dsh-plugin'), '根包应提供插件发现关键词')
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    assert.equal(manifest.scripts?.[hook], undefined, '预构建包不能要求安装时执行脚本')
  }
  assert.equal(
    manifest.dsh?.bundle?.patch,
    './cordis.patch.yml',
    '根包 dsh.bundle.patch 必须指向 ./cordis.patch.yml',
  )

  const entries = await readdir(path.join(rootDir, 'src/components'), { withFileTypes: true })
  const components: ComponentEntry[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`非法组件目录名：${id}`)

    const source = `src/components/${id}`
    const component = await readJson<ComponentManifest>(path.join(rootDir, source, 'package.json'))

    if (component.name !== `${manifest.name}-${id}` || component.type !== 'module') {
      throw new Error(`${id} 必须声明唯一的 ESM 组件身份 ${manifest.name}-${id}`)
    }
    assert.equal(
      component.version,
      manifest.version,
      `${id} 的版本（${component.version}）必须与根包（${manifest.version}）一致`,
    )
    assert.equal(
      component.private,
      true,
      `${id} 只能随根包分发，package.json 必须设置 private: true`,
    )
    if (
      ['dependencies', 'devDependencies', 'scripts'].some((key) =>
        Boolean(component[key as keyof ComponentManifest]),
      )
    ) {
      throw new Error(`${id} 的依赖和脚本必须统一放在根包`)
    }

    const rootExport = manifest.exports?.[`./${id}`]
    if (typeof rootExport !== 'object' || rootExport?.default !== `./lib/${id}.js`) {
      throw new Error(`根包缺少组件导出 ./${id}`)
    }
    if (rootExport.types !== `./lib/${id}.d.ts`) {
      throw new Error(`根包缺少组件类型导出 ./${id}`)
    }
    if (manifest.exports?.[`./${id}/locale/*.json`] !== `./lib/components/${id}/locale/*.json`) {
      throw new Error(`根包缺少组件 locale 导出 ./${id}/locale/*.json`)
    }

    const hasHost = await exists(path.join(rootDir, source, 'host/index.ts'))
    const hasClient = Boolean(component.dsh?.client)
    if (!hasHost && !hasClient) throw new Error(`${id} 没有运行入口`)
    if (hasClient && component.exports?.['./client'] !== './client.js') {
      throw new Error(`${id} 的 ./client 必须指向 ./client.js`)
    }

    components.push({ id, source, manifest: component, hasHost, hasClient })
  }

  const parsedPatch: unknown = parseYaml(
    await readFile(path.join(rootDir, 'cordis.patch.yml'), 'utf8'),
  )
  assert.ok(Array.isArray(parsedPatch), 'bundle patch 必须是 YAML 数组')
  const patch = parsedPatch as CordisPatchEntry[]
  const patchRows = patch.flatMap((entry) => entry.insert ?? [])
  assert.equal(
    patchRows.length,
    components.length,
    `cordis.patch.yml 组件数量（${patchRows.length}）与 src/components（${components.length}）不一致`,
  )

  for (const component of components) {
    const matched = patchRows.some(
      (row) =>
        row.id === `rong-aio-${component.id}` && row.name === `${manifest.name}/${component.id}`,
    )
    assert.ok(
      matched,
      `cordis.patch.yml 缺少组件条目 { id: "rong-aio-${component.id}", name: "${manifest.name}/${component.id}" }`,
    )
  }

  return { root: rootDir, manifest, patch, components }
}
