import { CONFIG } from "./config.js";
import { makeSupabase } from "./sync/supabaseClient.js";
import { VaultSync } from "./sync/vaultSync.js";
import { DEFAULT_STATE } from "./engine/store.js";
import { ensureState, addTask, editTask, deleteTask, markDone, undoEdit, redoEdit, runAutoFail, addTemplate, renameTemplate, deleteTemplate, createTaskFromTemplate } from "./engine/engine.js";
import { verifyAudit } from "./history/historyVerifier.js";
import { encryptJSON } from "./security/crypto.js";
import { renderHome, renderTasks, renderAnalytics, renderTimeline, renderVault, renderSettings, renderNotifications, renderTemplates } from "./ui/views.js";
import { drawXpChart } from "./ui/chart.js";
import { startUpdateChecks, fetchChannelMeta, compareVersion } from "./updater.js";
import { APP_VERSION, APP_BUILD } from "./version.js";
import { currentDevice, setDeviceLabel, upsertDevice, listDevices, revokeDevice, assertDeviceNotRevoked } from "./sync/deviceManager.js";

const els = {
  view: document.getElementById("view"),
  statusLine: document.getElementById("statusLine"),
  verBadge: document.getElementById("verBadge"),
  integrityPill: document.getElementById("integrityPill"),
  restrictedPill: document.getElementById("restrictedPill"),
  sideStatus: document.getElementById("sideStatus"),
  buildLine: document.getElementById("buildLine"),
  syncPill: document.getElementById("syncPill"),
  toast: document.getElementById("toast"),
  btnLock: document.getElementById("btnLock"),
  btnSignOut: document.getElementById("btnSignOut"),

  authModal: document.getElementById("authModal"),
  authEmail: document.getElementById("authEmail"),
  authPass: document.getElementById("authPass"),
  vaultPass: document.getElementById("vaultPass"),
  btnLogin: document.getElementById("btnLogin"),
  btnSignup: document.getElementById("btnSignup"),
  btnUnlock: document.getElementById("btnUnlock"),
  btnCreateVault: document.getElementById("btnCreateVault"),
  vaultStateLine: document.getElementById("vaultStateLine"),

  updateModal: document.getElementById("updateModal"),
  updateNotes: document.getElementById("updateNotes"),
  btnApplyUpdate: document.getElementById("btnApplyUpdate"),
  btnLaterUpdate: document.getElementById("btnLaterUpdate"),
};

let route = "home";

// Task view state (v2.2)
let taskUI = { q:"", status:"All", priority:"All", tag:"", sort:"updated", selected:new Set(), limit: 250 };
let histUI = { type:"All", q:"", from:"", to:"" };
let state = DEFAULT_STATE();
let sb = null;
let vault = null;
let vaultLocked = true;
let currentVaultPass = null;
let lastSync = null;
let idleTimer = null;
let updateLocked = false;
let creatorUnlocked = sessionStorage.getItem("lifeos_creator_unlocked")==="1";

let updateTimer = null;
let restricted = false;

const LOCAL_VERSION = APP_VERSION;
const LOCAL_BUILD = APP_BUILD;

// Local cache (encrypted sync is authoritative)
function loadLocal(){
  try{
    const raw = localStorage.getItem("lifeos_local_cache_v2");
    if (!raw) return;
    state = ensureState(JSON.parse(raw));
  
  try{ state.device = currentDevice(); }catch(_e){}
}catch(_e){}
}
function saveLocal(){
  try{ localStorage.setItem("lifeos_local_cache_v2", JSON.stringify(state)); }catch(_e){}
}


function loadSyncMarker(){
  try{
    const v = localStorage.getItem("lifeos_last_sync_marker_ms");
    lastSyncMarkerMs = v ? Number(v) : null;
  }catch(_e){ lastSyncMarkerMs = null; }
}
function markSynced(markerMs){
  lastSyncMarkerMs = markerMs || Date.now();
  try{ localStorage.setItem("lifeos_last_sync_marker_ms", String(lastSyncMarkerMs)); }catch(_e){}
  lastSync = new Date().toISOString().slice(0,16).replace("T"," ");
  setSyncPill("Synced");
}
function onLocalMutation(){
  // Schedule encrypted push to cloud (if possible)
  if (!sb || !vault || vaultLocked || restricted || updateLocked) return;
  schedulePush();
}
function schedulePush(){
  if (pushDebounce) clearTimeout(pushDebounce);
  pushDebounce = setTimeout(()=>{ tryPush().catch(()=>{}); }, CONFIG.SYNC_DEBOUNCE_MS);
}
async function tryPush(){
  if (!netOnline){ setSyncPill('Offline'); return; }
  if (!state.user.userId) return;
  // if conflict pending, do not overwrite
  if (pendingConflict) return setSyncPill("Conflict");
  setSyncPill("Syncing…");
  await vault.pushState(state);
  markSynced(state.updatedAt || Date.now());
}
async function pollRemote(){
  if (!netOnline) return;
  if (!sb || !vault || vaultLocked || restricted || updateLocked || !state.user.userId) return;
  if (pendingConflict) return;
  try{
    const cmp = await vault.compare(state, lastSyncMarkerMs);
    if (cmp.action === "use_remote"){
      const remoteState = await vault.pullState();
      if (remoteState){
        state = ensureState(remoteState);
        saveLocal();
        markSynced(state.updatedAt || Date.now());
        toast("Pulled latest from cloud.");
        render();
      }
    } else if (cmp.action === "conflict"){
      try{
        const remoteState = await vault.pullState();
        const preview = remoteState ? vault.buildConflictPreview(state, remoteState) : null;
        pendingConflict = { newest: cmp.newest, remoteUpdatedAt: cmp.remoteUpdatedAt, preview };
      }catch(_e){
        pendingConflict = { newest: cmp.newest, remoteUpdatedAt: cmp.remoteUpdatedAt, preview: null };
      }
      setSyncPill("Conflict");
      render();
    }
  }catch(e){
    console.warn("pollRemote error", e);
  }
}


function recomputeIntegrity(){
  try{
    const r = verifyAudit(state.audit);
    if (!state.audit) state.audit = { events: [], ok: true, badIndex: null, lastCheckedAt: null };
    state.audit.ok = r.ok;
    state.audit.badIndex = r.badIndex;
    state.audit.lastCheckedAt = Date.now();
    restricted = (state.settings?.integrityEnabled !== false) && !r.ok;
  }catch(_e){
    restricted = false;
  }
}

