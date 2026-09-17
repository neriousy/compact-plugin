import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import type { Options } from "./options.js"

// V2's HTTP client exposes compaction; its published plugin SessionDomain does not.
export const compact = (sessionID: string, options: Options) =>
  Effect.tryPromise({
    try: async (signal) => {
      const { OpenCode } = await import("@opencode/client")
      const { Service } = await import("@opencode/client/service")
      const endpoint = options.serverURL
        ? { url: options.serverURL }
        : await Service.discover({ file: options.serviceFile })
      if (!endpoint)
        throw new Error("No running OpenCode service found. Configure this plugin's serverURL for a standalone server.")
      const client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: { ...Service.headers(endpoint), ...options.headers },
      })
      const request = { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }
      const host = await client.server.info(request)
      // A plugin in a standalone server must not submit to a different shared daemon.
      if (host.pid !== process.pid)
        throw new Error("The endpoint is not hosting this plugin. Set serverURL to this OpenCode server's HTTP URL.")
      return client.session.compact({ sessionID, delivery: "steer" }, request)
    },
    catch: (error) =>
      new Tool.Error({ message: error instanceof Error ? error.message : "Unable to request session compaction" }),
  })
