import { computeRank } from "../engine/store.js";

export function fmtDate(ts){
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toISOString().replace("T"," ").slice(0,16);
}

export function renderHome(state){
  return `
    <div class="grid cols4">
      <div class="card">
        <h3>Total XP</h3>
        <div class="kpi"><div><div class="value">${state.stats.xp}</div><div class="label">progress</div></div>
        <span class="pill">Level ${state.stats.level}</span></div>
      </div>
      <div class="card">
        <h3>Rank</h3>
        <div class="kpi"><div><div class="value">${state.stats.rank}</div><div class="label">no max level</div></div>
        <span class="pill">Next: ${computeRank(state.stats.level+1)}</span></div>
      </div>
      <div class="card">
        <h3>Streak</h3>
        <div class="kpi"><div><div class="value">${state.stats.streak}</div><div class="label">days</div></div>
        <span class="pill">Last: ${state.stats.lastDoneDate ?? "—"}</span></div>
      </div>
    
<div class="card">
  <h3>Streak</h3>
  <div class="kpi">
    <div>
      <div class="value">${streaks.current}</div>
      <div class="label">current days</div>
    </div>
    <span class="pill">Best ${streaks.best}</span>
  </div>
  <div class="small">Based on days with ≥1 completed task.</div>
</div>
</div>

    <div class="grid cols2" style="margin-top:14px">
      <div class="card">
        <h3>Quick Add Task</h3>
        <div class="grid">

          <input class="input" id="qaTitle" placeholder="Task title…" />
          <div class="row">
            <select class="select" id="qaSection">
              ${["Life","Health","Study","Trading","Work","Other"].map(s=>`<option>${s}</option>`).join("")}
            </select>
            <input class="input" id="qaDue" type="datetime-local" />
          </div>
          <textarea class="input" id="qaNotes" rows="3" placeholder="Notes (optional)…"></textarea>
          <button class="btn primary" id="btnQuickAdd">Add</button>
          <div class="small">XP task bo'yicha bo'lim ichidagi tasklar soniga qarab avtomatik hisoblanadi.</div>
        </div>
      </div>

      <div class="card">
        <h3>Today overview</h3>
        <div class="row">
          <span class="pill">Open: ${state.tasks.filter(t=>t.status==="Open").length}</span>
          <span class="pill">Done: ${state.tasks.filter(t=>t.status==="Done").length}</span>
          <span class="pill">Missed: ${state.tasks.filter(t=>t.status==="Missed").length}</span>
        </div>
        <hr />
        <div class="small">Auto-fail: due + ${state.settings.autoFailMin} min → Missed</div>
        <div class="small">Hard mode: <b>${state.settings.hardMode}</b></div>
        <div class="small">Analytics: <b>${state.settings.analyticsEnabled ? "ON" : "OFF"}</b></div>
      </div>
    </div>
  `;
}

