# LifeOS v2.4.0

- Added History & Audit (hash-chain integrity)
- Restricted Mode on integrity violation
- Sidebar icons+text layout skeleton

# LifeOS v2.1 (GitHub Pages) — Multi-device Login + Encrypted Sync + Updates

**What you get in v2.1**
- Email/password **login** (multi-device) via Supabase Auth.
- **Zero-knowledge Vault**: tasks/stats/history are encrypted client-side (AES-GCM). Server stores only encrypted blobs.
- **Update system**: checks `version.json` and uses Service Worker update prompt.
- Tasks: create/edit/delete/done, XP & Level, history timeline.
- Statistics & Analytics: KPIs + XP trend + 30-day heatmap.

## 1) Create Supabase project
1. Create a project in Supabase.
2. In **Project Settings → API**, copy:
   - `Project URL`
   - `anon public key`

## 2) Create table + RLS policies (SQL)
Open **SQL Editor** in Supabase and run:

```sql
-- Encrypted vault storage (one row per user)
create table if not exists public.lifeos_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  version text not null default '2.1.0',
  blob text not null,          -- base64 (encrypted)
  meta jsonb not null default '{}'::jsonb
);

alter table public.lifeos_vault enable row level security;

-- Only the owner can read/write their own vault row
create policy "lifeos_vault_select_own"
on public.lifeos_vault for select
using (auth.uid() = user_id);

create policy "lifeos_vault_insert_own"
on public.lifeos_vault for insert
with check (auth.uid() = user_id);

create policy "lifeos_vault_update_own"
on public.lifeos_vault for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## 3) Configure the app
Edit `src/config.js` and paste your keys:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## 4) GitHub Pages
Upload all files to your repo root (ensure `index.html` is in root), then:
Settings → Pages → Deploy from branch → main / (root)

## Security notes (important)
- The Vault passphrase is **never sent** to Supabase.
- If you forget the Vault passphrase, the encrypted data cannot be decrypted (by design).
- The account password is handled by Supabase Auth. You can reset it via Supabase email reset if enabled.

## Update workflow
When you ship v2.1.x:
1) Update `/version.json` (version/build/notes)
2) Push to GitHub
3) Clients will see **Update available** and can apply it.

## v2.4.0 — Devices table (multi-device list) (SQL)
Run this in Supabase **SQL Editor**:

```sql
create table if not exists public.lifeos_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  label text not null default 'Device',
  platform text not null default '',
  user_agent text not null default '',
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.lifeos_devices enable row level security;

create policy "lifeos_devices_select_own"
on public.lifeos_devices for select
using (auth.uid() = user_id);

create policy "lifeos_devices_upsert_own"
on public.lifeos_devices for insert
with check (auth.uid() = user_id);

create policy "lifeos_devices_update_own"
on public.lifeos_devices for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "lifeos_devices_delete_own"
on public.lifeos_devices for delete
using (auth.uid() = user_id);
```

Notes:
- This only manages the **device list** and last_seen heartbeats.
- Supabase Auth doesn't expose a full "session list" to the browser; device rows are the practical replacement.


## v2.5.0 Database additions

### 1) Devices revoke support
Add columns (or re-create table):

```sql
alter table public.lifeos_devices
  add column if not exists revoked boolean not null default false,
  add column if not exists revoked_at timestamptz;
```

### 2) Vault versions (encrypted snapshots)
Create table:

```sql
create table if not exists public.lifeos_vault_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  app_version text,
  meta jsonb,
  blob text not null
);

create index if not exists lifeos_vault_versions_user_created_idx
  on public.lifeos_vault_versions (user_id, created_at desc);
```

RLS (same idea as vault):

```sql
alter table public.lifeos_vault_versions enable row level security;

create policy "vault_versions_owner_read" on public.lifeos_vault_versions
  for select using (auth.uid() = user_id);

create policy "vault_versions_owner_write" on public.lifeos_vault_versions
  for insert with check (auth.uid() = user_id);

create policy "vault_versions_owner_delete" on public.lifeos_vault_versions
  for delete using (auth.uid() = user_id);
```


## v3.3.0
- Sync conflict preview (local vs cloud summary)
- Offline queue status + net pill
- Device-specific history (deviceId stored in audit events + filter)


## Docs (v3.5.0)
- docs/01_threat_model.md
- docs/02_data_schema.md
- docs/03_upgrade_migration.md
- docs/04_disaster_recovery.md

## Creator tools
- Creator panel can generate Remote Feature Flags JSON to paste into version.json (Stable/Beta).
