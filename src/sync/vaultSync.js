import { CONFIG } from "../config.js";
import { encryptJSON, decryptJSON, safeHash } from "../security/crypto.js";
import { ensureState } from "../engine/engine.js";
import { APP_VERSION } from "../version.js";

/**
 * v2.4: Encrypted Vault Sync with LWW + conflict alert.
 * Remote stores: blob (base64 JSON of encrypted payload) + meta {updatedAt, schema, stats, lastEventHash}
 */
export class VaultSync {
  constructor(supabase){
    this.sb = supabase;
    this.passphrase = null;
    this.user = null;

    this.lastRemoteHash = null;
    this.lastRemoteUpdatedAt = null; // ms
    this.lastPullAt = null;
  }

  setPassphrase(p){ this.passphrase = p; }
  setUser(u){ this.user = u; }

  async getRemote(){
    const { data, error } = await this.sb
      .from(CONFIG.VAULT_TABLE)
      .select("*")
      .eq("user_id", this.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async wipeRemote(){
    const { error } = await this.sb.from(CONFIG.VAULT_TABLE).delete().eq("user_id", this.user.id);
    if (error) throw error;
    this.lastRemoteHash = null;
    this.lastRemoteUpdatedAt = null;
  }

  async pushState(state){
    if (!this.passphrase) throw new Error("Vault locked (no passphrase).");

    const payload = await encryptJSON(this.passphrase, state, null);
    const blob = btoa(JSON.stringify(payload));

    const meta = {
      updatedAt: state.updatedAt || Date.now(),
      schema: state.schema,
      stats: state.stats,
      lastEventHash: state.audit?.events?.length ? state.audit.events[state.audit.events.length - 1].hash : null
    };

    const { error } = await this.sb.from(CONFIG.VAULT_TABLE).upsert({
      user_id: this.user.id,
      updated_at: new Date().toISOString(),
      version: APP_VERSION,
      blob,
      meta
    });
    if (error) throw error;

    // v2.5: store encrypted snapshots for safe restore (best-effort)
    try {
      const table = CONFIG.VAULT_VERSIONS_TABLE;
      if (table){
        await this.sb.from(table).insert({
          user_id: this.user.id,
          created_at: new Date().toISOString(),
          app_version: APP_VERSION,
          meta,
          blob
        });
        // Keep only latest 20 versions (best-effort; requires DB policy)
        const { data: vers } = await this.sb.from(table)
          .select("created_at")
          .eq("user_id", this.user.id)
          .order("created_at", { ascending: false })
          .range(20, 200);
        if (vers && vers.length){
          const cutoff = vers[0].created_at;
          await this.sb.from(table)
            .delete()
            .eq("user_id", this.user.id)
            .lt("created_at", cutoff);
        }
      }
    } catch (e) {
      // Ignore versioning errors (still keep main vault in sync)
      console.warn("vault versioning skipped", e);
    }

    this.lastRemoteHash = await safeHash(blob);
    this.lastRemoteUpdatedAt = meta.updatedAt;
    return true;
  }

  async pullState(){
    if (!this.passphrase) throw new Error("Vault locked (no passphrase).");
    const row = await this.getRemote();
    if (!row) return null;

    const blob = row.blob;
    this.lastRemoteHash = await safeHash(blob);
    const metaUpdated = row.meta?.updatedAt ? Number(row.meta.updatedAt) : null;
    this.lastRemoteUpdatedAt = metaUpdated;
    this.lastPullAt = Date.now();

    const payload = JSON.parse(atob(blob));
    const state = await decryptJSON(this.passphrase, payload);
    return ensureState(state);
  }

  // v2.5: list encrypted snapshots for recovery/restore
  async listRemoteVersions(limit = 10){
    const table = CONFIG.VAULT_VERSIONS_TABLE;
    if (!table) return [];
    const { data, error } = await this.sb.from(table)
      .select("created_at,app_version,meta")
      .eq("user_id", this.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  // v2.5: pull a specific snapshot by created_at (ISO string)
  async pullVersion(createdAt){
    if (!this.passphrase) throw new Error("Vault locked (no passphrase).");
    const table = CONFIG.VAULT_VERSIONS_TABLE;
    if (!table) throw new Error("Vault versions not enabled.");
    const { data, error } = await this.sb.from(table)
      .select("blob")
      .eq("user_id", this.user.id)
      .eq("created_at", createdAt)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const payload = JSON.parse(atob(data.blob));
    const state = await decryptJSON(this.passphrase, payload);
    return ensureState(state);
  }

  /**
   * Compare local vs remote for LWW/conflict.
   * @returns { action: 'use_local'|'use_remote'|'conflict'|'no_remote', remoteUpdatedAt:number|null }
   */

  buildConflictPreview(localState, remoteState){
    try{
      const localUpdatedAt = Number(localState.updatedAt||0);
      const remoteUpdatedAt = Number(remoteState.updatedAt||0);
      const localTasks = Array.isArray(localState.tasks)? localState.tasks.length:0;
      const remoteTasks = Array.isArray(remoteState.tasks)? remoteState.tasks.length:0;
      const localEvents = Array.isArray(localState.audit?.events)? localState.audit.events.length:0;
      const remoteEvents = Array.isArray(remoteState.audit?.events)? remoteState.audit.events.length:0;

      const localTitles = new Set((localState.tasks||[]).map(t=>String(t.title||'').trim()).filter(Boolean));
      const remoteTitles = new Set((remoteState.tasks||[]).map(t=>String(t.title||'').trim()).filter(Boolean));
      let diff=0;
      for (const t of localTitles) if (!remoteTitles.has(t)) diff++;
      for (const t of remoteTitles) if (!localTitles.has(t)) diff++;

      const localDone = (localState.tasks||[]).filter(t=>t.status==='Done').length;
      const remoteDone = (remoteState.tasks||[]).filter(t=>t.status==='Done').length;

      return {
        localUpdatedAt, remoteUpdatedAt,
        localTasks, remoteTasks,
        localEvents, remoteEvents,
        taskTitleDiff: diff,
        doneCountDiff: Math.abs(localDone-remoteDone)
      };
    }catch(_e){
      return null;
    }
  }

  async compare(localState, lastSyncMarkerMs){
    const row = await this.getRemote();
    if (!row) return { action: "no_remote", remoteUpdatedAt: null };

    const remoteUpdatedAt = row.meta?.updatedAt ? Number(row.meta.updatedAt) : null;
    const localUpdatedAt = Number(localState.updatedAt || 0);

    // If we have no marker, pick newest
    if (!lastSyncMarkerMs){
      return { action: (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt) ? "use_remote" : "use_local", remoteUpdatedAt };
    }

    const localChanged = localUpdatedAt > lastSyncMarkerMs;
    const remoteChanged = (remoteUpdatedAt || 0) > lastSyncMarkerMs;

    if (localChanged && remoteChanged){
      // both changed since last sync -> conflict
      // LWW default: newest wins, but report conflict so UI can alert.
      const newest = (remoteUpdatedAt || 0) >= localUpdatedAt ? "use_remote" : "use_local";
      return { action: "conflict", remoteUpdatedAt, newest };
    }

    if (remoteChanged && !localChanged) return { action: "use_remote", remoteUpdatedAt };
    if (localChanged && !remoteChanged) return { action: "use_local", remoteUpdatedAt };

    return { action: "use_local", remoteUpdatedAt }; // no changes
  }
}
