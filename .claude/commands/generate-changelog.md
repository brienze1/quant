Regenerate the `changelog.json` file from git history. This should be run before each release.

Steps:
0. **Always fetch tags first**: `git fetch --tags` to ensure all remote tags are available locally
1. List all git version tags sorted descending: `git tag --sort=-version:refname`
2. For each consecutive pair of tags, get commits between them: `git log <prev-tag>..<tag> --oneline --no-merges`
3. For the oldest tag, get all commits up to that tag: `git log <tag> --oneline --no-merges`
4. Get the tag date from: `git log -1 --format=%aI <tag>` (take first 10 chars for YYYY-MM-DD)
5. Categorize each commit by its conventional commit prefix:
   - `feat:` or `feat(` -> "features"
   - `fix:` or `fix(` -> "fixes"
   - `refactor:`, `chore:`, `ci:`, `build:` -> "internal"
   - `perf:`, `improve` -> "improvements"
   - Otherwise infer from keywords: "fix/bug/patch" -> fixes, "add/new/implement" -> features, "refactor/clean" -> internal, else -> improvements
6. Strip the conventional commit prefix (e.g. "feat: add X" becomes "add X")
7. Write the result to `changelog.json` in the repo root with this structure:
   ```json
   {
     "entries": [
       {
         "version": "v3.1.0",
         "date": "2026-04-09",
         "changes": {
           "features": ["description 1", "description 2"],
           "fixes": ["fix description"],
           "improvements": ["improvement"],
           "internal": ["internal change"]
         }
       }
     ]
   }
   ```
8. Entries should be ordered by version descending (newest first)
9. Only include non-empty change categories
10. If a version has no commits, use `{"improvements": ["release update"]}`

After generating, verify the JSON is valid by reading it back.
