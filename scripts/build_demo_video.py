"""
AgentGuard — Frame-by-frame demo video builder.

Pipeline:
  1. Generate natural Edge TTS narration per section (AriaNeural).
  2. Probe each section duration with ffprobe.
  3. Drive the dashboard with Playwright, capturing a full-res screenshot
     at a fixed FPS for the exact duration of the current section.
  4. Concatenate frames → H.264 video, mux with the stitched narration.

Requires: sidecar on :9559 and dashboard on :5173 already running,
plus seeded /check traffic so the UI shows live decisions.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NARRATION_DIR = ROOT / "docs" / "narration"
FRAMES_DIR = ROOT / "demo_frames"
OUTPUT = ROOT / "demo_video.mp4"
TMP_DIR = ROOT / ".demo_build"

FPS = 24
VIEWPORT = {"width": 1280, "height": 720}
DASHBOARD = os.environ.get("AGENTGUARD_DASHBOARD", "http://localhost:5173")
SIDECAR = os.environ.get("AGENTGUARD_SIDECAR", "http://localhost:9559")

# Natural neural voice (slightly slower for clarity on technical content).
VOICE = "en-US-AriaNeural"
RATE = "-4%"
PITCH = "+0Hz"

SECTIONS: list[tuple[str, str]] = [
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
        "R BAC, rate limits, time windows, P I I redaction. "
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
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(path),
    ]
    out = subprocess.check_output(cmd, text=True)
    return float(json.loads(out)["format"]["duration"])


async def generate_tts() -> list[tuple[Path, float]]:
    import edge_tts

    NARRATION_DIR.mkdir(parents=True, exist_ok=True)
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
    # Re-encode stitch so timestamps are reliable (raw concat of MP3s drifts).
    list_file = TMP_DIR / "concat_audio.txt"
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    list_file.write_text(
        "".join(f"file '{p.as_posix()}'\n" for p in parts),
        encoding="utf-8",
    )
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(stitched),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    total = ffprobe_duration(stitched)
    log(f"  Stitched narration: {stitched} ({total:.2f}s)")
    return sections


async def sleep_until(start: float, target: float) -> None:
    delay = target - (time.time() - start)
    if delay > 0:
        await asyncio.sleep(delay)


async def click_if_exists(page, selector: str) -> bool:
    el = await page.query_selector(selector)
    if el:
        await el.click()
        return True
    return False


async def click_by_text(page, needle: str) -> bool:
    buttons = await page.query_selector_all("button, a")
    for b in buttons:
        text = (await b.text_content()) or ""
        if needle.lower() in text.lower():
            await b.click()
            return True
    return False


async def seed_traffic() -> None:
    """Fire /check requests so the dashboard has live-looking data."""
    import urllib.request

    samples = [
        ("demo-agent", "developer", "filesystem.read_file", {"path": "/srv/data/report.csv"}, True),
        ("researcher", "reader", "filesystem.read_file", {"path": "/secrets/api-key"}, False),
        ("guest-bot", "guest", "filesystem.read_file", {"path": "/secrets/api-key"}, False),
        ("demo-agent", "developer", "email.send", {"to": "hr@x.com", "subject": "SSN 123-45-6789 attached", "body": "please review"}, True),
        ("writer", "developer", "filesystem.write_file", {"path": "/srv/data/draft.md", "content": "# Draft"}, True),
        ("researcher", "reader", "filesystem.delete_file", {"path": "/srv/prod/db.sqlite"}, False),
        ("demo-agent", "developer", "github.merge_pull_request", {"repo": "acme/app", "pr": 42}, True),
        ("guest-bot", "guest", "filesystem.delete_file", {"path": "/tmp/x"}, False),
        ("auditor", "reader", "filesystem.read_file", {"path": "/audit/export.csv"}, True),
        ("demo-agent", "developer", "email.send", {"to": "partner@acme.io", "subject": "Invoice 4242-4242-4242-4242", "body": "cc"}, True),
    ]
    for agent, role, tool, args, _allow in samples:
        for _ in range(4):
            body = json.dumps(
                {"agentId": agent, "role": role, "tool": tool, "args": args}
            ).encode()
            req = urllib.request.Request(
                f"{SIDECAR}/check",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Tenant-Id": "default",
                },
                method="POST",
            )
            try:
                urllib.request.urlopen(req, timeout=2)
            except Exception:
                pass
            time.sleep(0.05)
    log(f"  Seeded traffic against {SIDECAR}")


async def capture_section(page, section_idx: int, duration: float, frame_dir: Path) -> None:
    """Screenshot at FPS for `duration` seconds into frame_dir."""
    frame_dir.mkdir(parents=True, exist_ok=True)
    total_frames = max(1, int(math.ceil(duration * FPS)))
    for i in range(total_frames):
        path = frame_dir / f"frame_{i:05d}.png"
        await page.screenshot(path=str(path), type="png")
        # Pace slightly under frame interval so we never lag the wall clock
        # by more than one frame; sleep_until corrects the rest.
        await asyncio.sleep(max(0.001, (1.0 / FPS) * 0.35))


async def run_dashboard_sequence(page, sections: list[tuple[Path, float]]) -> None:
    """Walk the dashboard in lockstep with narration sections."""
    log(f"Opening {DASHBOARD} …")
    await page.goto(DASHBOARD, wait_until="networkidle", timeout=60000)
    await page.wait_for_timeout(2500)

    # Section-driven actions (index-aligned with SECTIONS).
    async def act(idx: int) -> None:
        if idx == 0:
            # Home: hover KPI area slightly
            await page.wait_for_timeout(400)
        elif idx == 3:
            # Dashboard: open first live-feed entry if present
            entries = await page.query_selector_all(".cursor-pointer")
            if entries:
                try:
                    await entries[0].click()
                    await page.wait_for_timeout(900)
                except Exception:
                    pass
        elif idx == 4:
            await page.keyboard.press("Escape")
            await click_if_exists(page, 'a[href="/agents"]')
            await page.wait_for_timeout(800)
            cards = await page.query_selector_all(".cursor-pointer")
            if len(cards) > 1:
                try:
                    await cards[1].click()
                    await page.wait_for_timeout(700)
                except Exception:
                    pass
        elif idx == 5:
            await page.keyboard.press("Escape")
            await click_if_exists(page, 'a[href="/audit"]')
            await page.wait_for_timeout(800)
        elif idx == 6:
            await click_if_exists(page, 'a[href="/policies"]')
            await page.wait_for_timeout(600)
        elif idx == 7:
            await click_if_exists(page, 'a[href="/audit"]')
            await page.wait_for_timeout(600)
            await click_by_text(page, "verify")
            await page.wait_for_timeout(900)
        elif idx == 8:
            await click_if_exists(page, 'a[href="/"]')
            await page.wait_for_timeout(500)
        elif idx == 9:
            await click_if_exists(page, 'a[href="/settings"]')
            await page.wait_for_timeout(500)
        elif idx == 10:
            await click_if_exists(page, 'a[href="/"]')
            await page.wait_for_timeout(400)

    # Pre-seed frame dirs
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True)

    for idx, (path, dur) in enumerate(sections):
        log(f"Section {idx + 1}/{len(sections)}: {path.name} ({dur:.2f}s)")
        await act(idx)
        section_frames = FRAMES_DIR / f"{idx:02d}_{path.stem}"
        await capture_section(page, idx, dur, section_frames)
        log(f"  captured → {section_frames}")

    # Small hold at the end so the last sentence doesn't cut hard.
    end_frames = FRAMES_DIR / "99_hold"
    await capture_section(page, len(sections), 1.2, end_frames)


def encode_video(sections: list[tuple[Path, float]]) -> None:
    """Build a single image sequence stream from all section frame dirs."""
    # Flatten frames into one directory with sequential names.
    flat = TMP_DIR / "frames_flat"
    if flat.exists():
        shutil.rmtree(flat)
    flat.mkdir(parents=True)

    n = 0
    for d in sorted(FRAMES_DIR.iterdir()):
        if not d.is_dir():
            continue
        for f in sorted(d.glob("frame_*.png")):
            dst = flat / f"f_{n:06d}.png"
            shutil.copy2(f, dst)
            n += 1
    log(f"  Flat frames: {n}")

    # Create a video from the image sequence, then mux audio.
    video_only = TMP_DIR / "video_only.mp4"
    # Use a concat demuxer with per-frame duration so we stay sample-accurate
    # even if a section captured slightly off-frame counts.
    concat = TMP_DIR / "frames_concat.txt"
    lines = []
    idx = 0
    hold_dur = 1.2
    for i, (path, dur) in enumerate(sections):
        section_dir = FRAMES_DIR / f"{i:02d}_{path.stem}"
        frames = sorted(section_dir.glob("frame_*.png"))
        per = dur / max(1, len(frames))
        for f in frames:
            lines.append(f"file '{f.as_posix()}'")
            lines.append(f"duration {per:.6f}")
            idx += 1
    hold_dir = FRAMES_DIR / "99_hold"
    if hold_dir.exists():
        for f in sorted(hold_dir.glob("frame_*.png")):
            lines.append(f"file '{f.as_posix()}'")
            lines.append(f"duration {hold_dur / max(1, len(list(hold_dir.glob('frame_*.png')))):.6f}")
    # Repeat last frame (ffmpeg concat quirk)
    if lines:
        last = [ln for ln in lines if ln.startswith("file ")][-1]
        lines.append(last)
    concat.write_text("\n".join(lines) + "\n", encoding="utf-8")

    log("Encoding H.264 from frame sequence …")
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat),
            "-vsync",
            "vfr",
            "-r",
            str(FPS),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            str(video_only),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    narration = NARRATION_DIR / "full_narration.mp3"
    log("Muxing narration …")
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_only),
            "-i",
            str(narration),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(OUTPUT),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    dur = ffprobe_duration(OUTPUT)
    log(f"Done: {OUTPUT} ({size_mb:.1f} MB, {dur:.1f}s)")


async def main() -> int:
    # Optional force-regenerate TTS
    force = "--force-tts" in sys.argv
    skip_tts = "--skip-tts" in sys.argv
    skip_capture = "--encode-only" in sys.argv

    TMP_DIR.mkdir(parents=True, exist_ok=True)

    if skip_capture:
        # Recover durations from existing mp3s
        sections = []
        for name, _ in SECTIONS:
            p = NARRATION_DIR / f"{name}.mp3"
            sections.append((p, ffprobe_duration(p)))
        encode_video(sections)
        return 0

    log("Checking dashboard …")
    try:
        import urllib.request

        urllib.request.urlopen(f"{SIDECAR}/health", timeout=3)
        urllib.request.urlopen(DASHBOARD, timeout=3)
    except Exception as e:
        log(f"ERROR: sidecar/dashboard not reachable: {e}")
        log("Start them first, e.g.:")
        log("  npx tsx packages/sidecar/src/server.ts")
        log("  npx vite --config packages/dashboard/vite.config.ts")
        return 1

    log("Seeding demo traffic …")
    await seed_traffic()

    if not skip_tts or force or not (NARRATION_DIR / "full_narration.mp3").exists():
        log("Generating TTS narration …")
        sections = await generate_tts()
    else:
        log("Reusing existing narration …")
        sections = []
        for name, _ in SECTIONS:
            p = NARRATION_DIR / f"{name}.mp3"
            sections.append((p, ffprobe_duration(p)))

    log("Capturing dashboard frames …")
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=1,
        )
        page = await context.new_page()
        await run_dashboard_sequence(page, sections)
        await browser.close()

    log("Encoding final video …")
    encode_video(sections)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
