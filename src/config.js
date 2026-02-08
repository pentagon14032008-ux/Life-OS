export const CONFIG = {
  APP_NAME: "LifeOS v2",
  DEFAULT_CHANNEL: "stable",
  XP_PER_LEVEL: 100,

  // Paste your Supabase project values here:
  SUPABASE_URL: "PASTE_SUPABASE_URL_HERE",
  SUPABASE_ANON_KEY: "PASTE_SUPABASE_ANON_KEY_HERE",

  // Supabase tables:
  VAULT_TABLE: "lifeos_vault",
  VAULT_VERSIONS_TABLE: "lifeos_vault_versions",
  DEVICE_TABLE: "lifeos_devices",

  // Update checks:
  UPDATE_CHECK_INTERVAL_MIN: 30,

  // Sync:
  SYNC_HEARTBEAT_MIN: 5,      // update device last_seen
  SYNC_POLL_MIN: 10,          // pull remote changes (if any)
  SYNC_DEBOUNCE_MS: 1500,     // push debounce after local changes

  // Auto-lock:
  IDLE_LOCK_MIN: 10,
};
