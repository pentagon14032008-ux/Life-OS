# LifeOS Threat Model (v3.5.0)

## What we protect
- Tasks, history/audit log, analytics, XP/Rank.
- Vault passphrase (never sent to server).
- Encrypted vault blob stored in cloud.

## Assumptions
- App runs in a user-controlled browser (DevTools exists).
- GitHub Pages is static hosting; code is public.
- Supabase stores encrypted blobs; server should not learn plaintext.

## Main threats and mitigations
### 1) Cloud compromise / database leak
**Threat:** Attacker downloads vault rows.
**Mitigation:** Zero-knowledge encryption (AES-GCM) with key derived from user vault passphrase; plaintext never stored.

### 2) Tampering / cheating (editing local storage)
**Threat:** User edits tasks/XP/history by hand.
**Mitigation:** Audit hash-chain integrity verification. On violation, app enters Restricted Mode (no edits, no XP/analytics/sync).

### 3) Old vulnerable version usage
**Threat:** User stays on outdated build.
**Mitigation:** Mandatory update after login via version.json force_min_version + SW cache control.

### 4) Device theft / shared computer
**Threat:** Someone uses an already-open session.
**Mitigation:** Idle lock + manual lock, device revoke, session guard.

## Residual risks
- Malicious browser extension can read screen/keystrokes.
- If vault passphrase is weak, offline brute force may succeed.
