import { CONFIG } from "../config.js";

function getOrCreateDeviceId(){
  const key = "lifeos_device_id_v2";
  let id = localStorage.getItem(key);
  if (!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2));
    localStorage.setItem(key, id);
  }
  return id;
}

export function currentDevice(){
  const id = getOrCreateDeviceId();
  return {
    device_id: id,
    label: localStorage.getItem("lifeos_device_label_v2") || "This device",
    user_agent: navigator.userAgent,
    platform: navigator.platform || "",
  };
}

export function setDeviceLabel(label){
  localStorage.setItem("lifeos_device_label_v2", label || "This device");
}

export async function upsertDevice(sb, user){
  const d = currentDevice();
  const row = {
    user_id: user.id,
    device_id: d.device_id,
    label: d.label,
    user_agent: d.user_agent,
    platform: d.platform,
    last_seen: new Date().toISOString(),
    revoked: false,
    revoked_at: null,
  };
  const { error } = await sb.from(CONFIG.DEVICE_TABLE).upsert(row, { onConflict: "user_id,device_id" });
  if (error) throw error;
  return d;
}

export async function touchDevice(sb, user){
  const d = currentDevice();
  const { error } = await sb.from(CONFIG.DEVICE_TABLE)
    .update({ last_seen: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("device_id", d.device_id);
  if (error) throw error;
}

export async function listDevices(sb, user){
  const { data, error } = await sb.from(CONFIG.DEVICE_TABLE)
    .select("device_id,label,platform,user_agent,last_seen,revoked,revoked_at")
    .eq("user_id", user.id)
    .order("last_seen", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteDevice(sb, user, deviceId){
  const { error } = await sb.from(CONFIG.DEVICE_TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("device_id", deviceId);
  if (error) throw error;
  return true;
}

export async function revokeDevice(sb, user, deviceId){
  const { error } = await sb.from(CONFIG.DEVICE_TABLE)
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("device_id", deviceId);
  if (error) throw error;
  return true;
}

export async function assertDeviceNotRevoked(sb, user){
  const d = currentDevice();
  const { data, error } = await sb.from(CONFIG.DEVICE_TABLE)
    .select("revoked")
    .eq("user_id", user.id)
    .eq("device_id", d.device_id)
    .maybeSingle();
  if (error) throw error;
  if (data && data.revoked){
    const err = new Error("DEVICE_REVOKED");
    err.code = "DEVICE_REVOKED";
    throw err;
  }
}
