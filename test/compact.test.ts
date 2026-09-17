import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { compact } from "../src/compact.js"
import { Options } from "../src/options.js"
import { register } from "../src/tools.js"
import { fixture } from "./fixture.js"

test("the registered tool admits compaction through the published HTTP client without ctx.session.compact", async () => {
  using http = server()
  const setup = fixture()
  expect("compact" in setup.context.session).toBe(false)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* register(setup.context, { serverURL: http.url, headers: { authorization: "Bearer fixture" } })
        expect(yield* setup.execute("compact")).toEqual({
          sessionID: "ses_current",
          id: "msg_compact",
          status: "requested",
        })
      }),
    ),
  )
  expect(http.calls).toEqual([
    { method: "GET", path: "/api/info", authorization: "Bearer fixture", body: undefined },
    {
      method: "POST",
      path: "/api/session/ses_current/compact",
      authorization: "Bearer fixture",
      body: { delivery: "steer" },
    },
  ])
})

test("discovers and authenticates an existing service through the published Service API", async () => {
  using http = server()
  const directory = await mkdtemp(join(tmpdir(), "opencode-compact-plugin-"))
  try {
    const serviceFile = join(directory, "service.json")
    await Bun.write(
      serviceFile,
      JSON.stringify({ url: http.url, pid: process.pid, version: "2.0.6", password: "fixture" }),
    )
    expect(await Effect.runPromise(compact("ses_current", { serviceFile }))).toMatchObject({ id: "msg_compact" })
    expect(http.calls.filter((call) => call.method === "POST")).toHaveLength(1)
    expect(
      http.calls.every((call) => call.authorization === `Basic ${Buffer.from("opencode:fixture").toString("base64")}`),
    ).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("refuses to compact through a different server process", async () => {
  using http = server({ pid: process.pid + 1 })
  expect(await Effect.runPromise(compact("ses_current", { serverURL: http.url }).pipe(Effect.flip))).toMatchObject({
    _tag: "Tool.Error",
    message: expect.stringContaining("not hosting this plugin"),
  })
  expect(http.calls.filter((call) => call.method === "POST")).toEqual([])
})

test("returns an actionable error when discovery finds no service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-compact-plugin-"))
  try {
    expect(
      await Effect.runPromise(
        compact("ses_current", { serviceFile: join(directory, "missing.json") }).pipe(Effect.flip),
      ),
    ).toMatchObject({
      _tag: "Tool.Error",
      message: expect.stringContaining("Configure this plugin's serverURL"),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("normalizes HTTP failures into tool errors", async () => {
  using http = server({ fail: true })
  expect(await Effect.runPromise(compact("ses_current", { serverURL: http.url }).pipe(Effect.flip))).toMatchObject({
    _tag: "Tool.Error",
  })
})

test("validates connection options", () => {
  expect(() => Schema.decodeUnknownSync(Options)({ serverURL: "file:///server" })).toThrow()
  expect(Schema.decodeUnknownSync(Options)({ serverURL: "http://127.0.0.1:4096" })).toEqual({
    serverURL: "http://127.0.0.1:4096",
  })
})

function server(options: { pid?: number; fail?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; authorization: string | null; body: unknown }> = []
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      calls.push({
        method: request.method,
        path,
        authorization: request.headers.get("authorization"),
        body: request.method === "POST" ? await request.json() : undefined,
      })
      if (path === "/api/info")
        return Response.json({
          version: "2.0.6",
          pid: options.pid ?? process.pid,
          urls: [],
          paths: { tmp: "/fixture" },
        })
      if (options.fail) return Response.json({ error: "Unavailable" }, { status: 503 })
      if (path === "/api/session/ses_current/compact")
        return Response.json({
          data: {
            id: "msg_compact",
            sessionID: "ses_current",
            type: "compaction",
            delivery: "steer",
            payload: {},
            timeCreated: 1,
          },
        })
      return new Response("Not found", { status: 404 })
    },
  })
  return { calls, url: http.url.href, [Symbol.dispose]: () => http.stop(true) }
}
