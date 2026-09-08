/**
 * Seed policy for tenants that don't have a policy file yet.
 *
 * When a new tenant makes its first request and no `policies/<tenant>.yaml`
 * exists, the sidecar writes THIS YAML as the tenant's policy (fail-closed
 * starting point — operators are expected to replace it with a tuned policy,
 * then POST /policies/reload).
 */
export const STARTER_POLICY_YAML = `# AgentGuard policy — auto-created for tenant <id> on first request.
# Replace this file with a tuned policy, then POST /policies/reload.
version: "1"
default: deny

agents:
  "*":
    role: guest

rules:
  - id: rbac-read-allow
    description: "All roles can read/write files outside /secrets"
    match:
      tool: ["filesystem.read_file", "filesystem.write_file", "filesystem.delete_file"]
    decision: allow
    conditions:
      rbac:
        role: [guest, developer, admin, reader]
        action: allow

  - id: pii-block
    description: "Mask PII (SSN / email) in outbound channels instead of blocking the call"
    match:
      tool: ["email.send", "slack.send", "github.create_issue", "http.post"]
    decision: redact
    reason: "PII redacted from outbound payload"
    conditions:
      data_classification:
        patterns:
          - name: us_ssn
            regex: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"
          - name: email_address
            regex: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
        match_on: ["args.body", "args.subject", "args.text"]

  - id: rate-limit-default
    description: "Max 60 calls/min per agent-tool"
    match:
      tool: ["*"]
    decision: deny
    reason: "Rate limit exceeded (60/min)"
    conditions:
      rate_limit:
        max: 60
        window: "1m"
        scope: agent_tool
`;

/** Safe tenant id characters — lowercase letters, digits, dash, underscore. */
export const TENANT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;