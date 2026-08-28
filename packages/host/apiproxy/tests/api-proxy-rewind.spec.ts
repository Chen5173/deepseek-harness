/** Session-rewind boundaries, visibility filtering, and rewind guards. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`rewind-${String(nextRpc++)}`), payload }
}

async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('rewind test sources are live')),
  })
  return ctx
}

function liveAgent(
  ctx: Context,
  id: string,
  turns: number,
  status: Agent['status'] = 'idle',
  lineage: { origin?: 'subagent' } = {},
): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj', ...lineage } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({ id: session.id, session, status, ctx } as Agent)
  return session
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

describe('sessions.rewind', () => {
  it('voids the last exchange through the previous turn boundary', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind', 2)
    // The boundary is the END of the turn BEFORE the last human exchange
    // (turn 1's end), which is the first turn/end in the log.
    const boundary = session.events.find(event => event.type === 'turn/end')!.seq
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.throughSeq).toBe(boundary)
    const marker = session.events.at(-1)
    expect(marker?.type).toBe('session/rewind')
    expect(session.surface.nodes).toEqual([1])
    expect(session.deriveMessages()).toHaveLength(1)
  })

  it('rewinds the first exchange to the empty prefix (throughSeq -1)', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-first', 1)
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.throughSeq).toBe(-1)
    expect(session.surface.nodes).toEqual([])
  })

  it('a second rewind voids only the new exchange', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-twice', 2)
    await proxy.sessions.rewind(request({ sessionId: session.id }))
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'redo prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    // The new boundary is the FIRST turn's end, not the empty prefix: the
    // redo turn is voided while turn 1 survives.
    const firstEnd = session.events.find(event => event.type === 'turn/end')!.seq
    expect(response.result.value.throughSeq).toBe(firstEnd)
    expect(session.surface.nodes).toEqual([1])
  })

  it('history serves the visible events only', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-history', 2)
    await proxy.sessions.rewind(request({ sessionId: session.id }))
    const response = await proxy.sessions.history(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    const types = response.result.value.events.map(entry => entry.event.type)
    expect(types).toEqual(['turn/start', 'user/message', 'turn/end'])
    expect(types).not.toContain('session/rewind')
  })

  it('rejects a running session', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-running', 2, 'running')
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('rewind-unavailable')
  })

  it('rejects a session with no visible human prompt', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-empty', 0)
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('rewind-unavailable')
  })

  it('rejects a session-backed subagent', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveAgent(ctx, 'session-rewind-sub', 1, 'idle', { origin: 'subagent' })
    const response = await proxy.sessions.rewind(request({ sessionId: session.id }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('agent-busy')
  })

  it('rejects an unattached session id', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const response = await proxy.sessions.rewind(request({ sessionId: sid('session-ghost') }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('session-not-found')
  })
})
