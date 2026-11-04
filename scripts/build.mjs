import { build } from 'esbuild'
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const json = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))
const manifest = await json('package.json')
const output = path.join(root, 'lib')
const declaration =
  "import type { Context } from '@deepseek-ai/cordis'\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): Promise<void>\n"
const exists = async (name) =>
  access(path.join(root, name)).then(
    () => true,
    () => false,
  )
const hostBuild = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Cordis 与 Loader 必须共享宿主实例，不能内嵌另一份框架。
  external: ['@deepseek-ai/*'],
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await build({
  ...hostBuild,
  entryPoints: ['src/runtime/host/component.ts'],
  outfile: 'lib/runtime/host/component.js',
})
const components = await readdir(path.join(root, 'src/components'), { withFileTypes: true })
for (const entry of components.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const id = entry.name
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`非法组件目录名：${id}`)
  const source = `src/components/${id}`
  const component = await json(`${source}/package.json`)
  if (component.name !== `${manifest.name}-${id}` || component.type !== 'module')
    throw new Error(`${id} 必须声明唯一的 ESM 组件身份 ${manifest.name}-${id}`)
  if (manifest.exports[`./${id}`]?.default !== `./lib/${id}.js`)
    throw new Error(`根包缺少组件导出 ./${id}`)
  if (manifest.exports[`./${id}/locale/*.json`] !== `./lib/components/${id}/locale/*.json`)
    throw new Error(`根包缺少组件 locale 导出 ./${id}/locale/*.json`)
  if (['dependencies', 'devDependencies', 'scripts'].some((key) => component[key]))
    throw new Error(`${id} 的依赖和脚本必须统一放在根包`)
  const directory = path.join(output, 'components', id)
  await mkdir(directory, { recursive: true })
  const hasHost = await exists(`${source}/host/index.ts`)
  const hasClient = !!component.dsh?.client
  if (!hasHost && !hasClient) throw new Error(`${id} 没有运行入口`)
  if (hasHost) {
    await build({
      ...hostBuild,
      entryPoints: [`${source}/host/index.ts`],
      outfile: `${directory}/index.js`,
    })
  } else {
    // 纯 UI 组件仍需要可被 Loader 发现的宿主锚点。
    await writeFile(
      path.join(directory, 'index.js'),
      'export const inject = []\nexport async function apply() {}\n',
    )
  }
  if (hasClient) {
    if (component.exports['./client'] !== './client.js')
      throw new Error(`${id} 的 ./client 必须指向 ./client.js`)
    // rc.5 使用模块工厂；每个组件的 factory ID 与内部清单完全一致。
    await build({
      absWorkingDir: root,
      entryPoints: [`${source}/client/index.ts`],
      outfile: `${directory}/client.js`,
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
      loader: { '.css': 'text' },
      banner: {
        js: `window.__ModuleLoader__.load({id:${JSON.stringify(component.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
      },
      footer: { js: 'return module.exports;}});' },
    })
  }
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(component, null, 2)}\n`)
  await writeFile(path.join(directory, 'index.d.ts'), declaration)
  await cp(path.join(root, source, 'locale'), path.join(directory, 'locale'), { recursive: true })
  // 子路径供原生管理页读取元信息；运行时以 file URL 挂载带独立清单的实现。
  await writeFile(
    path.join(output, `${id}.js`),
    `import { defineComponent } from './runtime/host/component.js'\n` +
      `export const { inject, apply } = defineComponent(new URL('./components/${id}/index.js', import.meta.url))\n`,
  )
  await writeFile(path.join(output, `${id}.d.ts`), declaration)
}
// 保留旧宿主入口，升级时既有 ID、接口和 storageDomain 均不变。
await writeFile(
  path.join(output, 'index.js'),
  "export { inject, apply } from './model-selector.js'\n",
)
await writeFile(
  path.join(output, 'index.d.ts'),
  "export { inject, apply } from './model-selector.js'\n",
)
