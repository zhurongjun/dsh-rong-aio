import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await mkdir('lib', { recursive: true })
// DSH rc.5 使用模块工厂，而非浏览器 ESM/import map；React 与 primitives 由宿主提供。
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
  loader: { '.css': 'text' },
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
})
await build({
  entryPoints: ['src/host/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
await writeFile(
  'lib/index.d.ts',
  "import type { Context } from '@deepseek-ai/cordis'\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): Promise<void>\n",
)
