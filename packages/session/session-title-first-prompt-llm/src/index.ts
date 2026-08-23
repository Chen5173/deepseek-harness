/** First-human-message model provider for `ctx.sessionTitle`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy plus the first-reply exchange option. */
export type Config = SessionTitleLlmConfig & {
  /**
   * Include the session's first textual assistant reply in the framed input:
   * the title summarizes the user request plus the agent's first answer
   * instead of the prompt alone. Off by default so standalone mounts keep
   * the prompt-only behavior; the shipped base bundle opts in.
   * @default false
   */
  includeFirstReply?: boolean
  /** Milliseconds to wait for that first reply. @default 30000 */
  firstReplyWaitMs?: number
}
/** Loader schema shared with the all-messages provider. */
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
  includeFirstReply: z.boolean().default(false),
  firstReplyWaitMs: z.number().step(1).min(1).default(30_000),
})
/* jscpd:ignore-end */

/**
 * Register the first-prompt model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  // The shared register validates only its LLM policy keys; the exchange
  // options are this plugin's own and pass through the options channel.
  const { includeFirstReply, firstReplyWaitMs, ...llmConfig } = config
  registerSessionTitleLlmProvider(ctx, llmConfig, name, 'first-prompt', (messages) => {
    const first = messages[0]
    if (first === undefined) throw new Error('first-prompt title provider requires one human message')
    return [first]
  }, {
    includeFirstReply: includeFirstReply ?? false,
    ...(firstReplyWaitMs === undefined ? {} : { firstReplyWaitMs }),
  })
}
