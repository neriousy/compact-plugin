import type { Plugin } from "@opencode/plugin/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { TokenUsage } from "@opencode/schema/token-usage"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Schema } from "effect"
import { compact } from "./compact.js"
import type { Options } from "./options.js"

type Context = Pick<Plugin.Context, "location"> & {
  readonly session: Pick<Plugin.Context["session"], "get" | "context">
  readonly model: Pick<Plugin.Context["model"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "transform">
}

const Input = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to use the current session." }),
})

const Info = Schema.Struct({
  sessionID: Session.ID,
  parentID: Schema.NullOr(Session.ID),
  title: Schema.NullOr(Schema.String),
  directory: AbsolutePath,
  agent: Schema.NullOr(Agent.ID),
  model: Schema.NullOr(Model.Ref),
  limits: Schema.NullOr(Model.Info.fields.limit).annotate({
    description: "Catalog token limits. A zero context limit means unknown. Null outside this plugin's Location.",
  }),
  cost: Session.Info.fields.cost.annotate({
    description: "Cumulative session cost in USD, separate from context usage.",
  }),
  context: Schema.Struct({
    tokens: Schema.NullOr(Schema.Finite),
    percent: Schema.NullOr(Schema.Finite),
    remaining: Schema.NullOr(Schema.Finite),
    source: Schema.Literals(["last_completed_step", "unavailable"]),
    messageID: Schema.NullOr(SessionMessage.ID),
    measuredAt: Schema.NullOr(Schema.Finite),
  }).annotate({
    description:
      "Latest recorded input (including cache), output, and reasoning usage. Excludes subsequent messages and tool results. Unknown values are null, not zero. Percentage and remaining tokens use limits.context; they are not the runner's automatic-compaction threshold.",
  }),
})

const Compact = Schema.Struct({
  sessionID: Session.ID,
  id: SessionMessage.ID,
  status: Schema.Literal("requested"),
})

export const register = Effect.fn("SessionTools.register")(function* (ctx: Context, options: Options) {
  yield* ctx.tool.transform((editor) => {
    editor.namespace({ name: "session", description: "Inspect sessions and request context compaction." })
    editor.add({
      name: "info",
      description:
        "Get session identity, model limits, cost, and measured context usage. Check before deciding to compact; low usage usually does not warrant compaction. Usage excludes work since the source message. Unavailable means unknown, not zero.",
      input: Input,
      output: Info,
      options: { namespace: "session", codemode: true, pinned: true },
      execute: (input, tool) =>
        Effect.gen(function* () {
          const sessionID = input.sessionID ?? tool.sessionID
          const session = yield* ctx.session.get({ sessionID })
          const messages = yield* ctx.session.context({ sessionID })
          const latest = messages.findLast((message) => message.type === "assistant")
          const model = session.model ?? latest?.model
          const limits =
            session.location.directory === ctx.location.directory &&
            session.location.workspaceID === ctx.location.workspaceID
              ? (yield* ctx.model.list()).data.find(
                  (item) => item.providerID === model?.providerID && item.id === model?.id,
                )?.limit
              : undefined
          // Only measurements after the latest checkpoint describe the active context.
          const checkpoint = messages.findLastIndex(
            (message) => message.type === "compaction" && message.status === "completed",
          )
          const last = messages
            .slice(checkpoint + 1)
            .findLast(
              (message) =>
                message.type === "assistant" &&
                message.time.completed !== undefined &&
                !message.error &&
                message.tokens !== undefined &&
                message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0,
            )
          const measured =
            !session.revert &&
            last?.type === "assistant" &&
            last.model.providerID === model?.providerID &&
            last.model.id === model?.id
              ? last
              : undefined
          const tokens = measured?.tokens ? TokenUsage.total(measured.tokens) : null
          const capacity = limits && limits.context > 0 ? limits.context : undefined
          return {
            output: {
              sessionID,
              parentID: session.parentID ?? null,
              title: session.title ?? null,
              directory: session.location.directory,
              agent: session.agent ?? (sessionID === tool.sessionID ? tool.agent : latest?.agent) ?? null,
              model: model ?? null,
              limits: limits ?? null,
              cost: session.cost,
              context: {
                tokens,
                percent: tokens !== null && capacity ? Math.round((tokens / capacity) * 1000) / 10 : null,
                remaining: tokens !== null && capacity ? Math.max(0, capacity - tokens) : null,
                source: tokens === null ? ("unavailable" as const) : ("last_completed_step" as const),
                messageID: measured?.id ?? null,
                measuredAt: measured?.time.completed ? DateTime.toEpochMillis(measured.time.completed) : null,
              },
            },
          }
        }).pipe(Effect.mapError(() => new Tool.Error({ message: "Unable to read session info" }))),
    })
    editor.add({
      name: "compact",
      description:
        "Request compaction of a session. Check session.info first and avoid compacting low-usage context unless the user requests it. Returns after admission; compaction runs at the next safe step boundary after current tools finish. The agent can continue the task afterward.",
      input: Input,
      output: Compact,
      options: { namespace: "session", codemode: true, pinned: true },
      execute: (input, tool) =>
        Effect.gen(function* () {
          const sessionID = input.sessionID ?? tool.sessionID
          yield* ctx.session
            .get({ sessionID })
            .pipe(Effect.mapError(() => new Tool.Error({ message: `Unable to find session ${sessionID}` })))
          const request = yield* compact(sessionID, options)
          return {
            output: { sessionID, id: SessionMessage.ID.make(request.id), status: "requested" as const },
            content: `Compaction requested for ${sessionID}. It will run at the next safe step boundary.`,
          }
        }),
    })
  })
})
