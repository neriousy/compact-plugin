# V2 plugin API findings

Baseline: published `@opencode/plugin`, `@opencode/client`, and `@opencode/schema` version **2.0.6**. These findings concern agent-callable tools; the agent owns the decision to compact.

## 1. Compaction is available over HTTP but absent from the plugin context

`SessionDomain` omits `compact`, even though the generated public client exposes `client.session.compact(...)`.

**Current implementation:** `src/compact.ts` discovers an existing service or uses an explicit endpoint, authenticates with public client helpers, verifies the hosting process, and calls the HTTP operation. It never uses a locally added plugin method.

**Improvement:** expose the existing client operation on both plugin variants. This would remove connection configuration and support embedded SDK hosts without an HTTP listener.

## 2. Plugins cannot reuse a canonical context-usage read model

The plugin has to combine `ctx.session.get`, `ctx.session.context`, and `ctx.model.list`, then handle cached input, unfinished steps, compaction boundaries, model changes, and unknown limits.

**Current implementation:** reports the latest completed measurement and explicitly labels unknown or stale information. It does not recreate the runner's token estimator or automatic-compaction policy.

**Improvement:** expose session inspection through the public Session API, including measurement provenance, effective limits, estimated usage where available, and the runner's threshold. Agent tools could become thin wrappers.

## 3. No request-specific compaction prompt

The public compaction input carries a session ID, optional request ID, and delivery mode. It has no prompt or preservation instructions.

**Current implementation:** the tool describes how to record a handoff in the conversation before requesting compaction. It does not accept a parameter it cannot deliver.

**Improvement:** durably admit optional guidance with the request and expose the request ID and reason to compaction hooks. Define how differing guidance behaves when pending requests coalesce.

## 4. Useful read operations are absent from the plugin Session subset

The public client has active-session, inbox, individual-message, and instruction-entry APIs that the plugin context does not expose.

**Effect on these tools:** obtaining pending/running compaction status or persistent session-owned guidance requires additional HTTP calls or plugin-maintained state.

**Improvement:** expose the relevant existing operations or include compaction status in the inspection read model.

## 5. Cross-Location model lookup has inconsistent host behavior

The client-derived model-list signature accepts a Location, but the inspected host implementation reads its own Location's catalog. Agent-list lookup has explicit routing support.

**Current implementation:** returns unknown limits for a session in another Location, rather than applying this Location's potentially different model configuration.

**Improvement:** honor Location inputs consistently, or resolve effective model limits within the Session inspection operation.