// Global keyboard shortcuts (v2.7)
function registerShortcuts(){
  window.addEventListener('keydown', (e)=>{
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;

    // Ctrl+K or / => focus search (Tasks)
    if ((e.ctrlKey && (e.key === 'k' || e.key === 'K')) || (!typing && e.key === '/')){
      e.preventDefault();
      route = 'tasks';
      render();
      setTimeout(()=>document.getElementById('fQuery')?.focus(), 0);
      return;
    }

    if (typing) return;

    // N => new task (Tasks)
    if (e.key === 'n' || e.key === 'N'){
      route = 'tasks';
      render();
      setTimeout(()=>document.getElementById('tTitle')?.focus(), 0);
      return;
    }

    // G H/T/A/S/V => quick navigation
    if (e.key === 'g' || e.key === 'G') { route='home'; render(); return; }
    if (e.key === 't' || e.key === 'T') { route='tasks'; render(); return; }
    if (e.key === 'a' || e.key === 'A') { route='analytics'; render(); return; }
    if (e.key === 'h' || e.key === 'H') { route='timeline'; render(); return; }
    if (e.key === 's' || e.key === 'S') { route='settings'; render(); return; }
    if (e.key === 'v' || e.key === 'V') { route='vault'; render(); return; }

    // Ctrl+Shift+L => lock
    if (e.ctrlKey && e.shiftKey && (e.key === 'l' || e.key === 'L')){
      e.preventDefault();
      if (!vaultLocked) {
        vaultLocked = true;
        currentVaultPass = null;
        toast('Locked.');
        openAuth();
        render();
      }
    }
  });
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(msg, actions=[]){
  const wrap = document.createElement("div");
  wrap.className = "msg";
  wrap.innerHTML = `<div>${msg}</div>`;
  const right = document.createElement("div");
  right.className = "row";
  for (const a of actions){
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = a.label;
    b.onclick = a.onClick;
    right.appendChild(b);
  }
  wrap.appendChild(right);
  els.toast.appendChild(wrap);
  try{
    if (state?.settings?.notificationsEnabled){
      state.notifications = state.notifications || [];
      state.notifications.unshift({ id:"n_"+Math.random().toString(16).slice(2), t: Date.now(), level:"info", title:String(msg).slice(0,60), body:String(msg) });
      state.notifications = state.notifications.slice(0,50);
      saveLocal();
    }
  }catch(_e){}
  setTimeout(()=>wrap.remove(), 7000);
}

function setWallpaper(){
  if (state.settings.wallpaper){
    document.body.style.backgroundImage = `url(${state.settings.wallpaper})`;
  } else {
    document.body.style.backgroundImage = "none";
  }
}

function setStatus(text){
  els.statusLine.textContent = text;
}

function setSyncPill(text){
  els.syncPill.textContent = "Sync: " + text;
}

async function enforceMandatoryUpdate(){
  // Only after account is known (login), as requested.
  if (!state.user.userId) return;

  let meta;
  try{
    meta = await fetchChannelMeta(state.settings.updateChannel || "stable");
  }catch(_e){
    // If we can't reach version file, don't lock (offline).
    return;
  }

  const min = meta.force_min_version || meta.version;
  if (min && compareVersion(LOCAL_VERSION, min) < 0){
    updateLocked = true;
    setStatus("Update required.");
    // Force update modal (no 'Later')
    openUpdate({ ...meta, force: true, notes: meta.notes || "" });
    render();
  } else {
    updateLocked = false;
  }
}

function openAuth(){
  els.authModal.classList.remove("hidden");
}
function closeAuth(){
  els.authModal.classList.add("hidden");
}
function openUpdate(v){
  const isForced = !!v.force;
  els.updateNotes.textContent = `New version: ${v.version} — ${v.notes || ""}`;
  // Force update: hide "Later" and prevent closing.
  els.btnLaterUpdate.style.display = isForced ? "none" : "inline-flex";
  els.updateModal.classList.remove("hidden");
}
function closeUpdate(){
  els.updateModal.classList.add("hidden");
}

async function init(){
  // register SW
  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(_e){}
  }

  // keyboard shortcuts
  registerShortcuts();

  loadLocal();
  loadSyncMarker();
  recomputeIntegrity();

  // defaults for new settings fields
  state.settings.updateChannel = state.settings.updateChannel || "stable";

  // show local build info immediately
  els.verBadge.textContent = "v" + LOCAL_VERSION;
  els.buildLine.textContent = `build: ${LOCAL_BUILD} • channel: ${state.settings.updateChannel}`;

  // fetch remote channel meta (for display only)
  try{
    const meta = await fetchChannelMeta(state.settings.updateChannel);
    if (meta?.version){
      els.buildLine.textContent = `build: ${LOCAL_BUILD} • channel: ${state.settings.updateChannel} • latest: ${meta.version}`;
    }
  }catch(_e){}

  // start update checks
  updateTimer = startUpdateChecks(LOCAL_VERSION, state.settings.updateChannel, (v)=> openUpdate(v));

  // init supabase
  try{
    sb = makeSupabase();
    vault = new VaultSync(sb);
  }catch(e){
    setStatus("Supabase not configured. Edit src/config.js");
    toast("Supabase konfiguratsiya qilinmagan: src/config.js", [
      {label:"OK", onClick:()=>{}}
    ]);
  }

  // nav
  for (const b of document.querySelectorAll(".navbtn")){
    b.addEventListener("click", ()=>{
      for (const x of document.querySelectorAll(".navbtn")) x.classList.remove("active");
      b.classList.add("active");
      route = b.dataset.route;
      render();
    });
  }

  // update modal buttons
  els.btnApplyUpdate.onclick = async ()=>{
    closeUpdate();
    // tell SW to update (if present)
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting){
        reg.waiting.postMessage({type:"SKIP_WAITING"});
      }
    }catch(_e){}
    location.reload(true);
  };
  els.btnLaterUpdate.onclick = closeUpdate;

  // auth actions
  els.btnLogin.onclick = ()=>doLogin(false);
  els.btnSignup.onclick = ()=>doLogin(true);
  els.btnUnlock.onclick = unlockVault;
  els.btnCreateVault.onclick = createVault;

  els.btnLock.onclick = ()=>{
    vaultLocked = true;
    vault.setPassphrase(null);
      currentVaultPass = null;
    setStatus("Vault locked.");
    openAuth();
  };
  els.btnSignOut.onclick = async ()=>{
    try{ await sb?.auth.signOut(); }catch(_e){}
    state.user = { email:null, userId:null };
    vaultLocked = true;
    vault.setPassphrase(null);
      currentVaultPass = null;
    saveLocal();
    openAuth();
    setStatus("Signed out.");
  };

  // session
  if (sb){
    const { data } = await sb.auth.getSession();
    if (data?.session?.user){
      onSignedIn(data.session.user);
    } else {
      openAuth();
      setStatus("Please login.");
    }

    sb.auth.onAuthStateChange((_event, session)=>{
      if (session?.user) onSignedIn(session.user);
      else {
        state.user = { email:null, userId:null };
        vaultLocked = true;
        openAuth();
      }
      saveLocal();
      onLocalMutation();
      render();
    });
  }

  // auto-fail tick
  setInterval(()=>{
    const next = runAutoFail(state);
    if (next.updatedAt !== state.updatedAt){
      state = next;
      saveLocal();
      onLocalMutation();
      render();
    }
  }, 15_000);

  // idle lock
  resetIdleLock();
  ["mousemove","keydown","mousedown","touchstart"].forEach(ev=>{
    window.addEventListener(ev, resetIdleLock, {passive:true});
  });

  setWallpaper();
  render();
}

