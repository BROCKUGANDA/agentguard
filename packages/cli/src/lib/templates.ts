/**
 * Built-in templates shipped with the AgentGuard CLI.
 *
 * Templates are plain string constants (not external files) so the CLI is
 * a single `npm install` with no asset lookups.
 */

const TEMPLATES: Record<string, { description: string; body: string }> = {
  starter: {
    description: 'Safe defaults for a typical dev/demo agent',
    body: `# AgentGuard policy — starter template
# Edit rules below to match your agent's allowed actions.

version: "1"
default: deny

agents:
  "*":
    role: guest

rules:
  # Guests/readers may only read (never write/delete). Developers/admin may write.
  - id: deny-destructive-for-guests
    description: "guest/reader cannot write or delete files"
    match:
      tool: ["filesystem.write_file", "filesystem.delete_file"]
    decision: deny
    reason: "guest/reader role cannot write or delete files"
    conditions:
      rbac:
        role: [guest, reader]
        action: deny

  - id: deny-secrets
    description: "No role may read paths matching *secret* without an explicit allow above"
    match:
      tool: "filesystem.read_file"
      args:
        path: "*secret*"
    decision: deny
    reason: "secrets path denied"

  - id: rbac-read-allow
    description: "developer/admin/reader can read files"
    match:
      tool: "filesystem.read_file"
    decision: allow
    conditions:
      rbac:
        role: [developer, admin, reader]
        action: allow

  - id: rbac-write-allow
    description: "developer/admin can write files"
    match:
      tool: "filesystem.write_file"
    decision: allow
    conditions:
      rbac:
        role: [developer, admin]
        action: allow

  - id: pii-block
    description: "Block tool calls containing PII"
    match:
      tool: ["email.send", "github.create_issue", "webm.send"]
    decision: deny
    reason: "PII detected in payload"
    conditions:
      data_classification:
        patterns:
          - name: us_ssn
            regex: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"
          - name: email_address
            regex: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
        match_on: ["args.body", "args.subject"]

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
`,
  },

  gdpr: {
    description: 'GDPR-compliant: no EU PII export, strict RBAC, full audit',
    body: `# AgentGuard policy — GDPR template
# Conservative: blocks any export of EU-personal-data patterns.

version: "1"
default: deny

agents:
  "*":
    role: guest

rules:
  - id: gdpr-no-eu-pii-export
    description: "Block any outbound tool call containing EU PII patterns"
    match:
      tool: ["email.send", "slack.send", "github.create_issue", "http.post"]
    decision: deny
    reason: "EU PII detected — GDPR Article 44 transfer restriction"
    conditions:
      data_classification:
        patterns:
          - name: eu_iban
            regex: "\\\\b[A-Z]{2}\\\\d{2}[A-Z0-9]{12,30}\\\\b"
          - name: eu_phone
            regex: "\\\\+[1-9]{1,3}[ -]?\\\\d{4,14}\\\\b"
          - name: eu_postcode
            regex: "\\\\b[A-Z]{1,2}\\\\d[A-Z\\\\d]?\\\\s?\\\\d[A-Z]{2}\\\\b"
          - name: eu_passport
            regex: "\\\\b[A-Z][0-9]{8}\\\\b"
          - name: email_address
            regex: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
        match_on: ["args.body", "args.subject", "args.text"]

  - id: gdpr-rbac-strict
    description: "Only admin can read PII-containing files"
    match:
      tool: ["filesystem.read_file", "database.query"]
    decision: deny
    reason: "PII access requires admin role"
    conditions:
      rbac:
        role: [guest, developer, reader]
        action: deny

  - id: gdpr-strict-rate-limit
    description: "10 reads/min per agent — forces intentional access"
    match:
      tool: ["filesystem.read_file", "database.query"]
    decision: deny
    conditions:
      rate_limit:
        max: 10
        window: "1m"
        scope: agent_tool

alerts:
  - on_decision: deny
    severity: critical
    rule_ids: ["gdpr-no-eu-pii-export", "gdpr-rbac-strict"]
    webhook: "\${AGENTGUARD_SLACK_WEBHOOK}"
`,
  },

  finance: {
    description: 'PCI-DSS aware: blocks credit cards, enforces finance-only RBAC',
    body: `# AgentGuard policy — finance / PCI-DSS template
# Strict about payment data, allows finance-role workflows.

version: "1"
default: deny

agents:
  "*":
    role: guest
  "finance-bot":
    role: finance
  "audit-bot":
    role: auditor

rules:
  - id: finance-no-cc-logging
    description: "Never log/print/exfiltrate credit card numbers"
    match:
      tool: ["*"]
    decision: deny
    reason: "PCI-DSS: credit card number detected"
    conditions:
      data_classification:
        patterns:
          - name: visa_mastercard
            regex: "\\\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\\\b"
          - name: amex
            regex: "\\\\b3[47][0-9]{13}\\\\b"
          - name: discover
            regex: "\\\\b6(?:011|5[0-9]{2})[0-9]{12}\\\\b"
        match_on: ["args.body", "args.text", "args.payload", "args.message"]

  - id: finance-rbac
    description: "Only finance + auditor can read transaction files"
    match:
      tool: "filesystem.read_file"
    decision: deny
    reason: "finance/auditor role required"
    conditions:
      rbac:
        role: [guest, developer, reader, admin]
        action: deny

  - id: finance-write-strict-rate
    description: "Writes capped to prevent mass extraction"
    match:
      tool: ["filesystem.write_file", "database.insert", "http.post"]
    decision: deny
    conditions:
      rate_limit:
        max: 30
        window: "1m"
        scope: agent

  - id: finance-business-hours
    description: "DB writes only during business hours"
    match:
      tool: "database.insert"
    decision: deny
    reason: "DB writes blocked outside business hours"
    conditions:
      time_window:
        tz: "UTC"
        allow:
          - start: "08:00"
            end: "18:00"
            weekdays: [mon, tue, wed, thu, fri]
        invert: true   # outside window → deny
`,
  },

  healthcare: {
    description: 'HIPAA-aware: blocks PHI patterns, enforces minimum-necessary access',
    body: `# AgentGuard policy — HIPAA / healthcare template
# Blocks PHI (Protected Health Information) from any non-HIPAA-eligible role.

version: "1"
default: deny

agents:
  "*":
    role: guest
  "clinician":
    role: clinician
  "scheduler":
    role: scheduler

rules:
  - id: hipaa-no-phi-export
    description: "Block PHI export to any external system"
    match:
      tool: ["email.send", "slack.send", "http.post", "s3.upload"]
    decision: deny
    reason: "HIPAA: PHI cannot be exported without BAA + role check"
    conditions:
      data_classification:
        patterns:
          - name: us_ssn
            regex: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"
          - name: mrn
            regex: "\\\\bMRN[: ]?[0-9]{6,10}\\\\b"
          - name: dob
            regex: "\\\\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12][0-9]|3[01])[/-](19|20)\\\\d{2}\\\\b"
          - name: diagnosis_codes
            regex: "\\\\b[A-TV-Z][0-9][0-9AB](\\\\.\\\\d{1,2})?\\\\b"
        match_on: ["args.body", "args.text", "args.payload"]

  - id: hipaa-rbac-clinical
    description: "Only clinicians can read patient files"
    match:
      tool: "filesystem.read_file"
    decision: deny
    reason: "Clinical data requires clinician role"
    conditions:
      rbac:
        role: [guest, developer, admin, finance, auditor]
        action: deny

  - id: hipaa-audit-everything
    description: "All clinical reads get logged at warning level"
    match:
      tool: "filesystem.read_file"
    decision: allow
    conditions:
      rbac:
        role: [clinician, scheduler]
        action: allow

alerts:
  - on_decision: deny
    severity: critical
    rule_ids: ["hipaa-no-phi-export"]
    webhook: "\${AGENTGUARD_COMPLIANCE_WEBHOOK}"
`,
  },

  'dev-strict': {
    description: 'Maximum restriction for production — deny all by default, explicit allow',
    body: `# AgentGuard policy — strict dev template
# Most restrictive. Use in production where mistakes are costly.

version: "1"
default: deny

agents:
  "*":
    role: guest

rules:
  # Each tool must have an explicit allow rule to be used.
  - id: dev-allow-read-only
    description: "Allow read-only operations for trusted roles"
    match:
      tool: ["filesystem.read_file", "github.list_repos", "github.list_pull_requests"]
    decision: allow
    conditions:
      rbac:
        role: [developer, admin, reader]
        action: allow

  - id: dev-deny-everything-else
    description: "Default catch-all deny"
    match:
      tool: ["*"]
    decision: deny
    reason: "Not in allow-list"
    conditions:
      rbac:
        role: [guest, developer, admin, reader, auditor, finance, clinician, scheduler]
        action: deny
`,
  },

  'prod-permissive': {
    description: 'Looser dev/QA template with logging — denies only known-bad patterns',
    body: `# AgentGuard policy — permissive prod template
# Trust-but-verify. Allow most ops, only block PII + rate limit.

version: "1"
default: allow    # NB: default allow — be intentional

agents:
  "*":
    role: developer

rules:
  - id: prod-pii-block
    description: "Always block PII in outbound channels"
    match:
      tool: ["email.send", "slack.send", "github.create_issue"]
    decision: deny
    conditions:
      data_classification:
        patterns:
          - name: us_ssn
            regex: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"
          - name: credit_card
            regex: "\\\\b(?:\\\\d[ -]*?){13,16}\\\\b"
          - name: email_address
            regex: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
        match_on: ["args.body", "args.subject"]

  - id: prod-rate-cap
    description: "Per-agent global cap"
    match:
      tool: ["*"]
    decision: deny
    conditions:
      rate_limit:
        max: 200
        window: "1m"
        scope: agent
`,
  },
};

