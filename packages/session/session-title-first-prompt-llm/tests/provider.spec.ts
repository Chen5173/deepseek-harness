import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, { createAssistantMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, { type SessionTitleProvider } from '@deepseek-ai/dsh-session-title'
import * as providerPlugin from '@deepseek-ai/dsh-session-title-first-prompt-llm'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'First-message model title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } as const
const LLM_CONFIG = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 1_000,
  maxOutputTokens: 32,
  timeoutMs: 1_000,
  provider: 'title-route',
  model: 'title-model',
} as const

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('first-prompt LLM title provider', () => {
  it('rejects an impossible empty provider request at its own boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    let registered: SessionTitleProvider | undefined
    vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      registered = provider
      return async () => undefined
    })
    providerPlugin.apply(ctx, LLM_CONFIG)

    await expect(registered!.generate({
      session: Session.create(SessionId('empty-first-provider')),
      messages: [],
      signal: new AbortController().signal,
    })).rejects.toThrow(/requires one human message/)
  })

  it('always selects only the first eligible human message, including explicit refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['title-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId('first-plugin'))
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first input' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await settle()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second input must be ignored' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.sessionTitle.refresh(session)

    expect(adapter.requests).toHaveLength(2)
    for (const options of adapter.requests) {
      const content = options.messages[0]?.content[0]
      expect(content?.type === 'text' && content.text).toContain('first input')
      expect(content?.type === 'text' && content.text).not.toContain('second input must be ignored')
    }
    expect(ctx.sessionTitle.get(session)).toMatchObject({ messageSeqs: [first.seq] })
  })
})
it('includes the first textual assistant reply when configured and waits for it', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['title-route'], adapter)
  await ctx.plugin(providerPlugin, { ...LLM_CONFIG, includeFirstReply: true, firstReplyWaitMs: 5000 })
  const session = ctx.sessions.create(SessionId('first-reply-plugin'))
  session.append('turn/start', { turn: 1 })
  const first = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '帮我修复侧栏排序' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  await settle()

  const regeneration = ctx.sessionTitle.refresh(session)
  // The reply lands after generation starts; the provider waits for it.
  session.append('assistant/message', {
    message: createAssistantMessage({
      content: [{ type: 'text', text: '排序根因是 updatedAt 只算人类输入' }],
      source: { provider: 'main', model: 'main-model' },
    }),
    turn: 1,
    step: 1,
  }, { surfaceOp: 'append' })
  await regeneration

  const options = adapter.requests.at(-1)
  expect(options).toBeDefined()
  const content = options?.messages[0]?.content[0]
  expect(content?.type === 'text' && content.text).toContain('帮我修复侧栏排序')
  expect(content?.type === 'text' && content.text).toContain('排序根因是 updatedAt 只算人类输入')
  expect(ctx.sessionTitle.get(session)).toMatchObject({ messageSeqs: [first.seq] })
})

it('waits only the configured bound and falls back to the prompt alone', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['title-route'], adapter)
  await ctx.plugin(providerPlugin, { ...LLM_CONFIG, includeFirstReply: true, firstReplyWaitMs: 50 })
  const session = ctx.sessions.create(SessionId('first-reply-timeout'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'only the prompt' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  await settle()

  await ctx.sessionTitle.refresh(session)

  const options = adapter.requests.at(-1)
  const content = options?.messages[0]?.content[0]
  expect(content?.type === 'text' && content.text).toContain('only the prompt')
  expect(content?.type === 'text' && content.text).not.toContain('assistantReply')
  expect(ctx.sessionTitle.get(session)?.source.kind).toBe('provider')
})