function resetIdleLock(){
  clearTimeout(idleTimer);
  const min = Math.max(1, Number(state.settings.idleLockMin || CONFIG.IDLE_LOCK_MIN));
  idleTimer = setTimeout(()=>{
    if (!vaultLocked){
      vaultLocked = true;
      vault.setPassphrase(null);
      currentVaultPass = null;
      toast("Idle lock: vault locked.");
      openAuth();
    }
  }, min*60*1000);
}

async function doLogin(isSignup){
  if (!sb) return;
  const email = els.authEmail.value.trim();
  const password = els.authPass.value;
  if (!email || !password){
    toast("Email va account password kerak.");
    return;
  }

// v3.0: simple client-side rate limit (adds friction against bruteforce)
const rlKey = "lifeos_login_rl_v3";
try{
  const now = Date.now();
  const winMs = 10*60*1000; // 10 min window
  const max = 6;
  const raw = localStorage.getItem(rlKey);
  const arr = raw ? JSON.parse(raw) : [];
  const fresh = Array.isArray(arr) ? arr.filter(t=> (now - Number(t||0)) < winMs) : [];
  if (!isSignup && fresh.length >= max){
    const waitMs = winMs - (now - fresh[0]);
    const waitMin = Math.ceil(waitMs/60000);
    toast(`Too many login attempts. Wait ~${waitMin} min and try again.`);
    setStatus("Rate limited.");
    return;
  }
  if (!isSignup){
    fresh.push(now);
    localStorage.setItem(rlKey, JSON.stringify(fresh));
  }
}catch(_e){}
  setStatus("Auth…");
  try{
    if (isSignup){
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      toast("Signup OK. Endi login qiling (agar email confirmation yoqilgan bo‘lsa, emailni tasdiqlang).");
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.user) onSignedIn(data.user);
    }
  }catch(e){
    toast("Auth error: " + (e?.message || e));
    setStatus("Auth failed.");
  }
}

function onSignedIn(user){
  state.user.email = user.email;
  state.user.userId = user.id;
  vault.setUser(user);
  setStatus("Signed in: " + (user.email||""));
  setSyncPill("Ready");
  try{ state.device = currentDevice(); }catch(_e){}

  // v2.5: register device + session guard (revoke support)
  (async ()=>{
    try{
      await upsertDevice(sb, user);
      await assertDeviceNotRevoked(sb, user);
    }catch(e){
      if (e?.code === "DEVICE_REVOKED" || e?.message === "DEVICE_REVOKED"){
        toast("This device has been revoked. Signing out.");
        try{ await sb.auth.signOut(); }catch(_e){}
        state = DEFAULT_STATE();
        vaultLocked = true;
        openAuth();
        render();
        return;
      }
    }
  })();
  els.vaultStateLine.textContent = vaultLocked ? "Vault: Locked" : "Vault: Unlocked";

  // Mandatory update gate (runs every login)
  enforceMandatoryUpdate().catch(()=>{});
}

async function unlockVault(){
  if (updateLocked) return toast("Update required. Please update to continue.");
  if (!sb) return;
  if (!state.user.userId){
    toast("Avval login qiling.");
    return;
  }
  const pass = els.vaultPass.value;
  if (!pass){
    toast("Vault passphrase kiriting.");
    return;
  }
  vault.setPassphrase(pass);
  currentVaultPass = pass;
  setStatus("Unlocking vault…");
  try{
    // Decide how to sync on unlock (LWW + conflict alert)
    const cmp = await vault.compare(state, lastSyncMarkerMs);
    if (cmp.action === "no_remote"){
      vaultLocked = false;
      closeAuth();
      toast("Vault unlocked. Cloud empty (local only).");
      setSyncPill("Ready");
  try{ state.device = currentDevice(); }catch(_e){}
      // push local to create remote row
      schedulePush();
    } else if (cmp.action === "use_remote"){
      const remote = await vault.pullState();
      if (remote){
        state = ensureState(remote);
        saveLocal();
        vaultLocked = false;
        closeAuth();
        toast("Vault unlocked (latest from cloud).");
        markSynced(state.updatedAt || Date.now());
      }
    } else if (cmp.action === "conflict"){
      try{
        const remoteState = await vault.pullState();
        const preview = remoteState ? vault.buildConflictPreview(state, remoteState) : null;
        pendingConflict = { newest: cmp.newest, remoteUpdatedAt: cmp.remoteUpdatedAt, preview };
      }catch(_e){
        pendingConflict = { newest: cmp.newest, remoteUpdatedAt: cmp.remoteUpdatedAt, preview: null };
      }
      // default: keep local loaded, but force user to resolve in Vault page
      vaultLocked = false;
      closeAuth();
      setSyncPill("Conflict");
      toast("Sync conflict detected. Open Vault to resolve.");
    } else {
      // use_local or no changes
      vaultLocked = false;
      closeAuth();
      toast("Vault unlocked (local).");
      setSyncPill("Ready");
  try{ state.device = currentDevice(); }catch(_e){}
      // if local has changes since marker, push
      if (state.updatedAt && lastSyncMarkerMs && state.updatedAt > lastSyncMarkerMs) schedulePush();
    }
  }catch(e){
    toast("Vault unlock failed: " + (e?.message || e));
    setStatus("Vault unlock failed.");
  }
  render();
}

async function createVault(){
  if (updateLocked) return toast("Update required. Please update to continue.");
  if (!sb) return;
  if (!state.user.userId){
    toast("Avval login qiling.");
    return;
  }
  const pass = els.vaultPass.value;
  if (!pass){
    toast("Vault passphrase kiriting.");
    return;
  }
  vault.setPassphrase(pass);
  currentVaultPass = pass;
  vaultLocked = false;
  // create fresh vault state but keep user info
  const fresh = DEFAULT_STATE();
  fresh.user.email = state.user.email;
  fresh.user.userId = state.user.userId;
  state = fresh;
  saveLocal();
  try{
    await vault.pushState(state);
    lastSync = new Date().toISOString().slice(0,16).replace("T"," ");
    setSyncPill("Synced");
    closeAuth();
    toast("New vault created & synced.");
  }catch(e){
    toast("Create vault failed: " + (e?.message || e));
  }
  render();
}

