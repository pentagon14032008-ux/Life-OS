import { CONFIG } from "./config.js";

export async function fetchVersionFile() {
  // Always bypass caches (critical for security + force updates)
  const res = await fetch(`./version.json?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("version.json fetch failed");
  return await res.json();
}

export async function fetchChannelMeta(channel = "stable") {
  const file = await fetchVersionFile();
  // Support both old + new formats
  if (file?.releases && file.releases[channel]) {
    return { ...file.releases[channel], channel };
  }
  return {
    version: file.version,
    build: file.build,
    notes: file.notes,
    force_min_version: file.force_min_version,
    channel: file.channel || "stable",
  };
}

export function compareVersion(a, b){
  // semver-ish: "2.1.0"
  const pa = String(a).split(".").map(n=>parseInt(n,10)||0);
  const pb = String(b).split(".").map(n=>parseInt(n,10)||0);
  for (let i=0;i<Math.max(pa.length,pb.length);i++){
    const da = pa[i]||0, db = pb[i]||0;
    if (da>db) return 1;
    if (da<db) return -1;
  }
  return 0;
}

export function startUpdateChecks(currentVersion, channel, onUpdate){
  const interval = Math.max(5, CONFIG.UPDATE_CHECK_INTERVAL_MIN) * 60 * 1000;
  const tick = async () => {
    try{
      const v = await fetchChannelMeta(channel);
      if (v?.version && compareVersion(v.version, currentVersion) > 0){
        onUpdate(v);
      }
    }catch(_e){}
  };
  tick();
  return setInterval(tick, interval);
}