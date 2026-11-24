import { loadWorkspaceManifests } from '../manifest.ts'
import { runBoundariesCheck } from './boundaries.ts'
import { runUiContractCheck } from './ui-contract.ts'

const manifestResult = await loadWorkspaceManifests().then(
  (workspace) => ({ ok: true as const, count: workspace.components.length }),
  (error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }),
)

const [boundaries, uiContract] = await Promise.all([runBoundariesCheck(), runUiContractCheck()])

const errors = [
  ...(manifestResult.ok ? [] : [manifestResult.error]),
  ...boundaries.errors,
  ...uiContract.errors,
]

for (const error of errors) console.error(error)

if (errors.length) {
  process.exitCode = 1
} else {
  const components = manifestResult.ok ? manifestResult.count : 0
  console.log(
    `工程契约检查通过：${components} 个组件，边界检查 ${boundaries.fileCount} 个文件，UI 契约 ${uiContract.fileCount} 个文件（DSH ${uiContract.version}）`,
  )
}
