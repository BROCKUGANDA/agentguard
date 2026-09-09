"""Probe every dashboard page for console errors, failed requests, and blank UI."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

DASH = "http://127.0.0.1:5173"
OUT = Path(__file__).resolve().parent.parent / ".demo_build"
OUT.mkdir(parents=True, exist_ok=True)

ROUTES = ["/", "/agents", "/policies", "/audit", "/alerts", "/settings"]


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await ctx.new_page()
        errors = []
        failed = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("response", lambda r: failed.append(f"{r.status} {r.url}") if r.status >= 400 else None)

        await page.goto(DASH, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1500)

        report = []
        for route in ROUTES:
            errors.clear()
            failed.clear()
            await page.goto(DASH + route if route != "/" else DASH, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(1200)
            shot = OUT / f"probe_{route.strip('/').replace('/', '_') or 'home'}.png"
            await page.screenshot(path=str(shot), full_page=False)
            body = await page.inner_text("body")
            has_content = len(body.strip()) > 40
            # try interact
            interact = "ok"
            try:
                if route == "/":
                    els = await page.query_selector_all("li.cursor-pointer, .cursor-pointer")
                    if els:
                        await els[0].click(timeout=1500)
                        await page.wait_for_timeout(500)
                        await page.keyboard.press("Escape")
                if route == "/agents":
                    cards = await page.query_selector_all("button")
                    if cards:
                        await cards[1].click(timeout=1500) if len(cards) > 1 else await cards[0].click()
                        await page.wait_for_timeout(500)
                        await page.keyboard.press("Escape")
                if route == "/audit":
                    btns = await page.query_selector_all("button")
                    for b in btns:
                        t = (await b.text_content()) or ""
                        if "verify" in t.lower():
                            await b.click(timeout=2000)
                            await page.wait_for_timeout(1500)
                            break
            except Exception as e:
                interact = f"FAIL: {e}"
            report.append(
                {
                    "route": route,
                    "has_content": has_content,
                    "body_len": len(body),
                    "body_head": body[:120].replace("\n", " | "),
                    "errors": list(errors),
                    "failed_requests": list(failed),
                    "interact": interact,
                    "screenshot": str(shot),
                }
            )
            print(f"\n=== {route} === content={has_content} interact={interact}")
            for e in errors[:8]:
                print("  ERR", e[:200])
            for f in failed[:8]:
                print("  HTTP", f)

        await browser.close()
        (OUT / "page_probe_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nWrote {OUT / 'page_probe_report.json'}")


if __name__ == "__main__":
    asyncio.run(main())
