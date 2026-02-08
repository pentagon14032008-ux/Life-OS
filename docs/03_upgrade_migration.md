# Upgrade & Migration Guide (v3.5.0)

## Normal upgrade (GitHub Pages)
1. Replace repo root files with new release ZIP contents.
2. Update `version.json` (stable/beta) and bump force_min_version.
3. Users login → mandatory update gate ensures new build.

## Data compatibility
- Vault content is versioned. New fields are added with defaults.
- If import detects signature mismatch or integrity violation, import is blocked.

## Rollback
Rollback requires keeping old builds under `/releases/<version>/`.
If you prepared those folders, you can navigate to that path for a previous build.
