"""Screenshot the popup preview with Playwright.

    python3 preview/shot.py                 # writes preview/dark.png, light.png, setup.png
    python3 preview/shot.py --cover         # also composes cover.png for the README
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
URL = HERE.joinpath("preview.html").as_uri()

SHOTS = {
    "dark": "",
    "light": "?theme=light",
    "setup": "?state=setup",
    "empty": "?state=empty",
    "past": "?past=true&days=1",
    "live": "?now=1792343400000",       # 10:10 AM — lecture in progress
    "afternoon": "?now=1792359900000",  # 2:45 PM — three events done, sync in 15 min
}

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(device_scale_factor=2, timezone_id="America/Los_Angeles",
                                  viewport={"width": 420, "height": 700})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        for name, q in SHOTS.items():
            page.goto(URL + q)
            page.wait_for_selector("html[data-ready]", timeout=10000)
            page.wait_for_timeout(100)
            panel = page.locator("#calpeek-panel")
            panel.screenshot(path=str(HERE / f"{name}.png"), omit_background=True)
            print("wrote", name + ".png")
        # Gmail popup, both themes.
        gmail = HERE.joinpath("preview-gmail.html").as_uri()
        for name, q in {"gmail-dark": "", "gmail-light": "?theme=light"}.items():
            page.goto(gmail + q)
            page.wait_for_selector("html[data-ready]", timeout=10000)
            page.wait_for_timeout(100)
            page.locator("#gmailpeek-panel").screenshot(path=str(HERE / f"{name}.png"), omit_background=True)
            print("wrote", name + ".png")
        # README hero: the live state on a 1200×630 canvas.
        page.set_viewport_size({"width": 1200, "height": 630})
        page.goto(URL + "?cover=1&now=1792343100000")
        page.wait_for_selector("html[data-ready]", timeout=10000)
        page.wait_for_timeout(150)
        page.screenshot(path=str(ROOT / "cover.png"), full_page=False)
        print("wrote cover.png")
        browser.close()
        if errors:
            print("page errors:", *errors, sep="\n  ")
            sys.exit(1)

if __name__ == "__main__":
    main()
