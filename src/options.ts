import { Schema } from "effect"

export const Options = Schema.Struct({
  serverURL: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^https?:\/\/[^/\s]+/))),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  serviceFile: Schema.optionalKey(Schema.String),
})
export type Options = typeof Options.Type
