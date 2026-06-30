#!/usr/bin/env python3
"""Prepend a changelog entry for a new release version.

The running app reads its version from the top entry of changelog.json
(see internal/integration/entrypoint/controller/changelog.go). Releases are
auto-tagged on PR merge, so this script keeps changelog.json's newest entry in
sync with the tag being released — otherwise the app reports a stale version.

It builds the new entry from the conventional-commit subjects since the latest
existing tag (mirroring the categorization in the generate-changelog command),
and PREPENDS it, preserving all existing (hand-written) entries.

Idempotent: a no-op when the top entry already matches the target version.

Usage: scripts/prepend_changelog.py vX.Y.Z
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
# strips a conventional-commit prefix: "feat(scope)!: msg" -> "msg"
PREFIX_RE = re.compile(r"^[a-z]+(\([^)]*\))?!?:\s*")


def sh(*args):
    return subprocess.check_output(args, cwd=REPO_ROOT, text=True).strip()


def latest_tag():
    try:
        tags = sh("git", "tag", "--sort=-version:refname").splitlines()
    except subprocess.CalledProcessError:
        return None
    for t in tags:
        if TAG_RE.match(t):
            return t
    return None


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


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: prepend_changelog.py vX.Y.Z")
    version = sys.argv[1]
    if not version.startswith("v"):
        version = "v" + version

    with open(CHANGELOG) as f:
        data = json.load(f)
    entries = data.get("entries", [])

    if entries and entries[0].get("version") == version:
        print(f"changelog already tops out at {version}; nothing to do")
        return

    tag = latest_tag()
    log_range = f"{tag}..HEAD" if tag else "HEAD"
    log = sh("git", "log", log_range, "--no-merges", "--pretty=format:%s")

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

    entry = {
        "version": version,
        "date": datetime.date.today().isoformat(),
        "changes": changes,
    }
    data["entries"] = [entry] + entries

    with open(CHANGELOG, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    total = sum(len(v) for v in changes.values())
    print(f"prepended {version} with {total} change(s)")


if __name__ == "__main__":
    main()
