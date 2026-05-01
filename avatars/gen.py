#!/usr/bin/env python3
"""Fetch a DiceBear 3D-character avatar per gstack specialist.

Uses the `lorelei` style (illustrated character heads) with each specialist's
accent color as the background. Deterministic — same specialist id always
gets the same character.

Writes two files per specialist:
  avatars/<id>.svg         — DiceBear character on accent background
  avatars/glyph-<id>.svg   — fallback glyph-based avatar (from earlier design)

Run:  python3 gen.py
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

STYLE = "lorelei"
API = "https://api.dicebear.com/9.x/{style}/svg?seed={seed}&backgroundColor={bg}&radius=50&size=256"

SPECIALISTS = [
    # (id, name, glyph, accent_hex)
    ("office-hours",        "YC Office Hours",   "YC",  "ff6b2b"),
    ("plan-ceo-review",     "CEO",               "♛",   "ffb020"),
    ("plan-eng-review",     "Eng Manager",       "⎇",   "5ee1b5"),
    ("plan-design-review",  "Senior Designer",   "◈",   "d68cff"),
    ("plan-devex-review",   "DX Lead",           "❮❯",  "7dd3fc"),
    ("design-consultation", "Design Partner",    "✦",   "f0abfc"),
    ("design-shotgun",      "Design Explorer",   "⁂",   "fb7185"),
    ("design-html",         "Design Engineer",   "</>", "a78bfa"),
    ("review",              "Staff Engineer",    "⌘",   "00e5ff"),
    ("investigate",         "Debugger",          "⌕",   "fde047"),
    ("design-review",       "Designer Who Codes","◐",   "f472b6"),
    ("devex-review",        "DX Tester",         "▤",   "60a5fa"),
    ("qa",                  "QA Lead",           "✓",   "4ade80"),
    ("cso",                 "CSO",               "⛨",   "f87171"),
    ("ship",                "Release Engineer",  "▲",   "34d399"),
    ("land-and-deploy",     "Deploy Engineer",   "⇧",   "22d3ee"),
    ("canary",              "SRE",               "☀",   "fbbf24"),
    ("retro",               "Retro Facilitator", "↻",   "c4b5fd"),
]


GLYPH_SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="256" height="256"
     role="img" aria-label="{name} avatar">
  <defs>
    <radialGradient id="bg" cx="35%" cy="30%" r="75%">
      <stop offset="0" stop-color="#{accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#0a0a0b" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="100" fill="#0a0a0b"/>
  <circle cx="100" cy="100" r="98" fill="url(#bg)"/>
  <circle cx="100" cy="100" r="98" fill="none"
          stroke="#{accent}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="100" y="100"
        font-family="JetBrains Mono, ui-monospace, monospace"
        font-size="{font_size}" font-weight="700"
        fill="#{accent}" text-anchor="middle" dominant-baseline="central">{glyph_escaped}</text>
</svg>
"""


def xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def fetch_character(spec_id: str, accent_hex: str) -> bytes:
    url = API.format(style=STYLE, seed=spec_id, bg=accent_hex)
    req = urllib.request.Request(url, headers={"User-Agent": "gstack-avatar-gen/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def main():
    out_dir = Path(__file__).resolve().parent
    for spec_id, name, glyph, accent in SPECIALISTS:
        # 3D character avatar from DiceBear
        try:
            svg = fetch_character(spec_id, accent)
            (out_dir / f"{spec_id}.svg").write_bytes(svg)
            print(f"character  {spec_id}.svg      ({name}, bg=#{accent})")
        except Exception as e:
            print(f"SKIP {spec_id}: DiceBear fetch failed: {e}")

        # Glyph fallback
        font_size = 72 if len(glyph) >= 2 else 96
        glyph_svg = GLYPH_SVG.format(
            name=xml_escape(name),
            accent=accent,
            glyph_escaped=xml_escape(glyph),
            font_size=font_size,
        )
        (out_dir / f"glyph-{spec_id}.svg").write_text(glyph_svg, encoding="utf-8")

    print(f"\n{len(SPECIALISTS)} character avatars + {len(SPECIALISTS)} glyph fallbacks written.")


if __name__ == "__main__":
    main()
