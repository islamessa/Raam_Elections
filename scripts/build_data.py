#!/usr/bin/env python3
"""Build docs/data/negev.json from the official raw files in data/raw/.

Sources (see data/SOURCES.md):
  * Central Elections Committee (CEC) per-locality results  k{21..26}_expc.csv
  * CBS locality files 2019 / 2023 (via data.gov.il)          cbs_localities_*.csv
  * Arab Negev locality classification (hand-made table)      negev_arab_localities.csv

Run:  python3 scripts/build_data.py
The script fails (exit code 1) if any consistency check against the official
published totals does not hold.
"""
import csv
import io
import json
import math
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "docs" / "data" / "negev.json"

THRESHOLD = 0.0325

# Election metadata. Letters were verified against the national results page
# of each election (votesNN.bechirot.gov.il). `seats` = official seats of the
# list that contained Ra'am.
ELECTIONS = [
    dict(id=21, date="2019-04-09", label="نيسان 2019", raam="דעם", raam_alone=False,
         raam_list_ar="الموحدة – التجمع", seats=4, other_arab=["ום"],
         other_arab_ar="الجبهة – العربية للتغيير"),
    dict(id=22, date="2019-09-17", label="أيلول 2019", raam="ודעם", raam_alone=False,
         raam_list_ar="القائمة المشتركة", seats=13, other_arab=[], other_arab_ar=""),
    dict(id=23, date="2020-03-02", label="آذار 2020", raam="ודעם", raam_alone=False,
         raam_list_ar="القائمة المشتركة", seats=15, other_arab=[], other_arab_ar=""),
    dict(id=24, date="2021-03-23", label="آذار 2021", raam="עם", raam_alone=True,
         raam_list_ar="القائمة الموحدة", seats=4, other_arab=["ודעם"],
         other_arab_ar="القائمة المشتركة"),
    dict(id=25, date="2022-11-01", label="تشرين الثاني 2022", raam="עם", raam_alone=True,
         raam_list_ar="القائمة الموحدة", seats=5, other_arab=["ום", "ד"],
         other_arab_ar="الجبهة – العربية للتغيير + التجمع"),
    dict(id=26, date="2026-10-27", label="تشرين الأول 2026", raam="עם", raam_alone=True,
         raam_list_ar="القائمة الموحدة", seats=8, other_arab=["ודם"],
         other_arab_ar="القائمة المشتركة"),
]

# Official published national figures (results page of each election),
# used only as a check that the raw file was read correctly.
OFFICIAL_RAAM_VOTES = {21: 143666, 22: 470211, 23: 581507, 24: 167064, 25: 194047, 26: 337720}
OFFICIAL_ELIGIBLE = {26: 7331981}

META_COLS = {"סמל ועדה", "שם ישוב", "סמל ישוב", "בזב", "מצביעים", "פסולים", "כשרים", ""}


def read_text(path):
    raw = path.read_bytes()
    if raw[:3] == b"\xef\xbb\xbf":
        return raw.decode("utf-8-sig")
    return raw.decode("cp1255")


def num(v):
    v = (v or "").strip()
    return int(v) if v else 0


