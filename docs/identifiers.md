# Identifiers

Create new request keys through `src/shared/lib/id.ts`. It exports `createId` from the same UUID v7 library used by the backend. The default library call keeps its state for multiple IDs created within one clock tick.

Pending requests keep their original key and body through retries and reloads, including keys created before UUID v7 was introduced. Do not generate a replacement key for unresolved work.

Treat resource IDs as opaque values. The backend returns outputs in creation order; the client must not infer output order or delivery time from IDs. UUID v7 does not guarantee ordering across processes or clock changes. External provider IDs and security tokens follow their own rules.
