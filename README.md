# opencode-compact-plugin

Agent-callable session inspection and compaction tools, implemented as a standalone OpenCode V2 plugin.

The agent decides when to use the tools. The plugin supplies information and performs requested actions; it does not automatically compact at phase boundaries or enforce a usage threshold.

## Use locally

Requires Bun for development. Clone, install, and build:

```sh
git clone https://github.com/neriousy/compact-plugin.git
cd compact-plugin
bun install
bun run build
```

Add this package's absolute directory to your OpenCode configuration:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-compact-plugin"],
}
```

The tools appear in Code Mode as `tools.session.info` and `tools.session.compact`. Their effective names are `session_info` and `session_compact`.

## Inspect a session

Omit `sessionID` for the calling agent's session:

```js
return await tools.session.info({})
```

The result includes session identity, parent ID, title, working directory, agent, model and variant, catalog limits, total cost in USD, and context usage:

```json
{
  "context": {
    "tokens": 2000,
    "percent": 2,
    "remaining": 98000,
    "source": "last_completed_step",
    "messageID": "msg_example",
    "measuredAt": 1789640000000
  }
}
```

- Usage comes from the latest completed model step and includes input, cached input, output, and reasoning. It excludes later messages and tool results.
- `measuredAt` is a Unix timestamp in milliseconds. This is a historical measurement, not a live tokenizer reading.
- Unknown values are `null`, including after a checkpoint until fresh usage is available, a model change, or a staged revert.
- Percentage and remaining tokens use the catalog context window. They do not account for the runner's output reserve or automatic-compaction buffer.
- Limits are `null` when the model is missing or the target session belongs to another Location. A catalog context limit of zero means unknown.
- Session cost is cumulative; context usage is not.

Target another known session with `tools.session.info({ sessionID: "ses_example" })`.

## Request compaction

Inspect usage first. At low usage, compaction is usually unnecessary unless the user explicitly asks for it. Before a useful checkpoint, record decisions, exact references worth preserving, and the next action in the conversation.

```js
return await tools.session.compact({})
```

The response is an admission acknowledgement:

```json
{
  "sessionID": "ses_example",
  "id": "msg_example",
  "status": "requested"
}
```

The server performs compaction at the next safe step boundary after current tool calls finish. The agent can continue its task afterward. The tool never waits for its own session to become idle.

## Published V2 compatibility

This package installs **published `@opencode/*@2.0.6` packages** and requires no OpenCode checkout, local patches, or workspace dependencies.

The published plugin API supports session reads and tool registration, but does **not** expose `ctx.session.compact`. Compaction therefore uses the existing public `@opencode/client` HTTP endpoint. By default, `Service.discover()` finds the already-running local service and `Service.headers()` supplies its authentication. The plugin does not start, stop, or replace services.

For a standalone server, configure its HTTP endpoint explicitly:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-compact-plugin",
      "options": {
        "serverURL": "http://127.0.0.1:4096",
        "headers": {
          "authorization": "{env:OPENCODE_AUTHORIZATION}",
        },
      },
    },
  ],
}
```

Omit `headers` for an unauthenticated endpoint. `OPENCODE_AUTHORIZATION` above contains the complete authorization header value. A custom service registration can instead be selected with `options.serviceFile`.

The endpoint's process ID must match the process hosting the plugin, so a standalone instance cannot accidentally compact through a different shared daemon. This transport targets the published V2 `/api/info` and session-compaction APIs. Compaction in an embedded SDK without an HTTP listener remains unsupported; session inspection still works through the plugin context.

## Plugin API findings

See [API-GAPS.md](./API-GAPS.md) for the public API limitations encountered while implementing these tools.

## Development

```sh
bun run check
bun test
bun run build
bun pm pack --dry-run --ignore-scripts
```

Tests use schema-typed session fixtures and a local HTTP server with the published client. They cover cached-token accounting, stale and unknown usage, explicit session IDs, authenticated compaction admission, service discovery, server identity, and transport failures.

The package has not been published to npm.