def years_between(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days / 365.25


def cagr(v0, v1, years):
    return (v1 / v0) ** (1 / years) - 1


def main():
    errors = []

    loc_rows = list(csv.DictReader(open(ROOT / "data" / "negev_arab_localities.csv", encoding="utf-8")))
    localities = {r["code"]: r for r in loc_rows}

    cbs23 = {r["סמל יישוב"]: r for r in csv.DictReader(open(RAW / "cbs_localities_2023.csv", encoding="utf-8"))}
    cbs19 = {r["סמל יישוב"]: r for r in csv.DictReader(open(RAW / "cbs_localities_2019.csv", encoding="utf-8"))}

    # Sanity: every CBS Arab/Bedouin entity in Beersheba sub-district (62)
    # that appears in the election files must be in our table.
    cbs_negev_arab = {c for c, r in cbs23.items() if r["סמל נפה"] == "62" and r["דת יישוב"] in ("2", "3")}

    out_elections = []
    out_loc = {
        code: dict(code=int(code), ar=r["name_ar"], he=cbs23[code]["שם יישוב"].strip(), type=r["type"],
                   council=r["council_ar"], pop2023=num(cbs23[code]["סך הכל אוכלוסייה 2023 - ארעי"]) or None,
                   results={})
        for code, r in localities.items()
    }

    for e in ELECTIONS:
        n = e["id"]
        rows = list(csv.DictReader(io.StringIO(read_text(RAW / f"k{n}_expc.csv"))))
        parties = [k for k in rows[0] if k not in META_COLS]
        by_code = {r["סמל ישוב"].strip(): r for r in rows}

        in_files = cbs_negev_arab & set(by_code)
        if in_files != set(localities):
            errors.append(f"K{n}: locality table mismatch: missing={in_files - set(localities)} extra={set(localities) - in_files}")

        nat = {k: sum(num(r[k]) for r in rows) for k in ["בזב", "מצביעים", "פסולים", "כשרים"]}
        party_tot = {p: sum(num(r[p]) for r in rows) for p in parties}
        if sum(party_tot.values()) != nat["כשרים"]:
            errors.append(f"K{n}: party sum {sum(party_tot.values())} != valid {nat['כשרים']}")
        if nat["כשרים"] + nat["פסולים"] != nat["מצביעים"]:
            errors.append(f"K{n}: valid+invalid != voters")
        if party_tot[e["raam"]] != OFFICIAL_RAAM_VOTES[n]:
            errors.append(f"K{n}: Ra'am list votes {party_tot[e['raam']]} != official {OFFICIAL_RAAM_VOTES[n]}")
        if n in OFFICIAL_ELIGIBLE and nat["בזב"] != OFFICIAL_ELIGIBLE[n]:
            errors.append(f"K{n}: eligible {nat['בזב']} != official {OFFICIAL_ELIGIBLE[n]}")

        above = sum(v for v in party_tot.values() if v >= THRESHOLD * nat["כשרים"])

        neg = dict(eligible=0, voters=0, invalid=0, valid=0, raam=0, otherArab=0)
        for code in localities:
            r = by_code[code]
            res = dict(eligible=num(r["בזב"]), voters=num(r["מצביעים"]), invalid=num(r["פסולים"]),
                       valid=num(r["כשרים"]), raam=num(r[e["raam"]]),
                       otherArab=sum(num(r[p]) for p in e["other_arab"]))
            out_loc[code]["results"][str(n)] = res
            for k in neg:
                neg[k] += res[k]

        out_elections.append(dict(
            id=n, date=e["date"], label=e["label"], raamAlone=e["raam_alone"],
            raamListAr=e["raam_list_ar"], otherArabAr=e["other_arab_ar"],
            national=dict(eligible=nat["בזב"], voters=nat["מצביעים"], invalid=nat["פסולים"],
                          valid=nat["כשרים"], raam=party_tot[e["raam"]], raamSeats=e["seats"],
                          otherArab=sum(party_tot[p] for p in e["other_arab"]),
                          aboveThresholdValid=above),
            negev=neg,
        ))
        print(f"K{n}: national turnout {nat['מצביעים']/nat['בזב']:.2%} | Negev eligible {neg['eligible']:,} "
              f"turnout {neg['voters']/neg['eligible']:.2%} | Ra'am list in Negev {neg['raam']:,} "
              f"({neg['raam']/neg['valid']:.1%} of valid) = {neg['raam']/party_tot[e['raam']]:.1%} of its national votes")

    first, last = out_elections[0], out_elections[-1]
    yrs = years_between(first["date"], last["date"])

    # CBS population growth of the recognised Arab localities (CBS has no
    # population figures for the tribes).
    rec = [c for c, r in localities.items() if r["type"] != "tribe"]
    pop19 = sum(num(cbs19[c]["סך הכל אוכלוסייה 2019"]) for c in rec)
    pop23 = sum(num(cbs23[c]["סך הכל אוכלוסייה 2023 - ארעי"]) for c in rec)

    growth = dict(
        negevEligibleCagr=cagr(first["negev"]["eligible"], last["negev"]["eligible"], yrs),
        nationalEligibleCagr=cagr(first["national"]["eligible"], last["national"]["eligible"], yrs),
        cbsPopCagrRecognized=cagr(pop19, pop23, 4),
        cbsPop2019Recognized=pop19,
        cbsPop2023Recognized=pop23,
        periodYears=yrs,
    )
    print("growth:", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in growth.items()})

    if errors:
        print("\nCHECKS FAILED:", *errors, sep="\n  ")
        sys.exit(1)

    data = dict(
        generated=date.today().isoformat(),
        threshold=THRESHOLD,
        elections=out_elections,
        localities=sorted(out_loc.values(), key=lambda l: -l["results"][str(last["id"])]["eligible"]),
        growth=growth,
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nAll checks passed. Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
