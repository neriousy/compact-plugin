import { expect, test } from "bun:test"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionMessage } from "@opencode/schema/session-message"
import { Model } from "@opencode/schema/model"
import { Session } from "@opencode/schema/session"
import { DateTime, Effect } from "effect"
import { register } from "../src/tools.js"
import { fixture } from "./fixture.js"

test("reports 2% from the latest step including cache, rather than cumulative session billing", async () => {
  const setup = fixture()
  setup.state.messages.push(setup.measurement(), {
    ...setup.measurement(),
    id: SessionMessage.ID.make("msg_running"),
    tokens: undefined,
    time: { created: DateTime.makeUnsafe(200) },
  })
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, {})
        expect(yield* setup.execute("info")).toMatchObject({
          sessionID: "ses_current",
          title: "Current task",
          directory: "/project",
          agent: "build",
          cost: 5,
          context: {
            tokens: 2_000,
            percent: 2,
            remaining: 98_000,
            source: "last_completed_step",
            messageID: "msg_measured",
            measuredAt: 100,
          },
        })
        expect(setup.state.namespaces).toEqual([
          { name: "session", description: "Inspect sessions and request context compaction." },
        ])
      }),
    ),
  )
})

test("reports unknown usage for a fresh session and after a completed checkpoint", async () => {
  const setup = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, {})
        expect(yield* setup.execute("info")).toMatchObject({
          context: { tokens: null, percent: null, source: "unavailable" },
        })
        setup.state.messages.push(
          setup.measurement(),
          SessionMessage.CompactionCompleted.make({
            id: SessionMessage.ID.make("msg_checkpoint"),
            type: "compaction",
            status: "completed",
            reason: "manual",
            summary: "## Objective\n- Continue",
            recent: "",
            time: { created: DateTime.makeUnsafe(150) },
            tokens: { input: 80_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        )
        expect(yield* setup.execute("info")).toMatchObject({
          context: { tokens: null, percent: null, messageID: null },
        })
      }),
    ),
  )
})

test("invalidates usage on a model switch and avoids stale samples when switching back", async () => {
  const setup = fixture()
  setup.state.messages.push(setup.measurement())
  const original = setup.state.session.model
  setup.state.session = {
    ...setup.state.session,
    model: Model.Ref.make({ providerID: setup.state.models[0].providerID, id: Model.ID.make("other") }),
  }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, {})
        expect(yield* setup.execute("info")).toMatchObject({ limits: null, context: { tokens: null, percent: null } })
        setup.state.messages.push(setup.measurement())
        setup.state.session = { ...setup.state.session, model: original }
        expect(yield* setup.execute("info")).toMatchObject({ context: { tokens: null, percent: null } })
      }),
    ),
  )
})

test("keeps measured tokens when capacity is unknown and supports an explicit session ID", async () => {
  const setup = fixture()
  setup.state.messages.push(setup.measurement())
  setup.state.models[0].limit.context = 0
  setup.state.session = { ...setup.state.session, id: Session.ID.make("ses_other") }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, {})
        expect(yield* setup.execute("info", { sessionID: "ses_other" })).toMatchObject({
          sessionID: "ses_other",
          context: { tokens: 2_000, percent: null, remaining: null },
        })
        expect(setup.state.reads).toEqual([Session.ID.make("ses_other")])
      }),
    ),
  )
})

test("does not use the host Location's model limits for a different Location", async () => {
  const setup = fixture()
  setup.state.messages.push(setup.measurement())
  setup.state.session = { ...setup.state.session, location: { directory: AbsolutePath.make("/other") } }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, {})
        expect(yield* setup.execute("info")).toMatchObject({
          directory: "/other",
          limits: null,
          context: { tokens: 2_000, percent: null },
        })
      }),
    ),
  )
})
