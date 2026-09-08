#!/usr/bin/env python3
"""
Space-Marine IMPA catalog scraper → TVC compact store schema.

Dependencies:
    pip install requests beautifulsoup4

Examples:
    python scripts/scrape_spacemarine.py --category 75
    python scripts/scrape_spacemarine.py --category 81 --limit 30
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data" / "chapters"

BASE = "http://www.space-marine.com/pricelist"
LIST_URL = BASE + "/index.cfm"
DETAIL_URL = BASE + "/information.cfm"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 TVC-SpaceMarine-Scraper/1.0"
)
PAGE_SIZE = 30
DEFAULT_DELAY = 0.3

HANGUL_RE = re.compile(r"[\u3131-\uD79D]+")
CODE_RE = re.compile(r"information\.cfm\?code=(\d{6})&category=(\d+)")
IMPA_CODE_RE = re.compile(r"^\d{6}$")

UNIT_ALIASES = {
    "PC": "PCS",
    "PCS": "PCS",
    "EA": "PCS",
    "EACH": "PCS",
    "SET": "SET",
    "ROL": "ROL",
    "ROLL": "ROL",
    "BOX": "BOX",
    "MTR": "MTR",
    "METER": "MTR",
    "SHT": "SHT",
    "SHEET": "SHT",
    "KG": "KG",
    "LTR": "LTR",
    "L": "LTR",
}


def normalize_unit(raw: str) -> str:
    token = re.sub(r"[^A-Za-z]", "", str(raw or "").strip()).upper()
    return UNIT_ALIASES.get(token, token or "PCS")


def clean_english_name(text: str) -> str:
    """Remove Hangul fragments and tidy whitespace/punctuation."""
    s = str(text or "")
    s = HANGUL_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    return s


def extract_plate_filename(soup: BeautifulSoup) -> str:
    for img in soup.find_all("img"):
        src = (img.get("src") or "").strip()
        if not src or "photo" not in src.lower():
            continue
        name = urlparse(src).path.rsplit("/", 1)[-1]
        if name:
            return name
    return ""


def parse_detail_fields(soup: BeautifulSoup) -> dict[str, str]:
    fields: dict[str, str] = {}
    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if not cells:
            continue
        i = 0
        while i < len(cells) - 1:
            label = cells[i].upper()
            value = cells[i + 1]
            if "CODE NO" in label:
                fields["code"] = value
            elif label == "UNIT":
                fields["unit"] = value
            elif "ENGLISH DESCRIPTION" in label:
                fields["english"] = value
            elif "KOREAN DESCRIPTION" in label:
                fields["korean"] = value
            i += 2
    return fields


def parse_list_codes(html: str, category: str) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for code, cat in CODE_RE.findall(html):
        if cat != category:
            continue
        if code in seen:
            continue
        seen.add(code)
        ordered.append(code)
    return ordered


class SpaceMarineScraper:
    def __init__(self, category: str, delay: float = DEFAULT_DELAY) -> None:
        self.category = str(category).zfill(2) if len(str(category)) == 1 else str(category)
        self.delay = max(0.0, float(delay))
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})

    def _sleep(self) -> None:
        if self.delay:
            time.sleep(self.delay)

    def _get(self, url: str, params: dict[str, Any]) -> str:
        self._sleep()
        resp = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "euc-kr"
        return resp.text

    def fetch_list_page(self, start_no: int) -> list[str]:
        html = self._get(
            LIST_URL,
            {"category": self.category, "start_no": max(1, start_no)},
        )
        if "Error Occurred While Processing Request" in html and "STARTROW" in html:
            raise RuntimeError(
                f"Space-Marine list error at start_no={start_no} "
                "(start_no must be >= 1)"
            )
        return parse_list_codes(html, self.category)

    def iter_codes(self, limit: int | None = None) -> list[str]:
        codes: list[str] = []
        start_no = 1
        while True:
            page_codes = self.fetch_list_page(start_no)
            if not page_codes:
                break
            for code in page_codes:
                if code not in codes:
                    codes.append(code)
                if limit and len(codes) >= limit:
                    return codes[:limit]
            if len(page_codes) < PAGE_SIZE:
                break
            start_no += PAGE_SIZE
        return codes

    def fetch_item(self, code: str) -> dict[str, str] | None:
        html = self._get(
            DETAIL_URL,
            {"code": code, "category": self.category},
        )
        soup = BeautifulSoup(html, "html.parser")
        fields = parse_detail_fields(soup)
        impa_code = re.sub(r"\D", "", fields.get("code", code))[:6].zfill(6)
        if not IMPA_CODE_RE.match(impa_code):
            return None
        name = clean_english_name(fields.get("english", ""))
        if not name:
            return None
        unit = normalize_unit(fields.get("unit", "PCS"))
        plate = extract_plate_filename(soup)
        return {
            "c": impa_code,
            "n": name,
            "u": unit,
            "g": self.category,
            "p": plate,
        }


def validate_items(items: list[dict[str, str]]) -> list[str]:
    errors: list[str] = []
    for item in items:
        code = item.get("c", "")
        if not IMPA_CODE_RE.match(str(code)):
            errors.append(f"{code}: invalid 6-digit IMPA code")
        if not str(item.get("n", "")).strip():
            errors.append(f"{code}: missing name (n)")
        if not str(item.get("u", "")).strip():
            errors.append(f"{code}: missing unit (u)")
        if not str(item.get("g", "")).strip():
            errors.append(f"{code}: missing category (g)")
    return errors


def scrape_category(
    category: str,
    *,
    limit: int | None = None,
    delay: float = DEFAULT_DELAY,
) -> list[dict[str, str]]:
    scraper = SpaceMarineScraper(category, delay=delay)
    codes = scraper.iter_codes(limit=limit)
    if not codes:
        raise RuntimeError(f"No items found for category {category}")

    items: list[dict[str, str]] = []
    for idx, code in enumerate(codes, start=1):
        row = scraper.fetch_item(code)
        if row:
            items.append(row)
        print(f"  [{idx}/{len(codes)}] {code} -> {row['n'][:60] if row else 'SKIP'}")
    return items


def save_items(category: str, items: list[dict[str, str]], output: Path | None = None) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = output or (OUT_DIR / f"impa-{category}.json")
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scrape Space-Marine IMPA catalog into TVC JSON.")
    parser.add_argument("--category", required=True, help="IMPA chapter/category (e.g. 75, 81)")
    parser.add_argument("--limit", type=int, default=None, help="Max items to scrape (for testing)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Delay between HTTP requests (seconds)")
    parser.add_argument("--output", type=Path, default=None, help="Override output JSON path")
    args = parser.parse_args(argv)

    category = str(args.category).strip()
    if not re.fullmatch(r"\d{1,2}", category):
        print("ERROR: --category must be a 1-2 digit chapter number", file=sys.stderr)
        return 1

    print(f"Scraping Space-Marine category {category}...")
    try:
        items = scrape_category(category, limit=args.limit, delay=args.delay)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    errors = validate_items(items)
    if errors:
        print("Validation errors:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    out_path = save_items(category, items, args.output)
    print(f"\nSaved {len(items)} items -> {out_path}")
    if items:
        print("Sample:", json.dumps(items[0], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
