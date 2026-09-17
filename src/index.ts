import { Plugin } from "@opencode/plugin/effect"
import { Effect, Schema } from "effect"
import { Options } from "./options.js"
import { register } from "./tools.js"

export default Plugin.define({
  id: "opencode-compact-plugin",
  effect: (ctx) =>
    Effect.gen(function* () {
      const options = yield* Schema.decodeUnknownEffect(Options)(ctx.options).pipe(Effect.orDie)
      yield* register(ctx, options)
    }),
})