export function renderTasks(state, ui = {}){
  const q = String(ui.q||"").toLowerCase();
  const fStatus = ui.status || "All";
  const fPriority = ui.priority || "All";
  const fTag = String(ui.tag||"").toLowerCase().trim();
  const sortBy = ui.sort || "updated";

  let list = state.tasks.slice();

  // filter
  if (q){
    list = list.filter(t => (t.title||"").toLowerCase().includes(q) || (t.notes||"").toLowerCase().includes(q) || (t.tags||[]).some(x=>String(x).toLowerCase().includes(q)));
  }
  if (fStatus !== "All"){
    list = list.filter(t => t.status === fStatus);
  }
  if (fPriority !== "All"){
    const p = parseInt(fPriority,10);
    list = list.filter(t => (t.priority||3) === p);
  }
  if (fTag){
    list = list.filter(t => (t.tags||[]).some(x=>String(x).toLowerCase()===fTag));
  }

  // sort
  const byUpdated = (a,b)=>(b.updatedAt||0)-(a.updatedAt||0);
  const byDue = (a,b)=>(a.dueAt||Number.MAX_SAFE_INTEGER)-(b.dueAt||Number.MAX_SAFE_INTEGER);
  const byPriority = (a,b)=>(b.priority||3)-(a.priority||3);
  if (sortBy==="due") list.sort(byDue);
  else if (sortBy==="priority") list.sort(byPriority);
  else list.sort(byUpdated);

  // Virtual list: render only a safe chunk; load more on demand (real pagination)
  const perf = !!state.settings.performanceMode;
  const totalCount = list.length;
  const PAGE = perf ? 120 : 250;
  const limit = Math.max(20, parseInt(ui.limit||PAGE,10) || PAGE);
  let truncated = false;
  if (list.length > limit){
    list = list.slice(0, limit);
    truncated = true;
  };
  }

  const rows = list.map(t=>{
    const tags = (t.tags||[]).map(x=>`<span class="pill smallpill">${escapeHtml(x)}</span>`).join(" ");
    const st = (t.subtasks||[]);
    const subInfo = st.length ? `<div class="small">Subtasks: ${st.filter(x=>x.done).length}/${st.length}</div>` : "";
    const statusBadge = t.status==="Done"?`<span class="badge">Done</span>`:t.status==="Missed"?`<span class="pill" style="border-color:rgba(251,113,133,.5)">Missed</span>`:"";
    return `
      <tr>
        <td class="mono"><input type="checkbox" class="chk" data-sel="${t.id}" /></td>
        <td>
          ${statusBadge}
          <b>${escapeHtml(t.title)}</b>
          ${tags ? `<div class="tagrow">${tags}</div>` : ""}
          <div class="small">${escapeHtml(t.notes||"")}</div>
          ${subInfo}
        </td>
        <td class="mono">${t.priority||3}</td>
        <td class="mono">${t.xp}</td>
        <td class="mono">${fmtDate(t.dueAt)}</td>
        <td>
          <div class="row">
            <button class="btn" data-act="done" data-id="${t.id}">Done</button>
            <button class="btn" data-act="edit" data-id="${t.id}">Edit</button>
            <button class="btn danger" data-act="del" data-id="${t.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="card">
      <h3>Tasks v2 (General list)</h3>

      ${truncated ? `<div class="row" style="margin:6px 0 10px;gap:10px;flex-wrap:wrap;align-items:center"><div class="small" style="opacity:.85">Showing ${list.length}/${totalCount}. Use search/filter, or load more.</div><button class="btn" id="btnLoadMore">Load more</button></div>` : ""}

      <div class="row wrap" style="margin-bottom:10px">
        <input class="input" id="fQuery" placeholder="Search…" style="flex:1;min-width:180px" value="${escapeHtml(ui.q||"")}" />
        <select class="select" id="fStatus" style="width:140px">
          ${["All","Open","Done","Missed"].map(x=>`<option ${x===fStatus?"selected":""}>${x}</option>`).join("")}
        </select>
        <select class="select" id="fPriority" style="width:140px">
          ${["All",1,2,3,4,5].map(x=>`<option ${String(x)===String(fPriority)?"selected":""}>${x}</option>`).join("")}
        </select>
        <input class="input" id="fTag" placeholder="Tag (exact)" style="width:160px" value="${escapeHtml(ui.tag||"")}" />
        <select class="select" id="fSort" style="width:160px">
          ${[
            {k:"updated", n:"Sort: Updated"},
            {k:"due", n:"Sort: Due"},
            {k:"priority", n:"Sort: Priority"},
          ].map(o=>`<option value="${o.k}" ${o.k===sortBy?"selected":""}>${o.n}</option>`).join("")}
        </select>
        <button class="btn" id="btnUndo">Undo</button>
        <button class="btn" id="btnRedo">Redo</button>
        <button class="btn" id="btnBulkDone">Complete selected</button>
        <button class="btn danger" id="btnBulkDel">Delete selected</button>
      </div>

      
<div class="row wrap" style="margin-bottom:10px">
  <select class="select" id="tplSelect" style="min-width:260px">
    <option value="">Templates…</option>
    ${(state.templates||[]).map(t=>`<option value="${t.id}">${t.name}</option>`).join("")}
  </select>
  <button class="btn" id="btnAddFromTpl">Add from template</button>
  <button class="btn ghost" id="btnOpenTplManager">Manage templates</button>
</div>

<div class="row wrap">
        <input class="input" id="tTitle" placeholder="New task title…" style="flex:1;min-width:220px" />
        <input class="input" id="tDue" type="datetime-local" style="width:220px" />
        <select class="select" id="tPriority" style="width:140px">
          ${[1,2,3,4,5].map(x=>`<option ${x===3?"selected":""}>${x}</option>`).join("")}
        </select>
        <input class="input" id="tTags" placeholder="tags: study,health" style="width:220px" />
        <select class="select" id="tRepeat" style="width:160px">
          <option value="none" selected>Repeat: none</option>
          <option value="daily">Repeat: daily</option>
          <option value="weekly">Repeat: weekly</option>
          <option value="monthly">Repeat: monthly</option>
          <option value="custom">Repeat: custom (days)</option>
        </select>
        <input class="input" id="tRepeatInt" type="number" min="1" max="365" value="1" title="Repeat interval" style="width:120px" />
        <button class="btn primary" id="btnAddTask">Add</button>
      </div>
      <textarea class="input" id="tNotes" rows="2" placeholder="Notes (optional)…" style="margin-top:10px"></textarea>
      <textarea class="input" id="tSubtasks" rows="2" placeholder="Subtasks (one per line)…" style="margin-top:10px"></textarea>

      <hr />
      <table class="table">
        <thead><tr><th></th><th>Task</th><th>P</th><th>XP</th><th>Due</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="small">No tasks yet.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="modalback hidden" id="editModal">
      <div class="modal">
        <h2>Edit task</h2>
        <div class="grid">
          <input class="input" id="eTitle" placeholder="Title" />
          <input class="input" id="eDue" type="datetime-local" />
          <select class="select" id="ePriority">
            ${[1,2,3,4,5].map(x=>`<option>${x}</option>`).join("")}
          </select>
          <input class="input" id="eTags" placeholder="tags: a,b,c" />
          <select class="select" id="eRepeat">
            <option value="none">Repeat: none</option>
            <option value="daily">Repeat: daily</option>
            <option value="weekly">Repeat: weekly</option>
          </select>
          <input class="input" id="eRepeatInt" type="number" min="1" max="52" value="1" title="Repeat interval" />
          <button class="btn ghost" id="btnSaveTemplate">Save as template</button>
          <textarea class="input" id="eNotes" rows="4" placeholder="Notes"></textarea>
          <textarea class="input" id="eSubtasks" rows="4" placeholder="Subtasks (one per line; prefix [x] for done)"></textarea>
          <div class="row">
            <button class="btn primary" id="btnSaveEdit">Save</button>
            <button class="btn" id="btnCancelEdit">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
}


export function renderTimeline(state){
  const audit = state.audit || { events: [], ok: true, badIndex: null };
  const ok = audit.ok !== false;
  const badge = ok
    ? `<span class="pill ok">Integrity: OK</span>`
    : `<span class="pill bad">Integrity: VIOLATION (event #${audit.badIndex ?? "?"})</span>`;

  const events = Array.isArray(audit.events) ? audit.events.slice().reverse() : []; // newest first
  const rows = events.slice(0,200).map(e=>{
    const meta = escapeHtml(JSON.stringify({
      entityId: e.entityId,
      deviceId: e.deviceId,
      prevHash: e.prevHash,
      hash: e.hash
    }));
    const payload = escapeHtml(JSON.stringify(e.payload));
    return `<tr>
      <td class="mono">${fmtDate(e.timestamp)}</td>
      <td><b>${escapeHtml(e.type)}</b><div class="small mono">${meta}</div></td>
      <td class="mono small">${escapeHtml(e.deviceId||'')}</td>
      <td class="small mono">${payload}</td>
    </tr>`;
  }).join("");

  return `
    <div class="grid cols1">
      <div class="card">
        <div class="row between">
          <h3 style="margin:0">History & Audit</h3>
          ${badge}
        </div>
        <div class="filters">
          <div class="field">
            <label>Device</label>
            <select id="histDevice"><option>All</option></select>
          </div>
          <div class="field">
            <label>Type</label>
            <select id="histType">
              <option>All</option>
              <option>TASK_CREATE</option>
              <option>TASK_EDIT</option>
              <option>TASK_DONE</option>
              <option>TASK_UNDONE</option>
              <option>TASK_DELETE</option>
              <option>TASK_MISSED</option>
              <option>BULK_COMPLETE</option>
              <option>BULK_DELETE</option>
              <option>IMPORT</option>
              <option>EXPORT</option>
              <option>PASSWORD_CHANGE</option>
              <option>UPDATE_APPLIED</option>
              <option>WIPE_DEVICE</option>
            </select>
          </div>
          <div class="field">
            <label>Search</label>
            <input id="histQ" placeholder="task id / text…" />
          </div>
          <div class="field">
            <label>From</label>
            <input id="histFrom" type="date" />
          </div>
          <div class="field">
            <label>To</label>
            <input id="histTo" type="date" />
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="btn" id="histApply">Apply</button>
          </div>
        </div>
        <div class="small" style="margin:10px 0 0;opacity:.8">
          Note: Integrity uses a hash-chain. Editing local storage events will trigger Restricted Mode.
        </div>
        <table class="table" style="margin-top:10px">
          <thead><tr><th>Time</th><th>Event</th><th>Payload</th></tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="3" class="small">No history yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}


export function renderVault(state, vaultInfo){
  return `
    <div class="grid cols2">
      <div class="card">
        <h3>Vault status</h3>
        <div class="row">
          <span class="pill">User: ${state.user.email ?? "—"}</span>
          <span class="pill">Vault: ${vaultInfo.locked ? "Locked" : "Unlocked"}</span>
          <span class="pill">Last sync: ${vaultInfo.lastSync ?? "—"}</span>
          <span class="pill ${vaultInfo.online? "ok": "bad"}">Net: ${vaultInfo.online? "Online":"Offline"}</span>
        </div>
        <hr />
        ${vaultInfo.conflict ? `<div class="card danger" style="margin:12px 0"><h4>Sync conflict detected</h4><div class="small">Local and cloud both changed since last sync. Preview the differences, then choose which one to keep.</div>
        ${vaultInfo.conflictInfo?.preview ? `<div class="grid cols2" style="margin-top:10px">
          <div class="card" style="padding:12px">
            <h4 style="margin:0 0 6px">Local</h4>
            <div class="small">Updated: <b>${fmtDate(vaultInfo.conflictInfo.preview.localUpdatedAt)}</b></div>
            <div class="small">Tasks: <b>${vaultInfo.conflictInfo.preview.localTasks}</b> • Events: <b>${vaultInfo.conflictInfo.preview.localEvents}</b></div>
          </div>
          <div class="card" style="padding:12px">
            <h4 style="margin:0 0 6px">Cloud</h4>
            <div class="small">Updated: <b>${fmtDate(vaultInfo.conflictInfo.preview.remoteUpdatedAt)}</b></div>
            <div class="small">Tasks: <b>${vaultInfo.conflictInfo.preview.remoteTasks}</b> • Events: <b>${vaultInfo.conflictInfo.preview.remoteEvents}</b></div>
          </div>
        </div>
        <div class="small" style="margin-top:8px">Diff: <b>${vaultInfo.conflictInfo.preview.taskTitleDiff}</b> task title differences • <b>${vaultInfo.conflictInfo.preview.doneCountDiff}</b> DONE differences</div>` : ``}
        <div class="row" style="margin-top:10px; gap:8px"><button class="btn" id="btnUseLocal">Keep local</button><button class="btn primary" id="btnUseRemote">Use cloud</button></div></div>` : ``}
        <div class="row">
          <button class="btn primary" id="btnSyncPush">Push to cloud</button>
          <button class="btn" id="btnSyncPull">Pull from cloud</button>
        </div>
        <div class="small" style="margin-top:10px">
          Serverga <b>faqat shifrlangan blob</b> yuboriladi. Passphrase serverga yuborilmaydi.
        </div>
      </div>
      <div class="card">
        <h3>Export / Import (Encrypted)</h3>
        <div class="row">
          <button class="btn" id="btnExport">Export</button>
          <input class="input" type="file" id="importFile" accept=".lifeos.json" />
          <button class="btn warn" id="btnImport">Import</button>
        </div>
        <div class="small" style="margin-top:10px">Export fayl shifrlangan bo'ladi (.lifeos.json).</div>
      </div>
      <div class="card">
        <h3>Recovery / Restore</h3>
        <div class="row">
          <button class="btn" id="btnEmergencyBundle">Emergency export bundle</button>
          <button class="btn" id="btnRefreshVersions">Refresh snapshots</button>
        </div>
        <div class="small" style="margin-top:10px">Emergency bundle: encrypted vault export + integrity report (JSON). Snapshots: cloud side encrypted backups for safe restore.</div>
        <div id="vaultVersions" style="margin-top:12px"></div>
      </div>
    </div>
  `;
}

export function renderSettings(state){
  return `
    <div class="grid cols2">
      <div class="card">
        <h3>Control Center</h3>
        <div class="grid">
          <div class="row">
            <span class="pill">Security preset</span>
            <select class="select" id="sPreset" style="width:220px">
              <option value="Custom" selected>Custom</option>
              <option value="Balanced">Balanced</option>
              <option value="Paranoid">Paranoid</option>
              <option value="Performance">Performance</option>
            </select>
          </div>

          <div class="row">
            <span class="pill">Update channel</span>
            <select class="select" id="sChannel" style="width:220px">
              <option value="stable" ${(!state.settings.updateChannel || state.settings.updateChannel==="stable")?"selected":""}>Stable</option>
              <option value="beta" ${state.settings.updateChannel==="beta"?"selected":""}>Beta</option>
            </select>
          </div>
          <div class="row">
            <span class="pill">Hard Mode</span>
            <select class="select" id="sHard" style="width:220px">
              ${["Low","Medium","High"].map(m=>`<option ${state.settings.hardMode===m?"selected":""}>${m}</option>`).join("")}
            </select>
          </div>
          <div class="row">
            <span class="pill">Auto-fail (minutes)</span>
            <input class="input" id="sAutoFail" type="number" min="5" max="10080" value="${state.settings.autoFailMin}" style="width:220px" />
          </div>
          <div class="row">
            <span class="pill">Idle lock (minutes)</span>
            <input class="input" id="sIdle" type="number" min="1" max="240" value="${state.settings.idleLockMin}" style="width:220px" />
          </div>
          <div class="row">
            <span class="pill">Integrity enforcement</span>
            <select class="select" id="sIntegrity" style="width:220px">
              <option value="on" ${(state.settings.integrityEnabled!==false)?"selected":""}>ON</option>
              <option value="off" ${(state.settings.integrityEnabled===false)?"selected":""}>OFF</option>
            </select>
          </div>
          <div class="row">
            <span class="pill">Analytics</span>
            <select class="select" id="sAnalytics" style="width:220px">
              <option value="on" ${state.settings.analyticsEnabled?"selected":""}>ON</option>
              <option value="off" ${!state.settings.analyticsEnabled?"selected":""}>OFF</option>
            </select>
          </div>
          <div class="row">
            <span class="pill">Performance mode</span>
            <select class="select" id="sPerf" style="width:220px">
              <option value="off" ${!state.settings.performanceMode?"selected":""}>OFF</option>
              <option value="on" ${state.settings.performanceMode?"selected":""}>ON</option>
            </select>
          </div>
          <div class="row">
            <button class="btn primary" id="btnSaveSettings">Save settings</button>
          </div>
        </div>

<div class="row">
  <span class="pill">Notifications</span>
  <select class="select" id="sNotif" style="width:220px">
    <option value="on" ${state.settings.notificationsEnabled?"selected":""}>ON</option>
    <option value="off" ${!state.settings.notificationsEnabled?"selected":""}>OFF</option>
  </select>
</div>
      </div>

      <div class="card">
        <h3>Security</h3>
        <div class="grid">
          <button class="btn warn" id="btnChangeVaultPass">Change Vault Passphrase</button>
          <button class="btn" id="btnSetWallpaper">Set Wallpaper</button>
          <button class="btn danger" id="btnWipeLocal">Wipe local cache</button>
          <div class="small">
            Vault passphrase — serverga yuborilmaydi. Account password’ni Supabase orqali reset qilasan.
          </div>
        </div>
      </div>
    </div>
      <div class="card">
        <h3>Devices</h3>
        <div class="small">Logged-in devices list (approx. active sessions). Current device is highlighted.</div>
        <div id="deviceList" class="list"></div>
        <div class="row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
          <input class="input" id="deviceLabel" placeholder="This device name" style="min-width:220px" />
          <button class="btn" id="btnSaveDeviceLabel">Save name</button>
          <button class="btn ghost" id="btnRefreshDevices">Refresh</button>
        </div>
      </div>

      <div class="card danger">
        <h3>Account</h3>
        <div class="small">Cloud wipe removes your encrypted vault + devices rows from Supabase (cannot be undone). It does <b>not</b> delete your Supabase Auth user unless you set up a server-side delete endpoint.</div>
        <div class="row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
          <button class="btn danger" id="btnCloudWipe">Cloud wipe (vault + devices)</button>
          <button class="btn warn" id="btnRequestAccountDelete">Request account delete</button>
        </div>
      </div>

  

      <div class="card">
        <h3>Creator / Admin</h3>
        <div class="small">Owner tools (local). Unlock required.</div>
        <div class="grid" style="margin-top:10px;">
          <div class="row" style="gap:8px; flex-wrap:wrap;">
            <input class="input" id="creatorCode" placeholder="Creator code" style="width:220px" />
            <button class="btn" id="btnUnlockCreator">${state.creatorUnlocked ? "Unlocked" : "Unlock"}</button>
            <span class="pill" style="opacity:.85">${state.creatorUnlocked ? "ACCESS: ON" : "ACCESS: OFF"}</span>
          </div>
          <div id="creatorActions" style="${state.creatorUnlocked ? "" : "display:none;"}">
            <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px;">
              <button class="btn" id="btnOpenDebug">Open debug console</button>
              <button class="btn" id="btnExportIntegrity">Export integrity report</button>
              <button class="btn warn" id="btnClearCaches2">Clear caches & reload</button>
            
            <div class="card" style="margin-top:12px;">
              <h3>Remote Feature Flags (Builder)</h3>
              <div class="small">Load current channel flags from <code>version.json</code>, toggle, and copy JSON to paste back into your repo.</div>
              <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:10px;">
                <button class="btn" id="btnLoadRemoteFlags">Load from server</button>
                <button class="btn ghost" id="btnUseLocalOverrides">Use local overrides</button>
                <button class="btn primary" id="btnCopyFlagsJson">Copy JSON</button>
              </div>
              <div id="remoteFlagsList" class="list" style="margin-top:10px;"></div>
              <textarea class="input" id="flagsJsonOut" style="width:100%;min-height:120px;margin-top:10px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"></textarea>
            </div>
</div>
            <div class="small" style="margin-top:10px; opacity:.8">
              Tip: press <b>Ctrl+Alt+D</b> to open console (when unlocked).
            </div>
          </div>
        </div>
      </div>
`;
}


export function renderAnalytics(state){
  const events = (state.audit?.events && Array.isArray(state.audit.events)) ? state.audit.events : [];
  const legacy = Array.isArray(state.history) ? state.history : [];

  function dayKey(ts){ return new Date(ts).toISOString().slice(0,10); }
  function isType(ev, t){
    if (!ev) return false;
    if (ev.type) return ev.type === t;
    return false;
  }

  // ---- KPIs: today + last 7 days
  const now = Date.now();
  const todayKey = dayKey(now);
  const since7 = now - 7*24*60*60*1000;

  let todayDone=0, todayMissed=0, todayCreated=0;
  let weekDone=0, weekMissed=0, weekCreated=0;
  let weekXp=0;

  for (const ev of events){
    const ts = ev.timestamp || 0;
    const dk = dayKey(ts);
    const inWeek = ts >= since7;
    if (ev.type === "TASK_CREATE"){
      if (dk===todayKey) todayCreated++;
      if (inWeek) weekCreated++;
    }
    if (ev.type === "TASK_DONE"){
      if (dk===todayKey) todayDone++;
      if (inWeek) { weekDone++; weekXp += (ev.payload?.gain||0); }
    }
    if (ev.type === "TASK_MISSED"){
      if (dk===todayKey) todayMissed++;
      if (inWeek) weekMissed++;
    }
  }
  // fallback for older legacy types if audit is empty
  if (events.length === 0){
    for (const h of legacy){
      const ts = h.t||0;
      const dk = dayKey(ts);
      const inWeek = ts >= since7;
      if (h.type==="task_create"){
        if (dk===todayKey) todayCreated++;
        if (inWeek) weekCreated++;
      }
      if (h.type==="task_done"){
        if (dk===todayKey) todayDone++;
        if (inWeek) weekDone++;
      }
      if (h.type==="task_missed"){
        if (dk===todayKey) todayMissed++;
        if (inWeek) weekMissed++;
      }
    }
  }

  const weekTotalAttempts = (weekDone + weekMissed) || 1;
  const weekCompletionRate = Math.round((weekDone / weekTotalAttempts) * 100);

  // ---- 30-day heatmap (Done count)
  const days = [];
  const base = new Date();
  for (let i=29;i>=0;i--){
    const d = new Date(base);
    d.setDate(base.getDate()-i);
    const k = d.toISOString().slice(0,10);
    days.push({k, done:0});
  }
  const doneByDay = new Map(days.map(x=>[x.k,0]));
  for (const ev of events){
    if (ev.type === "TASK_DONE"){
      const k = dayKey(ev.timestamp);
      doneByDay.set(k, (doneByDay.get(k)||0) + 1);
    }
  }
  if (events.length===0){
    for (const h of legacy){
      if (h.type==="task_done"){
        const k = dayKey(h.t);
        doneByDay.set(k, (doneByDay.get(k)||0) + 1);
      }
    }
  }
  for (const d of days) d.done = doneByDay.get(d.k)||0;
  const maxDone = Math.max(1, ...days.map(d=>d.done));
  const heatCells = days.map(d=>{
    const a = d.done/maxDone;
    const alpha = (0.10 + a*0.65).toFixed(3);
    return `<div title="${d.k}: ${d.done}" style="width:14px;height:14px;border-radius:4px;border:1px solid rgba(255,255,255,.08);background:rgba(94,234,212,${alpha})"></div>`;
  }).join("");

  // ---- Completion / failure rate (30 days)
  const since30 = now - 30*24*60*60*1000;
  let d30=0, m30=0;
  for (const ev of events){
    const ts = ev.timestamp||0;
    if (ts < since30) continue;
    if (ev.type==="TASK_DONE") d30++;
    if (ev.type==="TASK_MISSED") m30++;
  }
  if (events.length===0){
    for (const h of legacy){
      const ts=h.t||0;
      if (ts < since30) continue;
      if (h.type==="task_done") d30++;
      if (h.type==="task_missed") m30++;
    }
  }
  const total30 = (d30+m30)||1;
  const comp30 = Math.round((d30/total30)*100);
  const fail30 = 100-comp30;


// ---- Streak analytics (based on days with at least 1 TASK_DONE)
const streakMap = new Map();
const since365 = now - 365*24*60*60*1000;
for (const ev of events){
  const ts = ev.timestamp||0;
  if (ts < since365) continue;
  if (ev.type==="TASK_DONE"){
    const k = dayKey(ts);
    streakMap.set(k, (streakMap.get(k)||0)+1);
  }
}
if (events.length===0){
  for (const h of legacy){
    const ts=h.t||0;
    if (ts < since365) continue;
    if (h.type==="task_done"){
      const k = dayKey(ts);
      streakMap.set(k, (streakMap.get(k)||0)+1);
    }
  }
}
function calcStreaks(){
  const today = new Date();
  today.setHours(0,0,0,0);
  let current = 0;
  for (let i=0;i<365;i++){
    const d = new Date(today);
    d.setDate(today.getDate()-i);
    const k = d.toISOString().slice(0,10);
    if ((streakMap.get(k)||0) > 0) current++;
    else break;
  }
  let best=0, run=0;
  for (let i=364;i>=0;i--){
    const d = new Date(today);
    d.setDate(today.getDate()-i);
    const k = d.toISOString().slice(0,10);
    if ((streakMap.get(k)||0) > 0){ run++; best=Math.max(best,run); }
    else run=0;
  }
  return { current, best };
}
const streaks = calcStreaks();


  // ---- Integrity gate
  if (state.settings.integrityEnabled && state.audit && state.audit.ok === false){
    return `
      <div class="card">
        <h3>Statistics & Analytics</h3>
        <div class="row wrap" style="margin:8px 0 0;gap:10px"><button class="btn" id="btnExportCsv">Export CSV</button><button class="btn" id="btnExportPdf">Export PDF</button></div>
<div class="small">Integrity VIOLATION detected. Analytics disabled.</div>
        <div class="row" style="margin-top:12px">
          <span class="pill danger">RESTRICTED</span>
          <span class="pill">Bad event index: <b>${state.audit.badIndex ?? "?"}</b></span>
        </div>
      </div>
    `;
  }

  return `
    <div class="grid cols3">
      <div class="card">
        <h3>Today</h3>
        <div class="row wrap">
          <span class="pill">Created: <b>${todayCreated}</b></span>
          <span class="pill">Done: <b>${todayDone}</b></span>
          <span class="pill">Missed: <b>${todayMissed}</b></span>
        </div>
        <div class="small" style="margin-top:10px">Based on audit trail events (tamper-resistant).</div>
      </div>
      <div class="card">
        <h3>Last 7 days</h3>
        <div class="row wrap">
          <span class="pill">Done: <b>${weekDone}</b></span>
          <span class="pill">Missed: <b>${weekMissed}</b></span>
          <span class="pill">Completion: <b>${weekCompletionRate}%</b></span>
          <span class="pill">XP gained: <b>${weekXp}</b></span>
        </div>
        <div class="small" style="margin-top:10px">Rolling 7-day window.</div>
      </div>
      <div class="card">
        <h3>30 days rate</h3>
        <div class="row wrap">
          <span class="pill">Completion: <b>${comp30}%</b></span>
          <span class="pill">Failure: <b>${fail30}%</b></span>
          <span class="pill">Attempts: <b>${d30+m30}</b></span>
        </div>
        <div class="small" style="margin-top:10px">Done vs Missed (last 30 days).</div>
      </div>
    </div>

    <div class="grid cols2" style="margin-top:14px">
      <div class="card">
        <h3>XP trend (daily, last 30 days)</h3>
        <canvas id="xpChart" height="130"></canvas>
        <div class="small">Daily XP sum from TASK_DONE (gain).</div>
      </div>
      <div class="card">
        <h3>30-day heatmap (Done count)</h3>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center">${heatCells}</div>
        <div class="small" style="margin-top:10px">Each cell = number of completed tasks.</div>
      </div>
    </div>
  `;
}



export function renderNotifications(state){
  const items = (state.notifications||[]);
  const rows = items.map(n=>`
    <div class="card" style="margin-bottom:10px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700">${escapeHtml(n.title||n.level||"Notification")}</div>
          <div class="small" style="margin-top:4px">${escapeHtml(n.body||"")}</div>
        </div>
        <span class="pill">${fmtDate(n.t)}</span>
      </div>
    </div>
  `).join("") || `<div class="card"><div class="small">No notifications yet.</div></div>`;

  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <div>
        <h2 style="margin:0">Notifications</h2>
        <div class="small">In-app notifications center.</div>
      </div>
      <div class="row">
        <button class="btn danger" id="btnClearNotifs">Clear all</button>
      </div>
    </div>
    ${rows}
  `;
}

export function renderTemplates(state){
  const list = (state.templates||[]);
  const rows = list.map(t=>`
    <div class="card" style="margin-bottom:10px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <div class="small mono">${t.id}</div>
          <input class="input" data-tpl-name="${t.id}" value="${escapeHtml(t.name||"Template")}" />
          <div class="small" style="margin-top:6px;opacity:.75">
            ${escapeHtml((t.task?.title||"").slice(0,60))} • priority ${t.task?.priority ?? 3} • tags ${(t.task?.tags||[]).join(", ")}
          </div>
        </div>
        <div class="row">
          <button class="btn" data-tpl-save="${t.id}">Save</button>
          <button class="btn danger" data-tpl-del="${t.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join("") || `<div class="card"><div class="small">No templates yet. Create from Tasks → “Save as template”.</div></div>`;

  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <div>
        <h2 style="margin:0">Templates Manager</h2>
        <div class="small">Rename / delete templates safely.</div>
      </div>
    </div>
    ${rows}
  `;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}