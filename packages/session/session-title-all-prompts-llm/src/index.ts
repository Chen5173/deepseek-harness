/** All-human-messages model provider for `ctx.sessionTitle`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

export const name = 'session-title-all-prompts-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy plus the conversation-summary switch. */
export type Config = SessionTitleLlmConfig & {
  /**
   * Frame the whole conversation (user prompts + assistant replies) so the
   * title summarizes the session content. Off, only the human messages are
   * framed. Defaults to on — this provider exists to summarize conversations.
   * @default true
   */
  includeAssistantReplies?: boolean
}
/** Loader schema shared with the first-prompt provider. */
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
  includeAssistantReplies: z.boolean().default(true),
})
/* jscpd:ignore-end */

/**
 * Register the all-prompts model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  const { includeAssistantReplies, ...llmConfig } = config
  registerSessionTitleLlmProvider(ctx, llmConfig, name, 'all-prompts', messages => messages, {
    includeAssistantReplies: includeAssistantReplies ?? true,
  })
}
