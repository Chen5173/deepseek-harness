# @deepseek-ai/dsh-session-title-all-prompts-llm

English | [中文](README.zh.md)

Optional `ctx.sessionTitle` provider that summarizes the whole conversation — every eligible human message plus the assistant replies — through `ctx.llm` (enable via `includeAssistantReplies: true`, the default). It registers the `all-prompts` cadence and starts a new revision after each new human prompt, using seeded history as well as child-session prompts. A newer revision aborts and supersedes older work; even a provider that ignores cancellation cannot commit stale output.

The plugin uses the complete required [shared LLM configuration](../session-title-llm/README.md#configuration). Omit both `provider` and `model` to inherit the exact route from each current logged main request, or set both to route title generation independently. The framed conversation is bounded by `maxInputBytes`: on overflow the middle turns are dropped (the opening exchange stays for context and the most recent messages win) instead of failing.

## Model Experience

### All-messages title request

#### What the model sees

The title model receives the shared title instruction and a JSON conversation transcript of all eligible human messages interleaved with the assistant replies, in log order with exact seqs. Seeded history is included. With `includeAssistantReplies: false` only the human messages are framed.

#### Token effect

One auxiliary request may follow every new eligible prompt, bounded per request by `maxInputBytes` and `maxOutputTokens`; explicit refreshes may add calls. The main agent request gains zero tokens.

#### KV Cache effect

No main-request invalidation. Auxiliary input grows or changes after each prompt, so provider-specific cache reuse ends at the first changed JSON token.

## Known Limitations and Deferred Work

- Very long conversations are bounded by dropping the middle turns (the opening exchange and the most recent messages win); there is no multi-level summarization-of-summaries yet.
- It treats all eligible turns equally and offers no weighting, filtering, or manual-title precedence.