// ─── Template aliases (canonical names) ────────────────────────────────────
// `finance-pii` and `healthcare-hipaa` are the canonical, intent-revealing
// names; the short aliases (`finance`, `healthcare`) stay for back-compat.
TEMPLATES['finance-pii'] = TEMPLATES.finance;
TEMPLATES['healthcare-hipaa'] = TEMPLATES.healthcare;

// ─── Templates rendered into scaffold files ────────────────────────────────
const PROJECT_TEMPLATES: Record<string, (ctx: Record<string, string>) => string> = {
  'package.json': (ctx) => `{
  "name": "${ctx.name}",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "agentguard": "agentguard"
  },
  "dependencies": {
    "@volcano.dev/agent": "^1.2.0",
    "@agentguard/core": "^0.1.0",
    "@agentguard/cli": "^0.1.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "@types/node": "^22.7.0"
  }
}
`,

  'agent-example.ts': () => `/**
 * Example Volcano SDK agent protected by AgentGuard.
 *
 * Run the sidecar in another terminal:
 *   npx agentguard serve --policy ./policies/agentguard.yaml
 *
 * Then run this:
 *   npm run dev
 */
import { agent, llmOpenAI, mcpStdio } from '@volcano.dev/agent';
import { wrapMCP } from '@agentguard/core';
import 'dotenv/config';

const sidecarUrl = process.env.AGENTGUARD_SIDECAR_URL ?? 'http://localhost:9559';
const apiKey = process.env.OPENAI_API_KEY ?? 'no-key';
const baseURL = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

// Wrap a sample MCP server (stdio) — replace with your own tool
const filesystem = mcpStdio({ command: 'echo', args: ['stub'] });  // replace with your MCP
const guardedFs = wrapMCP(filesystem, {
  sidecarUrl,
  agentId: 'my-agent',
  agentRole: 'developer',
  failClosed: true,
  onDecision: (d, ctx) =>
    console.log(\`  [\${d.allow ? 'ALLOW' : 'DENY '}] \${ctx.toolName} (\${d.policy ?? 'default'}) \${d.latencyMs.toFixed(1)}ms\`),
});

const llm = llmOpenAI({ apiKey, model, ...(baseURL ? { baseURL } : {}) });

const result = await agent({ llm, name: 'my-agent' })
  .then({ prompt: 'Use the filesystem tool to list files in /tmp', mcps: [guardedFs] })
  .run();

console.log('Final output:', (result[result.length - 1] as { llmOutput?: string }).llmOutput);
`,

  'env.example': () => `# LLM — pick one
OPENAI_API_KEY=
# LLM_BASE_URL=http://localhost:8080/v1         # point at llama-server
# LLM_MODEL=qwen2.5-1.5b-instruct-q4_k_m.gguf

# AgentGuard sidecar
AGENTGUARD_SIDECAR_URL=http://localhost:9559

# Optional: alerts
#AGENTGUARD_SLACK_WEBHOOK=https://hooks.slack.com/services/...
`,

  'project-readme.md': (ctx) => `# ${ctx.name}

AI agent protected by AgentGuard.

## Run

\`\`\`bash
# Terminal 1 — sidecar
npx agentguard serve --policy ./policies/agentguard.yaml

# Terminal 2 — your agent
cp .env.example .env       # add OPENAI_API_KEY or LLM_BASE_URL
npm run dev
\`\`\`

Then open the dashboard at http://localhost:5173 (if you ran \`docker compose up\`)
or \`npx agentguard serve --bind-all\` on a server.


## Policy

See \`policies/agentguard.yaml\`. Validate with:

\`\`\`bash
npx agentguard validate policies/agentguard.yaml
\`\`\`

## Audit

\`\`\`bash
npx agentguard audit-verify ./data/audit.sqlite
\`\`\`
`,
};

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

export function getTemplateDescription(name: string): string {
  return TEMPLATES[name]?.description ?? '(no description)';
}

export function renderTemplate(name: string, ctx: Record<string, string>): string {
  const policyTemplate = TEMPLATES[name];
  if (policyTemplate) return policyTemplate.body;
  const projectTemplate = PROJECT_TEMPLATES[name];
  if (projectTemplate) return projectTemplate(ctx);
  throw new Error(`Template not found: ${name}`);
}