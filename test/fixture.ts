import { Agent } from "@opencode/schema/agent"
import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Schema } from "effect"
import { register } from "../src/tools.js"

export function fixture() {
  const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("model"))
  const state = {
    session: Session.Info.make({
      id: Session.ID.make("ses_current"),
      projectID: Project.ID.global,
      title: "Current task",
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
      location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      cost: Money.USD.make(5),
      tokens: { input: 900_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(100) },
    }),
    models: [{ ...model, limit: { context: 100_000, input: 90_000, output: 10_000 } }],
    messages: new Array<SessionMessage.Info>(),
    reads: new Array<Session.ID>(),
    namespaces: new Array<Tool.Namespace>(),
  }
  const tools = new Map<string, Tool.Info>()
  const context = {
    location: new Location.Info({
      ...state.session.location,
      project: {
        id: Project.ID.global,
        directory: state.session.location.directory,
        canonical: state.session.location.directory,
      },
    }),
    session: {
      get: ({ sessionID }) =>
        Effect.sync(() => state.reads.push(sessionID)).pipe(
          Effect.andThen(() =>
            sessionID === state.session.id
              ? Effect.succeed(state.session)
              : Effect.fail(new Error("Session not found")),
          ),
        ),
      context: () => Effect.succeed(state.messages),
    },
    model: { list: () => Effect.succeed({ location: state.session.location, data: state.models }) },
    tool: {
      transform: (edit) =>
        Effect.sync(() => {
          edit({
            namespace: (namespace) => state.namespaces.push(namespace),
            add: (tool) => tools.set(tool.name, tool),
            list: () => [],
            get: () => undefined,
            update: () => {
              throw new Error("Unexpected tool update")
            },
            remove: () => {
              throw new Error("Unexpected tool removal")
            },
          })
          return { dispose: Effect.sync(() => tools.clear()) }
        }),
    },
  } satisfies Parameters<typeof register>[0]

  return {
    state,
    context,
    execute: (name: string, input: unknown = {}) =>
      Effect.gen(function* () {
        const tool = tools.get(name)
        if (!tool || !Schema.isSchema(tool.input) || !Schema.isSchema(tool.output))
          throw new Error(`Missing schema-backed tool: ${name}`)
        const result = yield* tool.execute(yield* Schema.decodeUnknownEffect(tool.input)(input), {
          sessionID: Session.ID.make("ses_current"),
          agent: Agent.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_call"),
          id: Tool.CallID.make("call_test"),
          progress: () => Effect.void,
        })
        return yield* Schema.encodeUnknownEffect(tool.output)(result.output)
      }),
    measurement: () =>
      SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_measured"),
        type: "assistant",
        model: state.session.model ?? Model.Ref.make({ providerID: model.providerID, id: model.id }),
        agent: Agent.ID.make("build"),
        content: [],
        tokens: { input: 200, output: 100, reasoning: 100, cache: { read: 1_500, write: 100 } },
        time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(100) },
      }),
  }
}
