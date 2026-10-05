"""Extract substance headwords from the WADA Prohibited List PDF.

Key simplification: an athlete reads "Stanozolol" off a box, not
"17ß-hydroxy-17ɑ-methylandrosta-1,4-dien-3-one". The bracketed chemical names
are only noise for matching, and they are also what makes the PDF hard to
parse — they wrap across lines and interleave between columns.

So each bullet contributes only the text on its OWN visual line, up to the
first bracket. Headwords are short and never wrap, which makes the rule exact.
Two shapes are handled:

  "• Stanozolol"                 -> one headword
  "• Diuretics such as:" + list  -> expand the semicolon list that follows

Bullets below an EXCEPTIONS heading are captured separately: reading them as
prohibited would tell an athlete to discard a permitted medicine.
"""
import json
import re
import sys
import pdfplumber

SRC, OUT = sys.argv[1], sys.argv[2]

CLASS_TITLES = {
    "S0": "Non-Approved Substances",
    "S1": "Anabolic Agents",
    "S2": "Peptide Hormones, Growth Factors, Related Substances and Mimetics",
    "S3": "Beta-2 Agonists",
    "S4": "Hormone and Metabolic Modulators",
    "S5": "Diuretics and Masking Agents",
    "S6": "Stimulants",
    "S7": "Narcotics",
    "S8": "Cannabinoids",
    "S9": "Glucocorticoids",
    "P1": "Beta-Blockers",
}
BULLETS = {"•", "", "", "▪"}
LEADING_SPLIT = re.compile(r"\b([A-Z])\s(?=[a-z]{2,})")
NOISE = re.compile(
    r"other substances|not limited|exogenously|all prohibited|^prohibited|^including"
    r"|^index|^note|exception|specified substance|^and\b|^e\.g|maximum|micrograms"
    r"|^\d+$|administration|^also\b|subdiscipline|^routes|similar biological",
    re.I,
)


def clean(t):
    t = t.replace("’", "'").replace("­", "")
    t = LEADING_SPLIT.sub(r"\1", t)
    return re.sub(r"\s+", " ", t).strip(" .,;:*")


def usable(name):
    name = name.strip(" *")
    if not (3 <= len(name) <= 48):
        return False
    if not re.search(r"[A-Za-z]{3}", name):
        return False
    if NOISE.search(name):
        return False
    # Reject leftover chemical fragments.
    if re.search(r"[\[\]]|\d-\w{2,}-|^\(", name):
        return False
    return True


def cluster(xs, gap=40):
    if not xs:
        return []
    xs = sorted(xs)
    out, cur = [], [xs[0]]
    for v in xs[1:]:
        if v - cur[-1] <= gap:
            cur.append(v)
        else:
            out.append(sum(cur) / len(cur))
            cur = [v]
    out.append(sum(cur) / len(cur))
    return out


def parse_page(page):
    words = page.extract_words(keep_blank_chars=False)
    if not words:
        return [], [], []
    bullets = [w for w in words if w["text"].strip() in BULLETS]
    if not bullets:
        return [], [], []

    exc_top = note_top = None
    for w in words:
        t = w["text"].strip().upper().strip(":")
        if t.startswith("EXCEPTION") and exc_top is None:
            exc_top = w["top"]
        elif t == "NOTE" and note_top is None:
            note_top = w["top"]

    bands = cluster([b["x0"] for b in bullets])

    def band_of(x):
        return min(range(len(bands)), key=lambda i: abs(x - bands[i]))

    main, exc, sports = [], [], []
    sport_block = "in the following sports" in (page.extract_text() or "").lower()

    for b in bullets:
        band = band_of(b["x0"])
        # Words on the bullet's own line, to its right, in its band.
        same_line = [
            w
            for w in words
            if w["text"].strip() not in BULLETS
            and abs(w["top"] - b["top"]) <= 3
            and w["x0"] > b["x0"]
            and band_of(w["x0"]) == band
        ]
        same_line.sort(key=lambda w: w["x0"])
        line = clean(" ".join(w["text"] for w in same_line))
        if not line:
            continue

        is_exc = exc_top is not None and b["top"] > exc_top
        is_note = note_top is not None and b["top"] > note_top and not is_exc
        if is_note:
            continue

        if line.rstrip().endswith(":") or re.search(r"(such as|including)\s*:?$", line, re.I):
            # Category bullet: the substances are on the lines beneath it,
            # before the next bullet in this band.
            nxt = min(
                (o["top"] for o in bullets if band_of(o["x0"]) == band and o["top"] > b["top"]),
                default=page.height,
            )
            tail = [
                w
                for w in words
                if b["top"] + 3 < w["top"] < nxt - 1 and band_of(w["x0"]) == band
            ]
            tail.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
            blob = clean(" ".join(w["text"] for w in tail))
            blob = re.sub(r"\be\.g\.\s*", "", blob)
            for part in re.split(r";|,| and (?=[a-z])", blob):
                p = clean(part)
                if usable(p):
                    (exc if is_exc else main).append(p)
            continue

        head = clean(line.split("(")[0])
        if not usable(head):
            continue
        if (
            "P1" and sport_block and not is_exc and not re.search(r"[oai]lol\b", head, re.I)
        ):
            sports.append(head)
            continue
        (exc if is_exc else main).append(head)

    return main, exc, sports


with pdfplumber.open(SRC) as pdf:
    collected, excepted, sportlists = {}, {}, {}
    current = None
    for page in pdf.pages:
        text = page.extract_text() or ""
        m = re.match(r"^\s*(S\d|P\d|M\d)\b", text.strip())
        if m:
            current = m.group(1)
        if current not in CLASS_TITLES:
            continue
        main, exc, sports = parse_page(page)
        collected.setdefault(current, []).extend(main)
        excepted.setdefault(current, []).extend(exc)
        if current == "P1":
            sportlists.setdefault(current, []).extend(sports)

def dedupe(xs):
    seen, out = set(), []
    for x in xs:
        k = x.lower()
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out

result = {}
for cls in CLASS_TITLES:
    entries = dedupe(collected.get(cls, []))
    if not entries:
        continue
    result[cls] = {
        "title": CLASS_TITLES[cls],
        "entries": entries,
        "exceptions": dedupe(excepted.get(cls, [])),
        "sports": dedupe(sportlists.get(cls, [])),
    }

json.dump(result, open(OUT, "w"), indent=2, ensure_ascii=False)
print(f"classes: {len(result)}  entries: {sum(len(v['entries']) for v in result.values())}")
for cls in sorted(result):
    v = result[cls]
    print(f"  {cls:>3}  {len(v['entries']):>3} prohibited  {len(v['exceptions']):>2} exceptions"
          + (f"  sports:{len(v['sports'])}" if v["sports"] else ""))
