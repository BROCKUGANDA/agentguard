"""
AgentGuard — Demo Video TTS Narration
Uses Microsoft Edge TTS (edge-tts) for natural-sounding voice at normal pace.
"""

import asyncio
import edge_tts
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "narration")
os.makedirs(OUTPUT_DIR, exist_ok=True)

VOICE = "en-US-AriaNeural"
RATE = "+0%"
VOLUME = "+0%"

SECTIONS = [
    ("01_introduction", (
        "AgentGuard is a multi-agent security orchestrator for AI workflows. "
        "It sits between your AI agents and the tools they call, "
        "evaluating every single tool call against policy before it executes. "
        "In this demo, I'll show you the whole process, step by step."
    )),
    ("02_problem", (
        "AI agents are autonomous now. They read files, send emails, query databases, "
        "even merge pull requests. A crew of five agents with access to twenty tools "
        "produces a hundred possible tool-call paths per step. "
        "One hallucinated delete, one prompt injection that sends PII, "
        "and you have a production incident. "
        "Logging tells you after the fact. Prompt engineering is bypassable. "
        "Sandboxing is all or nothing. There's no enforcement layer."
    )),
    ("03_architecture", (
        "Here's how AgentGuard works. "
        "Your agent is built with the Volcano SDK. "
        "You wrap its MCP tool handles with wrap M C P. "
        "Now, every tool call goes through the AgentGuard sidecar first. "
        "The sidecar evaluates the call against your policy. "
        "R BAC, rate limits, time windows, PII redaction. "
        "If allowed, the tool runs. If denied, the agent gets a blocked error "
        "and the tool never executes. "
        "Every decision is written to a SHA-256 hash-chained audit log "
        "and streamed live to the dashboard."
    )),
    ("04_dashboard", (
        "Let me show you the dashboard. "
        "Here on the home page, you can see real-time KPIs. "
        "Allowed calls, blocked calls, average latency. "
        "The live feed shows decisions as they happen. "
        "Each entry shows the agent, the tool, the decision, and the reason. "
        "Clicking on any entry opens a detail modal "
        "with the full audit record, the arguments, the decision, "
        "the rule that fired, and the hash chain."
    )),
    ("05_agents", (
        "Switching to the Agents page, "
        "you can see all the agents in our crew. "
        "Each agent has a role. Admin, developer, reader, auditor. "
        "The role determines what tools they can call. "
        "This is enforced by policy, not by prompts."
    )),
    ("06_policy_enforcement", (
        "Let me show you a policy violation. "
        "A guest agent tries to read a file under the secrets directory. "
        "Blocked. The policy engine evaluated the R BAC rule and denied the call. "
        "The audit log records the denial with the reason. "
        "The agent never sees the file. "
        "Now let me show you PII redaction. "
        "An agent sends an email containing a social security number. "
        "Allowed, but the SSN is masked before the tool executes. "
        "The audit trail stores the redacted version, never the raw PII."
    )),
    ("07_auto_tool_selection", (
        "Here's a key innovation. "
        "AgentGuard doesn't just block calls. "
        "It hides disallowed tools from the LLM entirely. "
        "When the agent calls list tools, "
        "it only sees the tools its role is allowed to use. "
        "A guest agent never sees delete file. "
        "A reader never sees merge pull request. "
        "This saves tokens and prevents the LLM from even attempting blocked operations."
    )),
    ("08_audit_chain", (
        "Every decision is written to a SHA-256 hash-chained audit log. "
        "Each entry includes the hash of the previous entry. "
        "If anyone tampers with the log, the chain breaks. "
        "Let me verify it. The chain is valid. "
        "This is your compliance evidence. "
        "A tamper-evident record of every decision your agents made."
    )),
    ("09_multi_agent_crews", (
        "AgentGuard supports multi-agent crews with the Volcano SDK's "
        "orchestration patterns. "
        "Sequential steps with dot then. "
        "Parallel batches with dot parallel. "
        "Conditional fallbacks with dot branch. "
        "And loops with dot for each. "
        "Each agent in the crew gets its own role and policy scope."
    )),
    ("10_production_ready", (
        "This is production ready. "
        "Multi-tenant isolation. Hot-reloadable policies. "
        "OpenTelemetry traces. Slack alerting. "
        "SSRF protection. PII log redaction. "
        "Docker multi-arch builds with health checks. "
        "There's a CLI with a doctor command, audit export, "
        "and an MCP server mode so you can use AgentGuard as a tool in Claude Desktop."
    )),
    ("11_conclusion", (
        "AgentGuard is the enforcement layer that AI agents need. "
        "Every tool call evaluated before execution. "
        "Every decision written to a tamper-evident audit log. "
        "Every agent scoped to its role. "
        "Built on the Volcano SDK, production ready, and open source."
    )),
]


async def generate_section(name: str, text: str) -> str:
    filepath = os.path.join(OUTPUT_DIR, f"{name}.mp3")
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, volume=VOLUME)
    await communicate.save(filepath)
    return filepath


async def main():
    print(f"Voice: {VOICE} | Rate: {RATE} | Output: {OUTPUT_DIR}")
    files = []
    for name, text in SECTIONS:
        print(f"  Generating {name}...")
        path = await generate_section(name, text)
        files.append(path)
        print(f"    -> {os.path.basename(path)}")

    combined = os.path.join(OUTPUT_DIR, "full_narration.mp3")
    with open(combined, "wb") as out:
        for f in files:
            with open(f, "rb") as inp:
                out.write(inp.read())
    print(f"\nFull narration: {combined}")
    print(f"Sections: {len(files)}")


if __name__ == "__main__":
    asyncio.run(main())