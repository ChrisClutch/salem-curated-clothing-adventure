#!/usr/bin/env python3
"""
fetch_images.py — Salem Thrift Trek image enrichment

Reads stores.json, tries to pull each store's og:image from their website.
Falls back to Lorem Picsum with a deterministic seed (so the same store always
gets the same fallback image — looks intentional, not random).

Run from your project root:
    python3 fetch_images.py

Outputs:
    stores.json              (rewritten with real image_url + image_source fields)
    stores.before.json       (backup of what you had)
    image_report.txt         (human-readable summary of what got found vs fallback)
"""

import json
import re
import sys
import time
import hashlib
import urllib.request
import urllib.parse
from html.parser import HTMLParser


STORES_FILE = "stores.json"
BACKUP_FILE = "stores.before.json"
REPORT_FILE = "image_report.txt"

# Browser-ish UA so sites don't block us as a bot
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

TIMEOUT = 8  # seconds per request


class OGImageParser(HTMLParser):
    """Pulls og:image, twitter:image, and the first <img src> as a last resort."""

    def __init__(self):
        super().__init__()
        self.og_image = None
        self.twitter_image = None
        self.first_img = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            prop = (attrs.get("property") or attrs.get("name") or "").lower()
            content = attrs.get("content")
            if not content:
                return
            if prop == "og:image" and not self.og_image:
                self.og_image = content
            elif prop in ("twitter:image", "twitter:image:src") and not self.twitter_image:
                self.twitter_image = content
        elif tag == "img" and not self.first_img:
            src = attrs.get("src")
            if src and not src.startswith("data:"):
                self.first_img = src


def absolutize(url, base):
    """Turn /path/foo.jpg into https://example.com/path/foo.jpg"""
    if not url:
        return None
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urllib.parse.urljoin(base, url)


def fetch_og_image(website_url):
    """Try to extract a real image URL from the store's website."""
    if not website_url:
        return None, "no_website"

    try:
        req = urllib.request.Request(website_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            # Read up to 200KB — og:image is usually in the first chunk of <head>
            raw = resp.read(200_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            html = raw.decode(charset, errors="replace")
            final_url = resp.url  # follows redirects
    except Exception as e:
        return None, f"fetch_error: {type(e).__name__}"

    parser = OGImageParser()
    try:
        parser.feed(html)
    except Exception as e:
        return None, f"parse_error: {type(e).__name__}"

    # Prefer og:image, then twitter:image, then first <img>
    for candidate in (parser.og_image, parser.twitter_image, parser.first_img):
        if candidate:
            absolute = absolutize(candidate, final_url)
            if absolute and is_plausible_image(absolute):
                return absolute, "og_image" if candidate == parser.og_image else (
                    "twitter_image" if candidate == parser.twitter_image else "first_img"
                )

    return None, "no_og_image_found"


def is_plausible_image(url):
    """Basic sanity check — avoid tiny tracking pixels, data URIs, etc."""
    if not url or len(url) > 2000:
        return False
    lower = url.lower()
    # Skip obvious tracking pixels and tiny icons
    bad_patterns = ["pixel.gif", "1x1", "spacer", "tracking", "/favicon."]
    if any(p in lower for p in bad_patterns):
        return False
    return True


def picsum_fallback(store):
    """
    Deterministic Picsum URL — same store always gets the same image.
    Uses a hash of name+address as the seed so it survives reordering.
    """
    seed_input = f"{store.get('name', '')}|{store.get('address', '')}"
    seed = hashlib.md5(seed_input.encode("utf-8")).hexdigest()[:12]
    return f"https://picsum.photos/seed/{seed}/800/450"


def main():
    # Load
    try:
        with open(STORES_FILE, "r", encoding="utf-8") as f:
            stores = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {STORES_FILE} not found. Run this from your project folder.")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: {STORES_FILE} is not valid JSON: {e}")
        sys.exit(1)

    # Backup
    with open(BACKUP_FILE, "w", encoding="utf-8") as f:
        json.dump(stores, f, indent=2)
    print(f"Backed up original to {BACKUP_FILE}")
    print(f"Processing {len(stores)} stores...\n")

    report_lines = []
    counts = {"og_image": 0, "twitter_image": 0, "first_img": 0, "picsum_fallback": 0}

    for i, store in enumerate(stores, 1):
        name = store.get("name", "Unknown")
        website = store.get("website", "").strip()

        print(f"[{i:2}/{len(stores)}] {name}")

        image_url, source = fetch_og_image(website) if website else (None, "no_website")

        if not image_url:
            image_url = picsum_fallback(store)
            source = "picsum_fallback"

        store["image"] = image_url
        store["image_source"] = source

        counts[source] = counts.get(source, 0) + 1
        report_lines.append(f"{name}\n  source: {source}\n  url:    {image_url}\n")

        # Be polite — don't hammer servers
        if website:
            time.sleep(0.5)

    # Write updated stores.json
    with open(STORES_FILE, "w", encoding="utf-8") as f:
        json.dump(stores, f, indent=2)

    # Write report
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        f.write("Salem Thrift Trek — Image Enrichment Report\n")
        f.write("=" * 50 + "\n\n")
        f.write("Summary:\n")
        for src, count in counts.items():
            f.write(f"  {src}: {count}\n")
        f.write(f"  TOTAL: {len(stores)}\n\n")
        f.write("Details:\n")
        f.write("-" * 50 + "\n")
        f.writelines(report_lines)

    print("\n" + "=" * 50)
    print("Done. Summary:")
    for src, count in counts.items():
        print(f"  {src}: {count}")
    print(f"\nFull report: {REPORT_FILE}")
    print(f"Next: review {REPORT_FILE}, then commit + deploy.")


if __name__ == "__main__":
    main()
