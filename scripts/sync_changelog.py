#!/usr/bin/env python3
"""Sync changelog.json up to a target release version, for embedding in the tag.

The running app reads its version from the top entry of the embedded
changelog.json (changelogController.GetVersion). Releases are auto-tagged on PR
merge, so without this the embedded changelog drifts behind the tag and the app
reports a stale version.

main is protected by a "changes must go through a PR" ruleset, so the release
pipeline cannot push to main. Instead it runs this script and commits the result
onto the *tag* only (a commit off main). main's changelog.json therefore stays
frozen at its last hand-edited state; this script fills in every version newer
than that, up to the target, so each released build embeds a complete, correct
changelog. Hand-written entries already on main are preserved.

Entries are built from conventional-commit subjects in each version's tag range
(mirrors the generate-changelog command). Idempotent: versions already present
are left untouched.

Usage: scripts/sync_changelog.py vX.Y.Z   (the version about to be tagged)
"""
import datetime
import json
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANGELOG = os.path.join(REPO_ROOT, "changelog.json")
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
PREFIX_RE = re.compile(r"^[a-z]+(\([^)]*\))?!?:\s*")


def sh(*args):
    return subprocess.check_output(args, cwd=REPO_ROOT, text=True).strip()


def parse(v):
    """'v3.1.43' -> (3, 1, 43); used for ordering."""
    nums = re.findall(r"\d+", v)
    return tuple(int(n) for n in nums[:3]) + (0,) * (3 - len(nums[:3]))


def sorted_tags():
    try:
        tags = sh("git", "tag").splitlines()
    except subprocess.CalledProcessError:
        tags = []
    return sorted((t for t in tags if TAG_RE.match(t)), key=parse)


def categorize(subject):
    if subject.startswith("feat"):
        cat = "features"
    elif subject.startswith("fix"):
        cat = "fixes"
    elif re.match(r"^(refactor|chore|ci|build)", subject):
        cat = "internal"
    elif subject.startswith("perf") or "improve" in subject:
        cat = "improvements"
    else:
        low = subject.lower()
        if any(k in low for k in ("fix", "bug", "patch")):
            cat = "fixes"
        elif any(k in low for k in ("add", "new", "implement")):
            cat = "features"
        elif any(k in low for k in ("refactor", "clean")):
            cat = "internal"
        else:
            cat = "improvements"
    return cat, PREFIX_RE.sub("", subject)


def build_entry(version, log_range, date):
    log = sh("git", "log", log_range, "--no-merges", "--pretty=format:%s") if log_range else ""
    changes = {}
    for line in log.splitlines():
        line = line.strip()
        if not line:
            continue
        cat, text = categorize(line)
        bucket = changes.setdefault(cat, [])
        if text not in bucket:
            bucket.append(text)
    if not changes:
        changes = {"improvements": ["release update"]}
    return {"version": version, "date": date, "changes": changes}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: sync_changelog.py vX.Y.Z")
    target = sys.argv[1]
    if not target.startswith("v"):
        target = "v" + target

    with open(CHANGELOG) as f:
        data = json.load(f)
    entries = data.get("entries", [])
    have = {e.get("version") for e in entries}
    top = entries[0]["version"] if entries else "v0.0.0"

    tags = sorted_tags()
    today = datetime.date.today().isoformat()

    # Versions to add: every tag newer than the current top entry and <= target,
    # plus the target itself if it isn't a tag yet (the one about to be cut).
    to_add = [t for t in tags if parse(t) > parse(top) and parse(t) <= parse(target)]
    if target not in tags and parse(target) > parse(top):
        to_add.append(target)
    to_add = [v for v in to_add if v not in have]
    to_add.sort(key=parse)

    if not to_add:
        print(f"changelog already current through {target}; nothing to do")
        return

    # For each version, diff against the previous known version (a tag below it,
    # else the current top). The target (untagged) diffs against the latest tag.
    new_entries = []
    prev = top
    for v in to_add:
        base = prev if prev != "v0.0.0" else None
        head = v if v in tags else "HEAD"
        log_range = f"{base}..{head}" if base else head
        new_entries.append(build_entry(v, log_range, today))
        prev = v

    data["entries"] = list(reversed(new_entries)) + entries
    with open(CHANGELOG, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"added {len(new_entries)} version(s): {', '.join(v for v in to_add)}")


if __name__ == "__main__":
    main()
