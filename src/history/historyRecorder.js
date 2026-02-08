import { sha256Hex } from "./sha256.js";

function uid(prefix="e"){
  return prefix + "_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function stableStringify(obj){
  // deterministic stringify for hashing
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function initAudit(state){
  if (!state.audit || typeof state.audit !== "object"){
    state.audit = { events: [], ok: true, badIndex: null, lastCheckedAt: null };
  }
  if (!Array.isArray(state.audit.events)) state.audit.events = [];
  if (state.audit.ok == null) state.audit.ok = true;
  return state;
}

export function recordEvent(state, { type, entity="task", entityId=null, payload={}, deviceId=null, appVersion=null }){
  initAudit(state);
  const events = state.audit.events;

  const ts = Date.now();
  const prevHash = events.length ? events[events.length-1].hash : null;

  const event = {
    id: uid("ev"),
    type: String(type),
    entity: String(entity),
    entityId: entityId ? String(entityId) : null,
    deviceId: deviceId ? String(deviceId) : null,
    appVersion: appVersion ? String(appVersion) : null,
    payload,
    timestamp: ts,
    prevHash,
    hash: ""
  };

  const data = (prevHash || "") + "|" + ts + "|" + event.type + "|" + (event.entityId || "") + "|" + (event.deviceId || "") + "|" + (event.appVersion || "") + "|" + stableStringify(payload);
  event.hash = sha256Hex(data);

  events.push(event);

  // keep a light "history" list for legacy UI (optional)
  if (!Array.isArray(state.history)) state.history = [];
  state.history.unshift({ t: ts, type: event.type, meta: { entityId: event.entityId } });

  return event;
}
