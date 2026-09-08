# @agentguard/core

Intercepts MCP tool calls made by `@volcano.dev/agent` and forwards each call to the
AgentGuard sidecar for policy evaluation before it is executed.

## Install

```sh
npm install @agentguard/core
```

Peer dependency: `@volcano.dev/agent ^1.2.0`.

## Quick start

```ts
import { llmOpenAI, mcp } from '@volcano.dev/agent';
import { wrapMCP, guardedAgent } from '@agentguard/core';

const fs = mcp('stdio://./demo/mcp-filesystem/dist/index.js');
const guardedFs = wrapMCP(fs, {
  sidecarUrl: 'http://localhost:9559',
  agentId: 'demo-agent',
  agentRole: 'developer',
  failClosed: true,
});

await guardedAgent({
  llm: llmOpenAI({ apiKey: process.env.OPENAI_API_KEY! }),
  agentId: 'demo-agent',
  sidecarUrl: 'http://localhost:9559',
  failClosed: true,
})
  .builder.then({ prompt: 'delete temp.log', mcps: [guardedFs] })
  .run();
```

## How interception works

1. The SDK assigns tool names as `${mcpHandle.id}.${tool.name}` (e.g.
   `mcp_a3f9d2e1.read_file`). The LLM sees those fully qualified names.
2. `wrapMCP` returns a new handle whose `callTool(name, args)` calls the
   sidecar's `POST /check` first, sending the qualified name and the args.
3. On `allow: false` the wrapper throws `AgentGuardBlockedError` and the
   original tool is **never invoked**.
4. On `allow: true` with `redactedArgs`, the wrapper forwards the redacted
   args to the original tool.
5. On `allow: true` without redaction, the wrapper forwards the caller's
   args unchanged.
6. `id`, `url`, `auth`, `transport`, `process`, `listTools`, and `cleanup`
   are preserved so the wrapped handle is interchangeable with the
   original from the SDK's perspective.

There is no SDK "before-tool" hook — interception happens at the
`MCPHandle` layer, which is the only point where the SDK invokes a tool.

## Fail closed vs. fail open

| `failClosed` | Sidecar unreachable                                  |
|--------------|-------------------------------------------------------|
| `true`       | `AgentGuardUnreachableError` thrown; tool not called. |
| `false`      | Synthetic allow with `policy: 'fail-open'` is logged. |

## Error classes

- `AgentGuardError` — base, has `decisionId`, `policy`, `status`.
- `AgentGuardBlockedError` — extends base; thrown on deny.
- `AgentGuardUnreachableError` — extends base; thrown when the sidecar is
  unreachable AND `failClosed=true`.

## Development

```sh
npm install
npm run typecheck
npm test
```