#!/usr/bin/env python3
"""Generate the compact ISO 20275 legal-form reference consumed by @praxis/shared.

Source: GLEIF Entity Legal Forms Code List v1.6 (2026-02-19). Download the
official CSV from the URL below, then pass its path:

  python3 scripts/gen/gen-legal-form-catalogue.py /path/to/elf-v1.6.csv

The output is deterministic and contains active, jurisdiction-bound forms only.
Reserved 8888/9999 rows and inactive historical forms are deliberately omitted
from the picker. Local names, transliterations and every published abbreviation
remain searchable aliases even though one concise label is chosen for display.

Official source:
https://www.gleif.org/lei-data/code-lists/iso-20275-entity-legal-forms-code-list/2026-02-19-elf-code-list-v1.6.csv
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

VERSION = "1.6"
RELEASED_ON = "2026-02-19"
SOURCE_URL = (
    "https://www.gleif.org/lei-data/code-lists/iso-20275-entity-legal-forms-code-list/"
    "2026-02-19-elf-code-list-v1.6.csv"
)
OUTPUT = Path(__file__).resolve().parents[2] / "packages/shared/data/legal-forms.generated.js"

# The v1.6 CSV reverses the familiar Nigerian private/public suffixes. CAC's
# Companies Regulations 2021 prescribe Ltd for private limited-by-shares and Plc
# for public limited-by-shares. Keep the ISO ELF identifiers and correct only the
# operator-facing abbreviation. Both original values stay aliases for discovery.
DISPLAY_OVERRIDES = {
    "FHZY": "Ltd",
    "PKBG": "PLC",
}


def split_values(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def abbreviation_score(value: str) -> tuple[int, int, str]:
    """Prefer concise human suffixes: LLC over L.L.C., Ltd over Limited."""
    alnum = re.sub(r"[^0-9A-Za-zÀ-ÖØ-öø-ÿ]", "", value)
    punctuation = len(value) - len(alnum)
    return (len(alnum), punctuation, value.casefold())


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: gen-legal-form-catalogue.py /path/to/elf-v1.6.csv")
    source = Path(sys.argv[1])
    raw = source.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()

    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["ELF Status ACTV/INAC"] != "ACTV":
            continue
        if not row["Country Code (ISO 3166-1)"]:
            continue
        grouped[row["ELF Code"]].append(row)

    forms: list[list[object]] = []
    for code, variants in grouped.items():
        # Codes are jurisdiction-unique under ISO 20275. Prefer English only for
        # the primary display name; every local-language variant remains indexed.
        primary = next(
            (row for row in variants if row["Language Code (ISO 639-1)"] == "en"),
            variants[0],
        )
        abbreviations = unique(
            [
                item
                for row in variants
                for field in ("Abbreviations Local language", "Abbreviations transliterated")
                for item in split_values(row[field])
            ]
        )
        display = DISPLAY_OVERRIDES.get(code)
        # Several US state rows omit the universally used LLC abbreviation even
        # though the state registry uses it. Apply it consistently to the exact
        # legal form (never to professional/series variants).
        if (
            not display
            and primary["Country Code (ISO 3166-1)"] == "US"
            and primary["Entity Legal Form name Local name"].casefold()
            == "limited liability company"
        ):
            display = "LLC"
        if not display:
            display = min(abbreviations, key=abbreviation_score) if abbreviations else primary[
                "Entity Legal Form name Local name"
            ]

        names = unique(
            [
                value.strip()
                for row in variants
                for value in (
                    row["Entity Legal Form name Local name"],
                    row["Entity Legal Form name Transliterated name (per ISO 01-140-10)"],
                )
                if value.strip()
            ]
        )
        aliases = unique(names + abbreviations)
        forms.append(
            [
                code,
                primary["Country Code (ISO 3166-1)"],
                primary["Country sub-division code (ISO 3166-2)"],
                primary["Jurisdiction of formation"],
                primary["Entity Legal Form name Local name"],
                display,
                aliases,
            ]
        )

    forms.sort(key=lambda form: (str(form[1]), str(form[2]), str(form[5]).casefold(), str(form[0])))
    header = f'''"use strict";
/**
 * GENERATED FILE — do not hand-edit.
 * ISO 20275 Entity Legal Forms, GLEIF v{VERSION}, released {RELEASED_ON}.
 * {len(forms)} active jurisdiction-bound ELF codes from {len({form[1] for form in forms})} countries.
 * Source SHA-256: {sha256}
 * Regenerate with: python3 scripts/gen/gen-legal-form-catalogue.py <official.csv>
 */
exports.GLEIF_VERSION = {json.dumps(VERSION)};
exports.GLEIF_RELEASED_ON = {json.dumps(RELEASED_ON)};
exports.GLEIF_SOURCE_URL = {json.dumps(SOURCE_URL)};
exports.GLEIF_SOURCE_SHA256 = {json.dumps(sha256)};
exports.GLEIF_FORMS = '''
    OUTPUT.write_text(
        header + json.dumps(forms, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(
        f"wrote {OUTPUT.relative_to(OUTPUT.parents[2])}: {len(forms)} forms, "
        f"{len({form[1] for form in forms})} countries, sha256={sha256}"
    )


if __name__ == "__main__":
    main()