function render(){
  state.creatorUnlocked = creatorUnlocked;

  // v2.2.1 integrity UI
  els.integrityPill && (els.integrityPill.textContent = restricted ? 'Integrity: VIOLATION' : 'Integrity: OK');
  if (els.restrictedPill) els.restrictedPill.style.display = restricted ? 'inline-flex' : 'none';
  setWallpaper();

  // Hard gate: when a mandatory update is required, block the app.
  if (updateLocked){
    els.view.innerHTML = `
      <div class="card">
        <h3>Update required</h3>
        <div class="small">To continue using LifeOS, you must install the latest update.</div>
        <div style="margin-top:12px" class="row">
          <button class="btn" id="btnForceUpdate">Update now</button>
        </div>
      </div>
    `;
    document.getElementById("btnForceUpdate")?.addEventListener("click", ()=>{
      // Show forced modal (keeps UX consistent)
      openUpdate({ version: "latest", notes: "Update required", force: true });
    });
    // Disable header actions
    els.btnLock.disabled = true;
    els.btnSignOut.disabled = false; // allow sign out
    return;
  }
  // header buttons visibility
  els.btnLock.disabled = !state.user.userId;
  els.btnSignOut.disabled = !state.user.userId;

  const vaultInfo = { locked: vaultLocked, lastSync, conflict: !!pendingConflict, conflictInfo: pendingConflict, online: netOnline };

  if (route === "home") els.view.innerHTML = renderHome(state);
  if (route === "tasks") els.view.innerHTML = renderTasks(state, taskUI);
  if (route === "templates") els.view.innerHTML = renderTemplates(state);
  if (route === "analytics") els.view.innerHTML = state.settings.analyticsEnabled ? renderAnalytics(state) : `<div class="card"><h3>Statistics & Analytics</h3><div class="small">Analytics hozir OFF. Settings → Analytics ON qiling.</div></div>`;
  if (route === "notifications") els.view.innerHTML = renderNotifications(state);
  if (route === "timeline") els.view.innerHTML = renderTimeline(state);
  if (route === "vault") els.view.innerHTML = renderVault(state, vaultInfo);
  if (route === "settings") els.view.innerHTML = renderSettings(state);

  // wire actions per page
  if (route === "home"){
    const btn = document.getElementById("btnQuickAdd");
    btn?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      const title = document.getElementById("qaTitle").value;
      const section = document.getElementById("qaSection").value;
      const due = document.getElementById("qaDue").value;
      const notes = document.getElementById("qaNotes").value;
      if (!title.trim()) return toast("Title kerak.");
      const dueAt = due ? new Date(due).getTime() : null;
      state = addTask(state, {title, section, notes, dueAt});
      saveLocal();
      onLocalMutation();
      render();
    });
  }

  if (route === "tasks"){
    // filters
    const qEl = document.getElementById("fQuery");
    const stEl = document.getElementById("fStatus");
    const prEl = document.getElementById("fPriority");
    const tagEl = document.getElementById("fTag");
    const sortEl = document.getElementById("fSort");

    qEl?.addEventListener("input", ()=>{ taskUI.q = qEl.value; render(); });
    stEl?.addEventListener("change", ()=>{ taskUI.status = stEl.value; render(); });
    prEl?.addEventListener("change", ()=>{ taskUI.priority = prEl.value; render(); });
    tagEl?.addEventListener("input", ()=>{ taskUI.tag = tagEl.value; render(); });
    sortEl?.addEventListener("change", ()=>{ taskUI.sort = sortEl.value; render(); });

    
// templates
document.getElementById("btnAddFromTpl")?.addEventListener("click", ()=>{
  if (vaultLocked) return toast("Vault locked. Unlock first.");
  const sel = document.getElementById("tplSelect")?.value;
  if (!sel) return toast("Template tanlang.");
  state = createTaskFromTemplate(state, sel);
  saveLocal(); onLocalMutation(); render();
  toast("Task template’dan yaratildi.");
});
document.getElementById("btnOpenTplManager")?.addEventListener("click", ()=>{
      route = "templates";
      for (const x of document.querySelectorAll(".navbtn")) x.classList.remove("active");
      document.querySelector(`.navbtn[data-route="templates"]`)?.classList.add("active");
      render();
    });

// virtual list: load more
document.getElementById("btnLoadMore")?.addEventListener("click", ()=>{
  taskUI.limit = (taskUI.limit || 250) + (state.settings.performanceMode ? 120 : 250);
  render();
});

// selection
    taskUI.selected = taskUI.selected || new Set();
    els.view.querySelectorAll("input[data-sel]").forEach(chk=>{
      chk.addEventListener("change", ()=>{
        const id = chk.dataset.sel;
        if (chk.checked) taskUI.selected.add(id);
        else taskUI.selected.delete(id);
      });
    });

    document.getElementById("btnUndo")?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      state = undoEdit(state); saveLocal(); render();
    });
    document.getElementById("btnRedo")?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      state = redoEdit(state); saveLocal(); render();
    });

    document.getElementById("btnBulkDone")?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      const ids = Array.from(taskUI.selected || []);
      if (!ids.length) return toast("Select tasks first.");
      for (const id of ids) state = markDone(state, id);
      taskUI.selected.clear();
      saveLocal(); render();
    });

    document.getElementById("btnBulkDel")?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      const ids = Array.from(taskUI.selected || []);
      if (!ids.length) return toast("Select tasks first.");
      for (const id of ids) state = deleteTask(state, id);
      taskUI.selected.clear();
      saveLocal(); render();
    });

    // add task
    document.getElementById("btnAddTask")?.addEventListener("click", ()=>{
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      const title = document.getElementById("tTitle").value;
      const due = document.getElementById("tDue").value;
      const notes = document.getElementById("tNotes").value;
      const priority = document.getElementById("tPriority").value;
      const tags = document.getElementById("tTags").value;
      const subtasks = document.getElementById("tSubtasks").value;
      if (!title.trim()) return toast("Title kerak.");
      const dueAt = due ? new Date(due).getTime() : null;
      const rep = document.getElementById("tRepeat")?.value || "none";
      const repInt = document.getElementById("tRepeatInt")?.value || 1;
      const recurring = (rep && rep!=="none") ? { freq: rep, interval: repInt } : null;
      state = addTask(state, {title, notes, dueAt, priority, tags, subtasks, recurring});
      saveLocal();
      onLocalMutation();
      render();
    });

    // row actions
    els.view.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if (vaultLocked) return toast("Vault locked. Unlock first.");
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act==="done"){
          state = markDone(state, id);
          saveLocal(); render();
        }
        if (act==="del"){
          state = deleteTask(state, id);
          saveLocal(); render();
        }
        if (act==="edit"){
          openEditModal(id);
        }
      });
    });
  }

  if (route === "analytics"){
  const c = document.getElementById("xpChart");
  if (c) drawXpChart(c, state);

  const btnCsv = document.getElementById("btnExportCsv");
  const btnPdf = document.getElementById("btnExportPdf");

  btnCsv?.addEventListener("click", ()=>{
    if (restricted) return toast("Restricted Mode. Export blocked.");
    if (state.settings.integrityEnabled && state.audit && state.audit.ok === false) return toast("Integrity violation. Export blocked.");
    try{
      const csv = buildAnalyticsCsv(state);
      downloadText(csv, `lifeos-analytics-${new Date().toISOString().slice(0,10)}.csv`, "text/csv");
      toast("CSV exported.");
    }catch(e){
      toast("CSV export failed: " + (e?.message||e));
    }
  });

  btnPdf?.addEventListener("click", ()=>{
    if (restricted) return toast("Restricted Mode. Export blocked.");
    if (state.settings.integrityEnabled && state.audit && state.audit.ok === false) return toast("Integrity violation. Export blocked.");
    try{
      exportAnalyticsPdf();
    }catch(e){
      toast("PDF export failed: " + (e?.message||e));
    }
  });
}


  if (route === "vault"){
    document.getElementById("btnSyncPush")?.addEventListener("click", async ()=>{
      if (vaultLocked) return toast("Vault locked.");
      if (restricted) return toast("Restricted Mode. Sync blocked.");
      if (updateLocked) return toast("Update required.");
      if (pendingConflict) return toast("Resolve conflict first (Vault → choose local/cloud).");
      try{
        setSyncPill("Syncing…");
        await vault.pushState(state);
        markSynced(state.updatedAt || Date.now());
        toast("Pushed to cloud.");
      }catch(e){ toast("Push failed: "+(e?.message||e)); setSyncPill("Error"); }
      render();
    });
    document.getElementById("btnSyncPull")?.addEventListener("click", async ()=>{
      if (vaultLocked) return toast("Vault locked.");
      if (restricted) return toast("Restricted Mode. Sync blocked.");
      if (updateLocked) return toast("Update required.");
      try{
        setSyncPill("Syncing…");
        const remote = await vault.pullState();
        if (remote){
          state = ensureState(remote);
          saveLocal();
          pendingConflict = null;
          markSynced(state.updatedAt || Date.now());
          toast("Pulled from cloud.");
          render();
        } else {
          toast("No remote vault row.");
          setSyncPill("Ready");
  try{ state.device = currentDevice(); }catch(_e){}
        }
      }catch(e){ toast("Pull failed: "+(e?.message||e)); setSyncPill("Error"); }
    });

    // Conflict resolution buttons (shown only when pendingConflict)
    document.getElementById("btnUseLocal")?.addEventListener("click", async ()=>{
      if (!pendingConflict) return;
      // keep local, push to cloud
      pendingConflict = null;
      toast("Keeping local. Pushing…");
      schedulePush();
      render();
    });
    document.getElementById("btnUseRemote")?.addEventListener("click", async ()=>{
      if (!pendingConflict) return;
      toast("Using cloud. Pulling…");
      pendingConflict = null;
      await pollRemote();
      render();
    });


    // v2.5: emergency bundle (encrypted export + integrity report)
    document.getElementById("btnEmergencyBundle")?.addEventListener("click", async ()=>{
      if (vaultLocked) return toast("Vault locked.");
      if (!currentVaultPass) return toast("Vault passphrase not available. Unlock again.");
      try{
        const enc = await encryptJSON(currentVaultPass, state, null);
        const report = {
          exportedAt: new Date().toISOString(),
          appVersion: LOCAL_VERSION,
          build: LOCAL_BUILD,
          integrity: { restricted: !!restricted, lastEventHash: state.audit?.events?.length ? state.audit.events[state.audit.events.length-1].hash : null }
        };
        const bundle = { type: "lifeos_emergency_bundle", report, vault: enc };
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `LifeOS_emergency_${LOCAL_VERSION}_${Date.now()}.json`;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
        toast("Emergency bundle exported.");
      }catch(e){
        toast("Emergency export failed: " + (e?.message||e));
      }
    });


// v3.0: encrypted export (.lifeos.json) with signature + import verification
document.getElementById("btnExport")?.addEventListener("click", async ()=>{
  if (vaultLocked) return toast("Vault locked.");
  if (!currentVaultPass) return toast("Unlock vault again (need passphrase).");
  try{
    const enc = await encryptJSON(currentVaultPass, state, null);
    const meta = {
      type: "lifeos_vault_export",
      exportedAt: new Date().toISOString(),
      appVersion: LOCAL_VERSION,
      build: LOCAL_BUILD,
      user: { email: state.user.email, userId: state.user.userId },
      integrity: { ok: !!state.audit?.ok, restricted: !!restricted, lastEventHash: state.audit?.events?.length ? state.audit.events[state.audit.events.length-1].hash : null }
    };
    const raw = JSON.stringify({ meta, vault: enc });
    const { safeHash } = await import("./security/crypto.js");
    const sig = await safeHash(raw);
    const out = { meta, vault: enc, signature: sig };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `LifeOS_vault_${LOCAL_VERSION}_${Date.now()}.lifeos.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    toast("Vault exported (encrypted).");
  }catch(e){
    toast("Export failed: " + (e?.message||e));
  }
});

document.getElementById("btnImport")?.addEventListener("click", async ()=>{
  if (vaultLocked) return toast("Vault locked.");
  const file = document.getElementById("importFile")?.files?.[0];
  if (!file) return toast("Choose .lifeos.json file first.");
  if (!currentVaultPass) return toast("Unlock vault again (need passphrase).");
  try{
    const txt = await file.text();
    const obj = JSON.parse(txt);
    if (!obj?.vault || !obj?.meta) throw new Error("Invalid export file.");
    const raw = JSON.stringify({ meta: obj.meta, vault: obj.vault });
    const { safeHash, decryptJSON } = await import("./security/crypto.js");
    const calc = await safeHash(raw);
    if (obj.signature && obj.signature !== calc){
      toast("Import blocked: signature mismatch (file may be modified).");
      return;
    }
    const plain = await decryptJSON(currentVaultPass, obj.vault);
    const next = ensureState(plain);
    const r = verifyAudit(next.audit);
    if (!r.ok){
      toast("Import blocked: integrity violation inside vault.");
      return;
    }
    state = next;
    saveLocal();
    pendingConflict = null;
    restricted = false;
    toast("Import OK. Pushing to cloud…");
    onLocalMutation();
    render();
  }catch(e){
    toast("Import failed: " + (e?.message||e));
  }
});

    async function renderSnapshots(){
      const box = document.getElementById("vaultVersions");
      if (!box) return;
      if (!sb || !state.user.userId) return (box.innerHTML = `<div class="small">Login required.</div>`);
      try{
        const list = await vault.listRemoteVersions(10);
        if (!list.length){
          box.innerHTML = `<div class="small">No snapshots yet. Push a few times to create backups.</div>`;
          return;
        }
        box.innerHTML = `<div class="small" style="margin-bottom:8px">Latest snapshots (cloud, encrypted):</div>` + list.map(v=>{
          const t = new Date(v.created_at).toISOString().slice(0,19).replace("T"," ");
          const hint = v.meta?.updatedAt ? new Date(Number(v.meta.updatedAt)).toISOString().slice(0,19).replace("T"," ") : "—";
          return `
            <div class="item">
              <div>
                <div><b>${t}</b> <span class="pill">${escapeHtml(v.app_version||"-")}</span></div>
                <div class="meta">state updatedAt: ${hint}</div>
              </div>
              <div class="actions"><button class="mini" data-restore="${escapeHtml(v.created_at)}">Restore</button></div>
            </div>
          `;
        }).join("");
        box.querySelectorAll('[data-restore]').forEach(btn=>{
          btn.addEventListener('click', async()=>{
            const createdAt = btn.getAttribute('data-restore');
            if (!createdAt) return;
            if (vaultLocked) return toast("Vault locked.");
            if (restricted) return toast("Restricted Mode. Restore blocked.");
            if (!confirm("Restore this snapshot? Local state will be replaced.")) return;
            try{
              setSyncPill("Restoring…");
              const snap = await vault.pullVersion(createdAt);
              if (!snap) return toast("Snapshot not found.");
              state = ensureState(snap);
              saveLocal();
              pendingConflict = null;
              // push restored snapshot to become new remote head
              await vault.pushState(state);
              markSynced(state.updatedAt || Date.now());
              toast("Snapshot restored.");
              setSyncPill("Ready");
  try{ state.device = currentDevice(); }catch(_e){}
              render();
            }catch(e){
              setSyncPill("Error");
              toast("Restore failed: " + (e?.message||e));
            }
          });
        });
      }catch(e){
        box.innerHTML = `<div class="small">Snapshots load failed: ${escapeHtml(e?.message||String(e))}</div>`;
      }
    }

    document.getElementById("btnRefreshVersions")?.addEventListener("click", ()=>{ renderSnapshots(); });
    // auto load when opening vault page
    renderSnapshots();
  }

  if (route === "settings"){

  async function refreshDevicesUI(){
    if (!sb || !state.user.userId) return;
    try{
      const devices = await listDevices(sb, { id: state.user.userId });
      const cur = currentDevice().device_id;
      const box = document.getElementById("deviceList");
      if (!box) return;
      if (!devices.length){
        box.innerHTML = `<div class="small">No devices yet.</div>`;
        return;
      }
      box.innerHTML = devices.map(d=>{
        const isCur = d.device_id === cur;
        const last = d.last_seen ? new Date(d.last_seen).toISOString().slice(0,16).replace("T"," ") : "—";
        const revoked = !!d.revoked;
        const revBadge = revoked ? "<span class='pill danger'>revoked</span>" : "";
        const act = (!isCur && !revoked) ? `<button class="mini danger" data-revoke="${d.device_id}">Revoke</button>` : "";
        return `
          <div class="item ${isCur ? "current" : ""}">
            <div>
              <div><b>${escapeHtml(d.label || "Device")}</b> ${isCur ? "<span class='pill'>current</span>" : ""} ${revBadge}</div>
              <div class="meta">${escapeHtml(d.platform||"")} • ${last}</div>
            </div>
            <div class="meta">${escapeHtml((d.user_agent||"").slice(0,40))}${(d.user_agent||"").length>40?"…":""}</div>
            <div class="actions">${act}</div>
          </div>
        `;
      }).join("");

      box.querySelectorAll("[data-revoke]").forEach(btn=>{
        btn.addEventListener("click", async()=>{
          const id = btn.getAttribute("data-revoke");
          if (!id) return;
          if (!confirm("Revoke this device? It will be signed out.")) return;
          try{
            await revokeDevice(sb, { id: state.user.userId }, id);
            toast("Device revoked.");
            await refreshDevicesUI();
          }catch(e){
            toast("Revoke failed: "+(e?.message||e));
          }
        });
      });

    }catch(e){
      console.warn(e);
      toast("Devices load failed: " + (e?.message||e));
    }
  }

  function applySecurityPreset(preset){
    if (!state.settings) state.settings = {};
    if (preset === "Balanced"){
      state.settings.integrityEnabled = true;
      state.settings.idleLockMin = 10;
      state.settings.analyticsEnabled = true;
      state.settings.notificationsEnabled = true;
      state.settings.performanceMode = false;
    }
    if (preset === "Paranoid"){
      state.settings.integrityEnabled = true;
      state.settings.idleLockMin = 3;
      state.settings.analyticsEnabled = true;
      state.settings.notificationsEnabled = true;
      state.settings.performanceMode = true;
    }
    if (preset === "Performance"){
      state.settings.integrityEnabled = true;
      state.settings.idleLockMin = 20;
      state.settings.analyticsEnabled = true;
      state.settings.notificationsEnabled = false;
      state.settings.performanceMode = true;
    }
  }

  document.getElementById("btnSaveSettings")?.addEventListener("click", ()=>{
    if (vaultLocked) return toast("Vault locked.");

    const preset = document.getElementById("sPreset")?.value || "Custom";
    if (preset !== "Custom") applySecurityPreset(preset);

    const newChannel = document.getElementById("sChannel")?.value || "stable";
    const channelChanged = newChannel !== (state.settings.updateChannel || "stable");
    state.settings.updateChannel = newChannel;
    state.settings.hardMode = document.getElementById("sHard").value;
    state.settings.autoFailMin = Number(document.getElementById("sAutoFail").value || 60);
    state.settings.idleLockMin = Number(document.getElementById("sIdle").value || CONFIG.IDLE_LOCK_MIN);
    state.settings.analyticsEnabled = document.getElementById("sAnalytics").value === "on";
    state.settings.performanceMode = document.getElementById("sPerf")?.value === "on";
    state.settings.notificationsEnabled = document.getElementById("sNotif")?.value !== "off";
    state.settings.integrityEnabled = document.getElementById("sIntegrity")?.value !== "off";

    saveLocal();
    toast("Settings saved.");

    if (channelChanged){
      try{ clearInterval(updateTimer); }catch(_e){}
      updateTimer = startUpdateChecks(LOCAL_VERSION, state.settings.updateChannel, (v)=> openUpdate(v));
      els.buildLine.textContent = `build: ${LOCAL_BUILD} • channel: ${state.settings.updateChannel}`;
    }

    recomputeIntegrity();
    render();
  });

  // Creator / Admin unlock + tools
  document.getElementById("btnUnlockCreator")?.addEventListener("click", ()=>{
    const code = document.getElementById("creatorCode")?.value || "";
    if (code.trim() === "AD5728453"){
      creatorUnlocked = true;
      sessionStorage.setItem("lifeos_creator_unlocked","1");
      toast("Creator unlocked.");
      render();
    } else {
      toast("Wrong code.");
    }
  });
  document.getElementById("btnOpenDebug")?.addEventListener("click", ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    openDebugConsole();
  });
  document.getElementById("btnExportIntegrity")?.addEventListener("click", ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    try{
      const report = (window.__LIFEOS_LAST_INTEGRITY_REPORT || null) || { ok: true, note: "No violation detected." };
      downloadText(`lifeos-integrity-report-${Date.now()}.json`, JSON.stringify(report, null, 2));
      toast("Exported.");
    }catch(_e){
      toast("Export failed.");
    }
  });
  document.getElementById("btnClearCaches2")?.addEventListener("click", async ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    await clearCachesAndReload();
  });

  // Creator: Remote feature flags builder
  document.getElementById("btnLoadRemoteFlags")?.addEventListener("click", async ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    try{
      const meta = await fetchChannelMeta(state.settings.updateChannel || "stable");
      window.__LIFEOS_LAST_REMOTE_META = meta;
      renderRemoteFlagsBuilder(meta);
      toast("Loaded remote flags.");
    }catch(e){
      toast("Load failed.");
    }
  });
  document.getElementById("btnUseLocalOverrides")?.addEventListener("click", ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    const meta = window.__LIFEOS_LAST_REMOTE_META || { featureFlags: {} };
    renderRemoteFlagsBuilder(meta);
  });
  document.getElementById("btnCopyFlagsJson")?.addEventListener("click", async ()=>{
    if (!creatorUnlocked) return toast("Locked.");
    const out = document.getElementById("flagsJsonOut");
    if (!out) return;
    await copyText(out.value || "");
  });

  document.getElementById("btnSetWallpaper")?.addEventListener("click", ()=>{
    if (vaultLocked) return toast("Vault locked.");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async ()=>{
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        state.settings.wallpaper = reader.result;
        saveLocal();
        onLocalMutation();
        setWallpaper();
        toast("Wallpaper set.");
      };
      reader.readAsDataURL(f);
    };
    input.click();
  });

  document.getElementById("btnWipeLocal")?.addEventListener("click", ()=>{
    localStorage.removeItem("lifeos_local_cache_v2");
    toast("Local cache wiped. Reloading…");
    setTimeout(()=>location.reload(), 600);
  });

  document.getElementById("btnChangeVaultPass")?.addEventListener("click", async ()=>{
    if (vaultLocked) return toast("Unlock vault first.");
    const newPass = prompt("New Vault Passphrase (strong):");
    if (!newPass) return;
    try{
      vault.setPassphrase(newPass);
      currentVaultPass = newPass;
      await vault.pushState(state);
      toast("Vault passphrase changed (re-encrypted).");
      onLocalMutation();
    }catch(e){
      toast("Change pass failed: " + (e?.message||e));
    }
    render();
  });

  const labelInput = document.getElementById("deviceLabel");
  if (labelInput) labelInput.value = localStorage.getItem("lifeos_device_label_v2") || "This device";
  document.getElementById("btnSaveDeviceLabel")?.addEventListener("click", async ()=>{
    if (vaultLocked) return toast("Vault locked.");
    const v = document.getElementById("deviceLabel")?.value || "This device";
    setDeviceLabel(v);
    toast("Device name saved.");
    try{ await upsertDevice(sb, { id: state.user.userId }); }catch(_e){}
    refreshDevicesUI();
  });
  document.getElementById("btnRefreshDevices")?.addEventListener("click", ()=> refreshDevicesUI());

  document.getElementById("btnCloudWipe")?.addEventListener("click", async ()=>{
    if (!confirm("Cloud wipe qilinsinmi? (vault + devices) ORQAGA QAYTIB BO‘LMAYDI")) return;
    if (!sb || !state.user.userId) return;
    try{
      setSyncPill("Wiping…");
      await vault.wipeRemote();
      await sb.from(CONFIG.DEVICE_TABLE).delete().eq("user_id", state.user.userId);
      localStorage.removeItem("lifeos_local_cache_v2");
      localStorage.removeItem("lifeos_last_sync_marker_ms");
      pendingConflict = null;
      toast("Cloud wiped. Signing out…");
      await sb.auth.signOut();
      state = DEFAULT_STATE();
      vaultLocked = true;
      setSyncPill("—");
      route = "home";
      openAuth();
      render();
    }catch(e){
      toast("Cloud wipe failed: "+(e?.message||e));
      setSyncPill("Error");
    }
  });

  document.getElementById("btnRequestAccountDelete")?.addEventListener("click", async ()=>{
    if (!confirm("Request account delete? This will wipe cloud + sign out. Auth user deletion requires server-side admin endpoint.")) return;
    if (!sb || !state.user.userId) return;
    try{
      setSyncPill("Deleting…");
      await vault.wipeRemote();
      await sb.from(CONFIG.DEVICE_TABLE).delete().eq("user_id", state.user.userId);
      localStorage.removeItem("lifeos_local_cache_v2");
      localStorage.removeItem("lifeos_last_sync_marker_ms");
      pendingConflict = null;
      toast("Cloud wiped. To delete Auth user: Supabase dashboard or Edge Function.");
      await sb.auth.signOut();
      state = DEFAULT_STATE();
      vaultLocked = true;
      route = "home";
      openAuth();
      render();
    }catch(e){
      toast("Delete request failed: " + (e?.message||e));
      setSyncPill("Error");
    }
  });

  refreshDevicesUI();
});
  }

  // update modal state lines
  els.vaultStateLine.textContent = vaultLocked ? "Vault: Locked" : "Vault: Unlocked";
}

function openEditModal(id){
  const modal = document.getElementById("editModal");
  const t = state.tasks.find(x=>x.id===id);
  if (!t) return;
  modal.classList.remove("hidden");

  document.getElementById("eTitle").value = t.title || "";
  document.getElementById("eNotes").value = t.notes || "";
  document.getElementById("eDue").value = t.dueAt ? new Date(t.dueAt).toISOString().slice(0,16) : "";
  document.getElementById("ePriority").value = String(t.priority || 3);
  document.getElementById("eTags").value = (t.tags || []).join(",");
  const repSel = document.getElementById("eRepeat");
  const repIntEl = document.getElementById("eRepeatInt");
  const r = t.recurring;
  if (repSel){ repSel.value = r?.freq ? r.freq : "none"; }
  if (repIntEl){ repIntEl.value = String(r?.interval || 1); }


  const stLines = (t.subtasks || []).map(s => `${s.done ? "[x] " : ""}${s.title}`).join("\n");
  document.getElementById("eSubtasks").value = stLines;

  document.getElementById("btnCancelEdit").onclick = ()=> modal.classList.add("hidden");
  document.getElementById("btnSaveTemplate").onclick = ()=>{
    const name = prompt("Template nomi:", t.title || "Template");
    if (!name) return;
    const due = document.getElementById("eDue").value;
    const dueOffsetMin = due ? Math.round((new Date(due).getTime() - Date.now())/60000) : 0;
    const tplTask = {
      title: document.getElementById("eTitle").value,
      notes: document.getElementById("eNotes").value,
      dueOffsetMin,
      priority: document.getElementById("ePriority").value,
      tags: document.getElementById("eTags").value,
      subtasks: document.getElementById("eSubtasks").value,
      recurring: (document.getElementById("eRepeat")?.value && document.getElementById("eRepeat")?.value!=="none") ? {freq: document.getElementById("eRepeat").value, interval: document.getElementById("eRepeatInt").value||1} : null,
    };
    state = addTemplate(state, { name, task: tplTask });
    saveLocal(); onLocalMutation(); render();
    toast("Template saqlandi.");
  };
  document.getElementById("btnSaveEdit").onclick = ()=>{
    const title = document.getElementById("eTitle").value;
    const notes = document.getElementById("eNotes").value;
    const due = document.getElementById("eDue").value;
    const dueAt = due ? new Date(due).getTime() : null;
    const priority = document.getElementById("ePriority").value;
    const tags = document.getElementById("eTags").value;
    const rep = document.getElementById("eRepeat")?.value || "none";
    const repInt = document.getElementById("eRepeatInt")?.value || 1;
    const recurring = (rep && rep!=="none") ? { freq: rep, interval: repInt } : null;
    const subtasksRaw = document.getElementById("eSubtasks").value;

    // parse subtasks: one per line; [x] prefix marks done
    const subtasks = String(subtasksRaw||"").split(/\r?\n/).map(line=>{
      const s = line.trim();
      if (!s) return null;
      const done = /^\[x\]\s*/i.test(s);
      const title = s.replace(/^\[x\]\s*/i,"").trim();
      return { title, done };
    }).filter(Boolean);

    state = editTask(state, id, {title, notes, dueAt, priority, tags, subtasks, recurring });
    saveLocal();
    modal.classList.add("hidden");
    render();
  };
}

init();

function bindHistoryControls(){
  const btn = document.getElementById('histApply');
  if (!btn) return;
  btn.onclick = ()=>{
    const t = document.getElementById('histType');
    const dsel = document.getElementById('histDevice');
    if (dsel){
      const devices = new Set((state.audit?.events||[]).map(e=>String(e.deviceId||'')).filter(Boolean));
      const cur = histUI.device || 'All';
      dsel.innerHTML = '<option>All</option>' + [...devices].slice(0,30).map(id=>`<option ${id===cur?'selected':''}>${id}</option>`).join('');
      if (cur!=='All' && !devices.has(cur)) histUI.device='All';
    }
    const q = document.getElementById('histQ');
    const f = document.getElementById('histFrom');
    const to = document.getElementById('histTo');
    const d = document.getElementById('histDevice');
    histUI.type = t?.value || 'All';
    histUI.q = q?.value || '';
    histUI.from = f?.value || '';
    histUI.to = to?.value || '';
    histUI.device = d?.value || 'All';
    // basic filtering happens client-side here by trimming audit.events
    // We filter by rebuilding a temporary view state: simplest is to store filters and re-render;
    render();
  };
}


function applyHistoryFilter(s){
  try{
    const out = structuredClone(s);
    const evs = out.audit?.events || [];
    let filtered = evs;
    if (histUI.type && histUI.type !== 'All') filtered = filtered.filter(e=>e.type===histUI.type);
    if (histUI.q && histUI.q.trim()){
      const q = histUI.q.trim().toLowerCase();
      filtered = filtered.filter(e=>JSON.stringify(e.payload).toLowerCase().includes(q) || String(e.entityId||'').toLowerCase().includes(q));
    }
    if (histUI.from){
      const fromTs = new Date(histUI.from + 'T00:00:00').getTime();
      filtered = filtered.filter(e=>e.timestamp >= fromTs);
    }
    if (histUI.to){
      const toTs = new Date(histUI.to + 'T23:59:59').getTime();
      filtered = filtered.filter(e=>e.timestamp <= toTs);
    }
    if (histUI.device && histUI.device !== 'All') filtered = filtered.filter(e => String(e.deviceId||'') === String(histUI.device));
    if (out.audit) out.audit.events = filtered;
    return out;
  }catch(_e){
    return s;
  }
}
if (route === "notifications"){
  document.getElementById("btnClearNotifs")?.addEventListener("click", ()=>{
    state.notifications = [];
    saveLocal();
    render();
  });
}

if (route === "templates"){
  // save rename
  for (const btn of document.querySelectorAll("[data-tpl-save]")){
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.tplSave;
      const inp = document.querySelector(`[data-tpl-name="${id}"]`);
      const name = inp ? inp.value : "";
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      state = renameTemplate(state, id, name);
      saveLocal();
      onLocalMutation();
      toast("Template saved.");
      render();
    });
  }
  for (const btn of document.querySelectorAll("[data-tpl-del]")){
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.tplDel;
      if (vaultLocked) return toast("Vault locked. Unlock first.");
      state = deleteTemplate(state, id);
      saveLocal();
      onLocalMutation();
      toast("Template deleted.");
      render();
    });
  }
}





function downloadText(text, filename, mime){
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function buildAnalyticsCsv(state){
  const events = (state.audit?.events && Array.isArray(state.audit.events)) ? state.audit.events : [];
  function dayKey(ts){ return new Date(ts).toISOString().slice(0,10); }
  const now = Date.now();
  const since = now - 90*24*60*60*1000;
  const rows = new Map(); // day -> {created, done, missed, xp}
  const pushRow = (k)=>{ if (!rows.has(k)) rows.set(k,{created:0,done:0,missed:0,xp:0}); return rows.get(k); };

  for (const ev of events){
    const ts = ev.timestamp||0;
    if (ts < since) continue;
    const k = dayKey(ts);
    const r = pushRow(k);
    if (ev.type==="TASK_CREATE") r.created++;
    if (ev.type==="TASK_DONE") { r.done++; r.xp += (ev.payload?.gain||0); }
    if (ev.type==="TASK_MISSED") r.missed++;
  }
  // ensure all days exist
  const days = [];
  const base = new Date();
  base.setHours(0,0,0,0);
  for (let i=89;i>=0;i--){
    const d = new Date(base);
    d.setDate(base.getDate()-i);
    const k = d.toISOString().slice(0,10);
    days.push(k);
    pushRow(k);
  }

  let out = "date,created,done,missed,xp,completion_rate\n";
  for (const k of days){
    const r = rows.get(k);
    const attempts = (r.done + r.missed);
    const rate = attempts ? (r.done/attempts) : 0;
    out += `${k},${r.created},${r.done},${r.missed},${Math.round(r.xp)},${rate.toFixed(4)}\n`;
  }
  return out;
}

function exportAnalyticsPdf(){
  // Simple, reliable PDF via browser print dialog (user chooses Save as PDF).
  const html = document.getElementById("view")?.innerHTML || "";
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>LifeOS Analytics</title>
    <style>
      body{font-family:system-ui,Segoe UI,Arial,sans-serif;padding:18px}
      .card{border:1px solid rgba(0,0,0,.15);border-radius:12px;padding:14px;margin:10px 0}
      .grid{display:block}
      canvas{max-width:100%}
      button{display:none!important}
      #btnExportCsv,#btnExportPdf{display:none!important}
      .navbtn,.sidebar,#sidebar{display:none!important}
    </style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

async function clearCachesAndReload(){
  try{
    if (window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(_e){}
  // also ask SW to skip waiting
  if ("serviceWorker" in navigator){
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }catch(_e){}
  }
  location.reload(true);
}


function renderRemoteFlagsBuilder(meta){
  const list = document.getElementById("remoteFlagsList");
  const out = document.getElementById("flagsJsonOut");
  if (!list || !out) return;

  const flags = (meta && meta.featureFlags) ? meta.featureFlags : {};
  // Merge local overrides (if any)
  const localOv = JSON.parse(localStorage.getItem("lifeos_feature_overrides") || "{}");
  const merged = { ...flags, ...localOv };

  list.innerHTML = Object.keys(merged).sort().map(k=>{
    const v = merged[k] ? "on" : "off";
    return `
      <div class="item">
        <div style="flex:1">
          <div class="itTitle">${k}</div>
          <div class="itSub">value: <b>${v}</b></div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="btn ghost" data-flag="${k}" data-set="on">ON</button>
          <button class="btn ghost" data-flag="${k}" data-set="off">OFF</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="small">No flags found.</div>`;

  out.value = JSON.stringify({ featureFlags: merged }, null, 2);

  list.querySelectorAll("button[data-flag]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.getAttribute("data-flag");
      const set = btn.getAttribute("data-set")==="on";
      const ov = JSON.parse(localStorage.getItem("lifeos_feature_overrides") || "{}");
      ov[key]=set;
      localStorage.setItem("lifeos_feature_overrides", JSON.stringify(ov));
      renderRemoteFlagsBuilder(meta);
      toast(`Flag ${key} -> ${set ? "ON" : "OFF"}`);
    });
  });
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard.");
  }catch{
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("Copied.");
  }
}
