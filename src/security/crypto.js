/**
 * LifeOS Vault crypto:
 * - PBKDF2 -> AES-GCM key
 * - AES-GCM encrypt/decrypt JSON payload
 * - HMAC for integrity (optional, via separate key)
 */
function toB64(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
async function pbkdf2(pass, saltB64, iters=210000) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const salt = saltB64 ? new Uint8Array(fromB64(saltB64)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations: iters, hash:"SHA-256" },
    keyMat,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt","decrypt"]
  );
  return { key, saltB64: toB64(salt), iters };
}
export async function encryptJSON(passphrase, obj, params) {
  const { key, saltB64, iters } = await pbkdf2(passphrase, params?.saltB64, params?.iters ?? 210000);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, plaintext);
  return {
    v: 1,
    iters,
    saltB64,
    ivB64: toB64(iv),
    ctB64: toB64(ct),
  };
}
export async function decryptJSON(passphrase, payload) {
  const { key } = await pbkdf2(passphrase, payload.saltB64, payload.iters);
  const iv = new Uint8Array(fromB64(payload.ivB64));
  const ct = fromB64(payload.ctB64);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ct);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(pt));
}
export function safeHash(str){
  // Not a secret hash: used for local change detection & UI only
  const enc = new TextEncoder().encode(str);
  return crypto.subtle.digest("SHA-256", enc).then(buf => {
    const arr = new Uint8Array(buf);
    return Array.from(arr).map(b=>b.toString(16).padStart(2,"0")).join("");
  });
}