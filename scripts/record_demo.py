"""
AgentGuard demo video recorder — Playwright webm capture + Edge TTS mux.

Faster than PNG frame dumps: Chromium records the dashboard while we
navigate in lockstep with narration section durations, then ffmpeg
muxes the natural Edge TTS audio.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NARRATION_DIR = ROOT / "docs" / "narration"
VIDEO_DIR = ROOT / "demo_video_raw"
OUTPUT = ROOT / "demo_video.mp4"
TMP = ROOT / ".demo_build"

FPS = 24
VIEWPORT = {"width": 1280, "height": 720}
DASHBOARD = os.environ.get("AGENTGUARD_DASHBOARD", "http://127.0.0.1:5173")
SIDECAR = os.environ.get("AGENTGUARD_SIDECAR", "http://127.0.0.1:9559")

VOICE = "en-US-AriaNeural"
RATE = "-4%"
PITCH = "+0Hz"

SECTIONS = [
    (
        "01_introduction",
        "AgentGuard is a multi-agent security orchestrator for AI workflows. "
        "It sits between your AI agents and the tools they call, "
        "evaluating every single tool call against policy before it executes. "
        "In this demo, I will show you the whole process, step by step.",
    ),
    (
        "02_problem",
        "AI agents are autonomous now. They read files, send emails, query databases, "
        "even merge pull requests. A crew of five agents with access to twenty tools "
        "produces a hundred possible tool-call paths per step. "
        "One hallucinated delete, one prompt injection that sends PII, "
        "and you have a production incident. "
        "Logging tells you after the fact. Prompt engineering is bypassable. "
        "Sandboxing is all or nothing. There is no enforcement layer.",
    ),
    (
        "03_architecture",
        "Here is how AgentGuard works. "
        "Your agent is built with the Volcano SDK. "
        "You wrap its MCP tool handles with wrap M C P. "
        "Now, every tool call goes through the AgentGuard sidecar first. "
        "The sidecar evaluates the call against your policy. "
        "R B A C, rate limits, time windows, P I I redaction. "
        "If allowed, the tool runs. If denied, the agent gets a blocked error "
        "and the tool never executes. "
        "Every decision is written to a S H A two fifty six hash-chained audit log "
        "and streamed live to the dashboard.",
    ),
    (
        "04_dashboard",
        "Let me show you the dashboard. "
        "Here on the home page, you can see real-time K P Is. "
        "Allowed calls, blocked calls, average latency. "
        "The live feed shows decisions as they happen. "
        "Each entry shows the agent, the tool, the decision, and the reason. "
        "Clicking on any entry opens a detail modal "
        "with the full audit record, the arguments, the decision, "
        "the rule that fired, and the hash chain.",
    ),
    (
        "05_agents",
        "Switching to the Agents page, "
        "you can see all the agents in our crew. "
        "Each agent has a role. Admin, developer, reader, auditor. "
        "The role determines what tools they can call. "
        "This is enforced by policy, not by prompts.",
    ),
    (
        "06_policy_enforcement",
        "Let me show you a policy violation. "
        "A guest agent tries to read a file under the secrets directory. "
        "Blocked. The policy engine evaluated the R B A C rule and denied the call. "
        "The audit log records the denial with the reason. "
        "The agent never sees the file. "
        "Now let me show you P I I redaction. "
        "An agent sends an email containing a social security number. "
        "Allowed, but the S S N is masked before the tool executes. "
        "The audit trail stores the redacted version, never the raw P I I.",
    ),
    (
        "07_auto_tool_selection",
        "Here is a key innovation. "
        "AgentGuard does not just block calls. "
        "It hides disallowed tools from the L L M entirely. "
        "When the agent lists tools, "
        "it only sees the tools its role is allowed to use. "
        "A guest agent never sees delete file. "
        "A reader never sees merge pull request. "
        "This saves tokens and prevents the L L M from even attempting blocked operations.",
    ),
    (
        "08_audit_chain",
        "Every decision is written to a S H A two fifty six hash-chained audit log. "
        "Each entry includes the hash of the previous entry. "
        "If anyone tampers with the log, the chain breaks. "
        "Let me verify it. The chain is valid. "
        "This is your compliance evidence. "
        "A tamper-evident record of every decision your agents made.",
    ),
    (
        "09_multi_agent_crews",
        "AgentGuard supports multi-agent crews with the Volcano S D K "
        "orchestration patterns. "
        "Sequential steps. Parallel batches. Conditional fallbacks. And loops. "
        "Each agent in the crew gets its own role and policy scope.",
    ),
    (
        "10_production_ready",
        "This is production ready. "
        "Multi-tenant isolation. Hot-reloadable policies. "
        "OpenTelemetry traces. Slack alerting. "
        "S S R F protection. P I I log redaction. "
        "Docker multi-arch builds with health checks. "
        "There is a C L I with a doctor command, audit export, "
        "and an M C P server mode so you can use AgentGuard as a tool in Claude Desktop.",
    ),
    (
        "11_conclusion",
        "AgentGuard is the enforcement layer that AI agents need. "
        "Every tool call evaluated before execution. "
        "Every decision written to a tamper-evident audit log. "
        "Every agent scoped to its role. "
        "Built on the Volcano SDK, production ready, and open source.",
    ),
]


def log(msg: str) -> None:
    print(msg, flush=True)


def ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        text=True,
    )
    return float(json.loads(out)["format"]["duration"])


async def generate_tts() -> list[tuple[Path, float]]:
    import edge_tts

    NARRATION_DIR.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    sections: list[tuple[Path, float]] = []
    parts: list[Path] = []
    for name, text in SECTIONS:
        path = NARRATION_DIR / f"{name}.mp3"
        log(f"  TTS {name} …")
        comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await comm.save(str(path))
        dur = ffprobe_duration(path)
        sections.append((path, dur))
        parts.append(path)
        log(f"    {dur:.2f}s")

    stitched = NARRATION_DIR / "full_narration.mp3"
    list_file = TMP / "concat_audio.txt"
    list_file.write_text(
        "".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8"
    )
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_file),
            "-c:a", "libmp3lame", "-b:a", "192k",
            str(stitched),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log(f"  Narration total: {ffprobe_duration(stitched):.2f}s")
    return sections


def seed_traffic() -> None:
    samples = [
        ("demo-agent", "developer", "filesystem.read_file", {"path": "/srv/data/report.csv"}),
        ("researcher", "reader", "filesystem.read_file", {"path": "/secrets/api-key"}),
        ("guest-bot", "guest", "filesystem.read_file", {"path": "/secrets/api-key"}),
        ("demo-agent", "developer", "email.send", {"to": "hr@x.com", "subject": "SSN 123-45-6789 attached", "body": "please review"}),
        ("writer", "developer", "filesystem.write_file", {"path": "/srv/data/draft.md", "content": "# Draft"}),
        ("researcher", "reader", "filesystem.delete_file", {"path": "/srv/prod/db.sqlite"}),
        ("demo-agent", "developer", "github.merge_pull_request", {"repo": "acme/app", "pr": 42}),
        ("guest-bot", "guest", "filesystem.delete_file", {"path": "/tmp/x"}),
        ("auditor", "reader", "filesystem.read_file", {"path": "/audit/export.csv"}),
        ("demo-agent", "developer", "email.send", {"to": "partner@acme.io", "subject": "Invoice 4242-4242-4242-4242", "body": "cc"}),
    ]
    for agent, role, tool, args in samples:
        for _ in range(5):
            body = json.dumps({"agentId": agent, "role": role, "tool": tool, "args": args}).encode()
            req = urllib.request.Request(
                f"{SIDECAR}/check",
                data=body,
                headers={"Content-Type": "application/json", "X-Tenant-Id": "default"},
                method="POST",
            )
            try:
                urllib.request.urlopen(req, timeout=2)
            except Exception:
                pass
            time.sleep(0.03)
    log(f"  Seeded traffic → {SIDECAR}")


async def sleep_until(start: float, target: float) -> None:
    delay = target - (time.time() - start)
    if delay > 0:
        await asyncio.sleep(delay)


async def click_if_exists(page, selector: str) -> bool:
    el = await page.query_selector(selector)
    if el:
        try:
            await el.click(timeout=2000)
            return True
        except Exception:
            return False
    return False


async def click_by_text(page, needle: str) -> bool:
    for b in await page.query_selector_all("button, a"):
        text = (await b.text_content()) or ""
        if needle.lower() in text.lower():
            try:
                await b.click(timeout=2000)
                return True
            except Exception:
                return False
    return False


async def act_for_section(page, idx: int) -> None:
    """Navigate the dashboard for narration section `idx` (0-based)."""
    if idx == 3:
        # Dashboard: open first live-feed row modal
        entries = await page.query_selector_all("li.cursor-pointer")
        if not entries:
            entries = await page.query_selector_all(".cursor-pointer")
        if entries:
            try:
                await entries[0].click(timeout=2500)
                await asyncio.sleep(1.4)
            except Exception:
                pass
    elif idx == 4:
        # Agents
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.3)
        await click_if_exists(page, 'nav a[href="/agents"]')
        await page.wait_for_timeout(1200)
        # Open an agent detail card (button wrappers around cards)
        cards = await page.query_selector_all("main button.cursor-pointer, main button")
        for c in cards[1:3] if len(cards) > 1 else cards:
            try:
                await c.click(timeout=1500)
                await asyncio.sleep(0.8)
                break
            except Exception:
                continue
    elif idx == 5:
        # Audit list
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.3)
        await click_if_exists(page, 'nav a[href="/audit"]')
        await page.wait_for_timeout(1200)
    elif idx == 6:
        # Policies
        await click_if_exists(page, 'nav a[href="/policies"]')
        await page.wait_for_timeout(1000)
    elif idx == 7:
        # Back to Audit + Verify chain
        await click_if_exists(page, 'nav a[href="/audit"]')
        await page.wait_for_timeout(900)
        await click_by_text(page, "Verify chain")
        await page.wait_for_timeout(1600)
    elif idx == 8:
        # Agents again for multi-agent narration
        await click_if_exists(page, 'nav a[href="/agents"]')
        await page.wait_for_timeout(900)
    elif idx == 9:
        # Alerts (production / alerting story)
        await click_if_exists(page, 'nav a[href="/alerts"]')
        await page.wait_for_timeout(900)
    elif idx == 10:
        # Settings then home for the close
        await click_if_exists(page, 'nav a[href="/settings"]')
        await page.wait_for_timeout(900)
        await click_if_exists(page, 'nav a[href="/"]')
        await page.wait_for_timeout(600)


async def record(sections: list[tuple[Path, float]]) -> Path:
    from playwright.async_api import async_playwright

    if VIDEO_DIR.exists():
        shutil.rmtree(VIDEO_DIR)
    VIDEO_DIR.mkdir(parents=True)

    log("Recording dashboard walkthrough …")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            record_video_dir=str(VIDEO_DIR),
            record_video_size=VIEWPORT,
        )
        page = await context.new_page()
        await page.goto(DASHBOARD, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)

        start = time.time()
        for idx, (_path, dur) in enumerate(sections):
            log(f"  section {idx + 1}/{len(sections)} @ {dur:.1f}s")
            await act_for_section(page, idx)
            # Hold the visual for the full narration duration of this section.
            target = sum(d for _, d in sections[: idx + 1])
            await sleep_until(start, target)
        # Final hold
        await asyncio.sleep(1.0)
        await page.close()
        await context.close()
        await browser.close()

    webms = list(VIDEO_DIR.glob("*.webm"))
    if not webms:
        raise RuntimeError("No webm produced by Playwright")
    log(f"  Raw video: {webms[0]}")
    return webms[0]


def mux(webm: Path) -> None:
    narration = NARRATION_DIR / "full_narration.mp3"
    log("Muxing H.264 + AAC …")
    subprocess.check_call(
        [
            "ffmpeg", "-y",
            "-i", str(webm),
            "-i", str(narration),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-r", str(FPS),
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            str(OUTPUT),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    dur = ffprobe_duration(OUTPUT)
    log(f"Done: {OUTPUT} ({size_mb:.1f} MB, {dur:.1f}s)")


async def main() -> int:
    force = "--force-tts" in sys.argv
    skip_tts = "--skip-tts" in sys.argv

    # Health checks
    try:
        urllib.request.urlopen(f"{SIDECAR}/health", timeout=3)
        urllib.request.urlopen(DASHBOARD, timeout=3)
    except Exception as e:
        log(f"ERROR: servers not ready: {e}")
        return 1

    seed_traffic()

    if force or not skip_tts or not (NARRATION_DIR / "full_narration.mp3").exists():
        if not skip_tts or force:
            sections = await generate_tts()
        else:
            sections = [(NARRATION_DIR / f"{n}.mp3", ffprobe_duration(NARRATION_DIR / f"{n}.mp3")) for n, _ in SECTIONS]
    else:
        sections = [
            (NARRATION_DIR / f"{n}.mp3", ffprobe_duration(NARRATION_DIR / f"{n}.mp3"))
            for n, _ in SECTIONS
        ]

    webm = await record(sections)
    mux(webm)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
