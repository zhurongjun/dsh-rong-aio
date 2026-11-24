import { transformAsync } from '@babel/core'
import ReactCompilerPlugin from 'babel-plugin-react-compiler'
import { build, transform } from 'esbuild'
import type { BuildOptions, Plugin } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadWorkspaceManifests } from './manifest.ts'

const { root: rootDir, components } = await loadWorkspaceManifests()
const output = path.join(rootDir, 'lib')

const declaration =
  "import type { Context } from '@deepseek-ai/cordis'\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): Promise<void>\n"

const hostBuild: BuildOptions = {
  absWorkingDir: rootDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  banner: {
    js: "import { createRequire as __rongCreateRequire } from 'node:module'; const require = __rongCreateRequire(import.meta.url);",
  },
}

function createReactCompilerPlugin(sourceRoot: string): Plugin {
  return {
    name: 'react-compiler',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        if (!args.path.startsWith(sourceRoot)) return undefined
        const raw = await readFile(args.path, 'utf8')
        const stripped = await transform(raw, {
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsx: 'preserve',
          target: 'es2022',
          sourcefile: args.path,
        })
        const compiled = await transformAsync(stripped.code, {
          filename: args.path,
          plugins: [[ReactCompilerPlugin, { target: '18', panicThreshold: 'all_errors' }]],
          parserOpts: { plugins: ['jsx'] },
          sourceMaps: false,
          configFile: false,
          babelrc: false,
        })
        if (!compiled?.code) throw new Error(`React Compiler 未产出代码：${args.path}`)
        return { contents: compiled.code, loader: 'jsx' }
      })
    },
  }
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await build({
  ...hostBuild,
  entryPoints: ['src/runtime/host/component.ts'],
  outfile: 'lib/runtime/host/component.js',
})

const sourceRoot = path.join(rootDir, 'src') + path.sep

for (const { id, source, manifest: component, hasHost, hasClient } of components) {
  const directory = path.join(output, 'components', id)
  await mkdir(directory, { recursive: true })

  if (hasHost) {
    await build({
      ...hostBuild,
      entryPoints: [`${source}/host/index.ts`],
      outfile: `${directory}/index.js`,
    })
  } else {
    await writeFile(
      path.join(directory, 'index.js'),
      'export const inject = []\nexport async function apply() {}\n',
    )
  }

  if (hasClient) {
    await build({
      absWorkingDir: rootDir,
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
      plugins: [createReactCompilerPlugin(sourceRoot)],
      banner: {
        js: `window.__ModuleLoader__.load({id:${JSON.stringify(component.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
      },
      footer: { js: 'return module.exports;}});' },
    })
  }

  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(component, null, 2)}\n`)
  await writeFile(path.join(directory, 'index.d.ts'), declaration)
  await cp(path.join(rootDir, source, 'locale'), path.join(directory, 'locale'), {
    recursive: true,
  })

  await writeFile(
    path.join(output, `${id}.js`),
    `import { defineComponent } from './runtime/host/component.js'\n` +
      `export const { inject, apply } = defineComponent(new URL('./components/${id}/index.js', import.meta.url))\n`,
  )
  await writeFile(path.join(output, `${id}.d.ts`), declaration)
}
