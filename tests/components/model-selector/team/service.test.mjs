/** 使用原生 Team、会话与 JSONL 服务验证状态持久化及投影。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionStore } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import TeamService from '@deepseek-ai/dsh-agent-team'

test('原生 Team 服务：根会话选项持久化与投影同步，子会话不能修改，重载恢复选择', async (t) => {
  await mkdir('agent_temp/tests', { recursive: true })
  const directory = await mkdtemp(resolve('agent_temp/tests/team-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'project')
  await mkdir(workspace)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [
    SessionProjectionRegistry,
    SessionStore,
    AgentRegistry,
    SystemPrompt,
    LlmRuntime,
    Tools,
    AgentLoop,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(JsonlPersistence, { root: join(directory, 'sessions') })
  // 本测试不创建真实 subagent 运行树，只提供根解析；Team、投影、会话和磁盘均为原生服务。
  ctx.provide('subagents', {
    rootOf: (agent) =>
      agent.session.header.parentSession
        ? ctx.agents.get(agent.session.header.parentSession)
        : agent,
  })
  let team = ctx.plugin(TeamService)
  await team
  const { agent: root } = await ctx.agents.create({
    sessionId: 'team-root',
    meta: { cwd: workspace },
  })
  const { agent: child } = await ctx.agents.create({
    sessionId: 'team-child',
    meta: { cwd: workspace, parentSession: root.id, origin: 'subagent' },
  })
  const enabled = () => ctx.sessionProjections.snapshot(root.session).values.agentTeam.enabled
  assert.equal(enabled(), false)
  await ctx.agentTeams.setEnabled(root, true)
  assert.equal(enabled(), true)
  await ctx.agentTeams.setEnabled(root, true)
  assert.equal(
    root.session.snapshotEvents().filter((event) => event.type === 'team/mode').length,
    1,
  )
  await assert.rejects(ctx.agentTeams.setEnabled(child, false), /root Session/)
  assert.equal(enabled(), true)
  await team.dispose()
  team = ctx.plugin(TeamService)
  await team
  assert.equal(enabled(), true)
  await ctx.agentTeams.setEnabled(root, false)
  assert.equal(enabled(), false)
  assert.equal((await ctx.sessionPersistence.stat(root.id)).header.id, root.id)
})
