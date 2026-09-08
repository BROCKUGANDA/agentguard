# AgentGuard — Demo Video Script (3-5 minutes)

> Natural pace, conversational tone. Capture the whole process: how it works, each step.

---

## [0:00] Introduction

"AgentGuard is a multi-agent security orchestrator for AI workflows. It sits between your AI agents and the tools they call — evaluating every single tool call against policy before it executes. In this demo, I'll show you the whole process, step by step."

---

## [0:20] The Problem

"AI agents are autonomous now. They read files, send emails, query databases, even merge pull requests. A crew of five agents with access to twenty tools produces a hundred possible tool-call paths per step. One hallucinated delete, one prompt injection that sends PII — and you have a production incident. Logging tells you after the fact. Prompt engineering is bypassable. Sandboxing is all-or-nothing. There's no enforcement layer."

---

## [0:45] The Architecture

"Here's how AgentGuard works. Your agent is built with the Volcano SDK. You wrap its MCP tool handles with `wrapMCP`. Now, every tool call goes through the AgentGuard sidecar first. The sidecar evaluates the call against your policy — RBAC, rate limits, time windows, PII redaction. If allowed, the tool runs. If denied, the agent gets a blocked error and the tool never executes. Every decision is written to a SHA-256 hash-chained audit log and streamed live to the dashboard."

---

## [1:10] Live Demo — Dashboard

"Let me show you the dashboard. Here on the home page, you can see real-time KPIs — allowed calls, blocked calls, average latency. The live feed shows decisions as they happen. Each entry shows the agent, the tool, the decision, and the reason."

[Show: Home page with live feed]

"Clicking on any entry opens a detail modal with the full audit record — the arguments, the decision, the rule that fired, and the hash chain."

[Show: Click an audit entry → modal opens]

---

## [1:40] Live Demo — Agents

"Switching to the Agents page, you can see all the agents in our crew. Each agent has a role — admin, developer, reader, auditor. The role determines what tools they can call. This is enforced by policy, not by prompts."

[Show: Agents page, click an agent → detail modal]

---

## [2:00] Live Demo — Policy Enforcement

"Let me show you a policy violation. I'll send a request where a guest agent tries to read a file under the secrets directory."

[Show: curl POST /check with guest role + path *secrets*]

"Blocked. The policy engine evaluated the RBAC rule and denied the call. The audit log records the denial with the reason. The agent never sees the file."

"Now let me show you PII redaction. An agent sends an email containing a social security number."

[Show: curl POST /check with email.send + SSN in subject]

"Allowed — but the SSN is masked before the tool executes. The audit trail stores the redacted version, never the raw PII."

---

## [2:45] Automatic Tool Selection

"Here's a key innovation. AgentGuard doesn't just block calls — it hides disallowed tools from the LLM entirely. When the agent calls `listTools`, it only sees the tools its role is allowed to use. A guest agent never sees `delete_file`. A reader never sees `merge_pull_request`. This saves tokens and prevents the LLM from even attempting blocked operations."

---

## [3:10] Audit Chain Verification

"Every decision is written to a SHA-256 hash-chained audit log. Each entry includes the hash of the previous entry. If anyone tampers with the log, the chain breaks. Let me verify it."

[Show: Audit page → click Verify Chain]

"The chain is valid. This is your compliance evidence — a tamper-evident record of every decision your agents made."

---

## [3:30] Multi-Agent Crews

"AgentGuard supports multi-agent crews with the Volcano SDK's orchestration patterns. Sequential steps with `.then`, parallel batches with `.parallel`, conditional fallbacks with `.branch`, and loops with `.forEach`. Each agent in the crew gets its own role and policy scope."

---

## [3:50] Production Ready

"This is production ready. Multi-tenant isolation, hot-reloadable policies, OpenTelemetry traces, Slack alerting, SSRF protection, PII log redaction, Docker multi-arch builds with health checks. There's a CLI with a doctor command, audit export, and an MCP server mode so you can use AgentGuard as a tool in Claude Desktop."

---

## [4:15] Conclusion

"AgentGuard is the enforcement layer that AI agents need. Every tool call evaluated before execution. Every decision written to a tamper-evident audit log. Every agent scoped to its role. Built on the Volcano SDK, production ready, and open source."

---

## TTS Settings

- **Voice**: Natural, conversational (not robotic)
- **Pace**: Normal — not rushed, not slow
- **Tone**: Explaining something you built and are proud of
- **Pauses**: Brief pause at each section break `[--:--]`
- **Emphasis**: On key terms: "before it executes", "never", "tamper-evident", "policy"