import { sha256Hex } from "./sha256.js";

function stableStringify(obj){
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function verifyAudit(audit){
  if (!audit || !Array.isArray(audit.events)) return { ok: true, badIndex: null };
  const evs = audit.events;
  let prev = null;
  for (let i=0;i<evs.length;i++){
    const e = evs[i];
    if ((e.prevHash ?? null) !== (prev ?? null)) return { ok:false, badIndex:i };
    const data = (prev || "") + "|" + e.timestamp + "|" + e.type + "|" + (e.entityId || "") + "|" + stableStringify(e.payload);
    const h = sha256Hex(data);
    if (h !== e.hash) return { ok:false, badIndex:i };
    prev = e.hash;
  }
  return { ok:true, badIndex:null };
}
