"""Rasterizes dist/hf-dataset/charts/*.html to PNG (the <svg> only, 2x) for the dataset card.

Usage: python scripts/rasterize-charts.py [charts-dir]
Needs: pip install playwright, plus Google Chrome installed
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

charts = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/hf-dataset/charts")

with sync_playwright() as p:
    # The installed Chrome, so no separate `playwright install chromium` download is needed.
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(device_scale_factor=2, viewport={"width": 1280, "height": 900})
    for src in sorted(charts.glob("*.html")):
        page.goto(src.resolve().as_uri())
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        out = src.with_suffix(".png")
        page.locator("svg").first.screenshot(path=str(out), omit_background=True)
        print(f"Wrote {out}")
    browser.close()
