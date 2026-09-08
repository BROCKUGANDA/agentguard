# AgentGuard Policy Language

Policies are YAML. Hot-reloadable by the sidecar on `POST /policies/reload`.

## Top-level shape

```yaml
version: "1"          # schema version
default: deny         # zero-trust default — explicit allow required

agents:               # identity → role mapping (used by RBAC)
  "*":
    role: guest       # default role for any unmatched agent
  "demo-agent":
    role: developer

rules:                # ordered list — first match wins
  - id: ...
    match: ...
    decision: ...
    conditions: ...

alerts:               # post-hackathon: webhook on critical denies
  - on_decision: deny
    severity: critical
    webhook: "${AGENTGUARD_SLACK_WEBHOOK}"
```

## `rules[].match`

```yaml
match:
  tool: "filesystem.delete_file"      # exact, or list
  # tool: ["filesystem.read_file", "filesystem.write_file"]
  args:
    path: "*prod*"                   # glob match on arg fields
```

- `tool` — string or string[]
- `args` — map of field name → glob pattern. Pattern is matched against the arg value's string form.

## `rules[].decision`

```yaml
decision: allow | deny | redact
reason:   "Production DB delete blocked outside 09:00–17:00 UTC"   # optional
```

`decision: redact` — allow the call, but mask every `data_classification`
match before the tool sees the args. The sidecar returns `allow: true` plus
`redactedArgs`; `wrapMCP` substitutes them transparently, and the audit log
stores the masked version (raw PII never touches disk). Only meaningful with
a `data_classification` condition — with no match the rule is skipped and
evaluation continues to later rules.

## `rules[].conditions`

Exactly one of (or none — bare `decision` is unconditional):

### `rbac`

```yaml
conditions:
  rbac:
    role: [developer, admin]   # string or string[]; matches if actualRole ∈
    resource: "filesystem.read_file"
    action: allow | deny       # default: matches rule's decision
```

### `rate_limit`

```yaml
conditions:
  rate_limit:
    max: 30
    window: "1m"               # 1s | 1m | 5m | 1h
    scope: agent_tool          # agent_tool | tool | agent
```

Sliding window in memory. Key = `${scope}:${agentId}:${tool}`.

### `time_window`

```yaml
conditions:
  time_window:
    tz: "UTC"                  # IANA tz name (used by Intl.DateTimeFormat)
    allow:
      - start: "09:00"
        end: "17:00"
        weekdays: [mon, tue, wed, thu, fri]   # optional; mon|tue|wed|thu|fri|sat|sun
    invert: false              # if true, MATCH when outside allow window
```

### `data_classification`

```yaml
conditions:
  data_classification:
    patterns:
      - name: us_ssn
        regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
    match_on:
      - "args.subject"
      - "args.body"
    replacement: "[REDACTED]"      # optional; used by decision: redact
```

- `match_on` supports dot-paths (`args.to`, `args.body.signature`)
- Patterns are compiled once at load time
- First match wins within a rule
- `replacement` (optional) overrides the default `[REDACTED:<pattern-name>]`
  placeholder used by `decision: redact`

## Default behavior

- No matching rule → `default` (top-level). Default is `deny` (zero trust).
- Multiple `conditions` types in one rule → all must match (AND).

## Examples

See `policies/agentguard.yaml` for the full demo policy (RBAC, rate-limit, time-window, PII redaction).