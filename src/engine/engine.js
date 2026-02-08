import { DEFAULT_STATE, applyXpAndLevel, deriveXpPerSection } from "./store.js";
import { recordEvent } from "../history/historyRecorder.js";
import { APP_VERSION } from "../version.js";

function getDeviceId(state){
  return state?.device?.device_id || state?.device?.id || null;
}

function clampPriority(p){
  const n = parseInt(p,10);
  if (!n || n < 1) return 1;
  if (n > 5) return 5;
  return n;
}
function normalizeTags(tags){
  if (Array.isArray(tags)) return [...new Set(tags.map(t=>String(t).trim()).filter(Boolean))].slice(0,20);
  // allow comma separated string
  return normalizeTags(String(tags||"").split(","));
}
function normalizeSubtasks(subtasks){
  if (Array.isArray(subtasks)){
    return subtasks.map(st=>({
      id: st.id || uid(),
      title: String(st.title||"").trim(),
      done: !!st.done,
    })).filter(st=>st.title).slice(0,50);
  }
  // allow multiline string
  return normalizeSubtasks(String(subtasks||"").split("\n").map(x=>({title:x})));
}


function clampInterval(n){
  const x = parseInt(n,10);
  if (!x || x < 1) return 1;
  if (x > 52) return 52;
  return x;
}
function normalizeRecurring(rec){
  if (!rec || rec === "none") return null;

  // string shortcuts
  if (typeof rec === "string"){
    const s = rec.toLowerCase();
    if (s==="daily") return { freq:"daily", interval:1 };
    if (s==="weekly") return { freq:"weekly", interval:1 };
    if (s==="monthly") return { freq:"monthly", interval:1 };
    if (s==="custom") return { freq:"custom", interval:1, unit:"days" };
    return null;
  }

  const freq = (rec.freq||"").toLowerCase();
  const intervalRaw = rec.interval || 1;

  if (freq==="daily" || freq==="weekly" || freq==="monthly"){
    return { freq, interval: clampInterval(intervalRaw) };
  }
  if (freq==="custom"){
    // custom days interval, allow up to 365
    const x = parseInt(intervalRaw,10);
    const interval = (!x || x<1) ? 1 : (x>365 ? 365 : x);
    return { freq:"custom", interval, unit:"days" };
  }
  return null;
}
function computeNextDue(dueAt, rule){
  const base = dueAt ? new Date(dueAt) : new Date();
  const d = new Date(base.getTime());

  if (!rule) return null;

  if (rule.freq==="daily"){
    d.setDate(d.getDate() + (rule.interval||1));
    return d.getTime();
  }
  if (rule.freq==="weekly"){
    d.setDate(d.getDate() + (7*(rule.interval||1)));
    return d.getTime();
  }
  if (rule.freq==="monthly"){
    d.setMonth(d.getMonth() + (rule.interval||1));
    return d.getTime();
  }
  if (rule.freq==="custom" && (rule.unit||"days")==="days"){
    d.setDate(d.getDate() + (rule.interval||1));
    return d.getTime();
  }
  return null;
}
function pushNotification(state, {level="info", title="", body=""}){
  const s = structuredClone(state);
  if (!s.notifications) s.notifications = [];
  const item = { id: "n_"+Math.random().toString(16).slice(2), t: Date.now(), level, title, body };
  s.notifications.unshift(item);
  s.notifications = s.notifications.slice(0,50);
  return s;
}
function uid() {
  return "t_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}
export function ensureState(obj){
  if (!obj || typeof obj !== "object") return DEFAULT_STATE();
  // mild migration
  if (!obj.schema) obj.schema = 2;
  if (!obj.settings) obj.settings = DEFAULT_STATE().settings;
  if (!obj.stats) obj.stats = DEFAULT_STATE().stats;
  if (!obj.tasks) obj.tasks = [];
  if (!obj.templates) obj.templates = [];
  if (!obj.notifications) obj.notifications = [];
  if (!obj.history) obj.history = [];
  if (!obj.audit) obj.audit = { events: [], ok: true, badIndex: null, lastCheckedAt: null };
  if (!Array.isArray(obj.audit.events)) obj.audit.events = [];
  if (obj.audit.ok == null) obj.audit.ok = true;
  if (!obj.undo) obj.undo = { stack: [], redo: [] };
  return obj;
}

export function addTask(state, {title, notes="", dueAt=null, priority=3, tags=[], subtasks=[], recurring=null}){
  const s = structuredClone(state);
  const task = {
    id: uid(),
    title: String(title||"").trim(),
    section: "General",
    notes: String(notes||""),
    status: "Open", // Open/Done/Missed
    priority: clampPriority(priority),
    tags: normalizeTags(tags),
    subtasks: normalizeSubtasks(subtasks),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueAt: dueAt ?? null,
    xp: 0,
    recurring: normalizeRecurring(recurring),
  };
  if (!task.title) return s;
  s.tasks.push(task);
  task.xp = deriveXpPerSection(s.tasks, task.section, s.settings.hardMode);
  recordEvent(s,{ type:"TASK_CREATE", entity:"task", entityId:task.id, payload:{ after:{ id:task.id, title:task.title, notes:task.notes, status:task.status, dueAt:task.dueAt, priority:task.priority, tags:task.tags, subtasks:task.subtasks, xp:task.xp, recurring: task.recurring }}});
  s.updatedAt = Date.now();
  return s;
}


export function editTask(state, id, patch){
  const s = structuredClone(state);
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  const before = structuredClone({
    id: t.id, title: t.title, notes: t.notes, status: t.status, dueAt: t.dueAt,
    priority: t.priority, tags: t.tags, subtasks: t.subtasks, recurring: t.recurring
  });

  // apply patch
  if (patch.title != null) t.title = String(patch.title||"").trim();
  if (patch.notes != null) t.notes = String(patch.notes||"");
  if (patch.dueAt !== undefined) t.dueAt = patch.dueAt ? (new Date(patch.dueAt).getTime()) : null;
  if (patch.priority != null) t.priority = clampPriority(patch.priority);
  if (patch.tags != null) t.tags = normalizeTags(patch.tags);
  if (patch.subtasks != null) t.subtasks = normalizeSubtasks(patch.subtasks);
  if (patch.recurring !== undefined) t.recurring = normalizeRecurring(patch.recurring);

  if (!t.title) return s;

  t.updatedAt = Date.now();

  // XP per task is derived from list size; keep all tasks consistent
  const per = deriveXpPerSection(s.tasks, "General", s.settings.hardMode);
  for (const st of s.tasks) st.xp = per;

  // Undo/Redo stack (only for safe fields)
  if (!s.undo) s.undo = { stack: [], redo: [] };
  const nextSnap = structuredClone({
    id: t.id, title: t.title, notes: t.notes, dueAt: t.dueAt, priority: t.priority,
    tags: t.tags, subtasks: t.subtasks, recurring: t.recurring
  });
  s.undo.stack.unshift({ id: t.id, prev: before, next: nextSnap, at: Date.now() });
  s.undo.stack = s.undo.stack.slice(0,50);
  s.undo.redo = [];

  recordEvent(s,{
    type:"TASK_EDIT",
    entity:"task",
    entityId: t.id,
    payload:{ before, after: structuredClone(nextSnap) }
  });

  s.updatedAt = Date.now();
  return s;
}


export function deleteTask(state, id){
  const s = structuredClone(state);
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  const before = structuredClone({
    id: t.id, title: t.title, notes: t.notes, status: t.status, dueAt: t.dueAt,
    priority: t.priority, tags: t.tags, subtasks: t.subtasks, recurring: t.recurring, xp: t.xp
  });
  s.tasks = s.tasks.filter(x => x.id !== id);

  const per = deriveXpPerSection(s.tasks, "General", s.settings.hardMode);
  for (const st of s.tasks) st.xp = per;

  recordEvent(s,{ type:"TASK_DELETE", entity:"task", entityId:id, payload:{ before }});
  s.updatedAt = Date.now();
  return s;
}


export function markDone(state, id){
  const s = structuredClone(state);
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  if (t.status === "Done") return s;

  const before = structuredClone({
    id: t.id, title: t.title, notes: t.notes, status: t.status, dueAt: t.dueAt,
    priority: t.priority, tags: t.tags, subtasks: t.subtasks, recurring: t.recurring, xp: t.xp
  });

  t.status = "Done";
  t.updatedAt = Date.now();

  // award xp with hard-mode multiplier
  const mult = (s.settings.hardMode === "High") ? 1.25 : (s.settings.hardMode === "Low" ? 0.8 : 1.0);
  const gain = Math.max(1, Math.round((t.xp || 1) * mult));

  const next = applyXpAndLevel(s, gain);
  next.tasks = s.tasks;
  next.settings = s.settings;
  next.user = s.user;
  next.templates = s.templates;
  next.notifications = s.notifications;
  next.audit = s.audit;
  next.history = s.history;
  next.undo = s.undo;

  // streak (calendar day)
  const today = new Date().toISOString().slice(0,10);
  if (next.stats.lastDoneDate !== today) {
    if (next.stats.lastDoneDate) {
      const d0 = new Date(next.stats.lastDoneDate);
      const d1 = new Date(today);
      const diff = Math.round((d1-d0)/(1000*60*60*24));
      next.stats.streak = (diff === 1) ? (next.stats.streak+1) : 1;
    } else {
      next.stats.streak = 1;
    }
    next.stats.lastDoneDate = today;
  }

  recordEvent(next,{
    type:"TASK_DONE",
    entity:"task",
    entityId:id,
    payload:{ before, after: { ...before, status:"Done" }, gain }
  });

  // recurring: spawn next occurrence (based on dueAt)
  if (t.recurring){
    const nextDue = computeNextDue(t.dueAt, t.recurring);
    const spawned = {
      id: uid(),
      title: t.title,
      section: t.section || "General",
      notes: t.notes || "",
      status: "Open",
      priority: t.priority || 3,
      tags: Array.isArray(t.tags)? [...t.tags]: [],
      subtasks: Array.isArray(t.subtasks)? t.subtasks.map(st=>({id: uid(), title: st.title, done:false})) : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dueAt: nextDue,
      xp: 0,
      recurring: structuredClone(t.recurring),
    };
    next.tasks.push(spawned);
    const per2 = deriveXpPerSection(next.tasks, "General", next.settings.hardMode);
    for (const st of next.tasks) st.xp = per2;

    recordEvent(next,{
      type:"TASK_RECURRING_SPAWN",
      entity:"task",
      entityId: spawned.id,
      payload:{ from:id, to:spawned.id, dueAt: spawned.dueAt, rule: spawned.recurring }
    });
  }

  next.updatedAt = Date.now();
  return next;
}

export function undoEdit(state){
  const s = structuredClone(state);
  const item = s.undo?.stack?.shift?.();
  if (!item) return s;
  const t = s.tasks.find(x => x.id === item.id);
  if (!t) return s;
  Object.assign(t, item.prev);
  t.updatedAt = Date.now();
  // xp redistribute
  const per = deriveXpPerSection(s.tasks, "General", s.settings.hardMode);
  for (const st of s.tasks) st.xp = per;

  s.undo.redo.unshift(item);
  s.history.unshift({ t: Date.now(), type:"task_undo", meta:{ id:item.id }});
  recordEvent(s,{ type:"TASK_UNDO", entity:"task", entityId:item.id, payload:{} });
  s.updatedAt = Date.now();
  return s;
}

export function redoEdit(state){
  const s = structuredClone(state);
  const item = s.undo?.redo?.shift?.();
  if (!item) return s;
  const t = s.tasks.find(x => x.id === item.id);
  if (!t) return s;
  Object.assign(t, item.next);
  t.updatedAt = Date.now();
  const per = deriveXpPerSection(s.tasks, "General", s.settings.hardMode);
  for (const st of s.tasks) st.xp = per;

  s.undo.stack.unshift(item);
  s.history.unshift({ t: Date.now(), type:"task_redo", meta:{ id:item.id }});
  recordEvent(s,{ type:"TASK_REDO", entity:"task", entityId:item.id, payload:{} });
  s.updatedAt = Date.now();
  return s;
}


export function runAutoFail(state){
  const s = structuredClone(state);
  const now = Date.now();
  const failMs = (s.settings.autoFailMin || 60) * 60*1000;
  let changed = false;

  for (const t of s.tasks) {
    if (t.status === "Open" && t.dueAt && now > (t.dueAt + failMs)) {
      const before = structuredClone({ id:t.id, title:t.title, status:t.status, dueAt:t.dueAt, priority:t.priority, tags:t.tags, recurring:t.recurring });
      t.status = "Missed";
      t.updatedAt = now;
      recordEvent(s,{ type:"TASK_MISSED", entity:"task", entityId:t.id, payload:{ before, after:{...before, status:"Missed"} }});
      changed = true;
    }
  }
  if (changed) s.updatedAt = now;
  return s;
}


export function addTemplate(state, {name, task}){
  const s = structuredClone(state);
  const t = task || {};
  const tpl = {
    id: "tpl_" + Math.random().toString(16).slice(2),
    name: String(name||t.title||"Template").trim().slice(0,60) || "Template",
    task: {
      title: String(t.title||"").trim(),
      notes: String(t.notes||""),
      dueOffsetMin: parseInt(t.dueOffsetMin||0,10) || 0,
      priority: clampPriority(t.priority||3),
      tags: normalizeTags(t.tags||[]),
      subtasks: normalizeSubtasks(t.subtasks||[]),
      recurring: normalizeRecurring(t.recurring),
    }
  };
  s.templates = Array.isArray(s.templates) ? s.templates : [];
  s.templates.unshift(tpl);
  s.templates = s.templates.slice(0,100);

  recordEvent(s,{ type:"TEMPLATE_CREATE", entity:"template", entityId:tpl.id, payload:{ after: structuredClone(tpl) }});
  s.updatedAt = Date.now();
  return s;
}

export function renameTemplate(state, id, newName){
  const s = structuredClone(state);
  const tpl = (s.templates||[]).find(x=>x.id===id);
  if (!tpl) return s;
  const before = { id: tpl.id, name: tpl.name };
  tpl.name = String(newName||"").trim().slice(0,60) || tpl.name;
  recordEvent(s,{ type:"TEMPLATE_RENAME", entity:"template", entityId:id, payload:{ before, after:{ id:tpl.id, name:tpl.name } }});
  s.updatedAt = Date.now();
  return s;
}

export function deleteTemplate(state, id){
  const s = structuredClone(state);
  const tpl = (s.templates||[]).find(x=>x.id===id);
  s.templates = (s.templates||[]).filter(x=>x.id!==id);
  if (tpl){
    recordEvent(s,{ type:"TEMPLATE_DELETE", entity:"template", entityId:id, payload:{ before:{ id:tpl.id, name:tpl.name } }});
  }
  s.updatedAt = Date.now();
  return s;
}


export function createTaskFromTemplate(state, tplId){
  const tpl = (state.templates||[]).find(x=>x.id===tplId);
  if (!tpl) return state;
  const now = Date.now();
  const dueAt = tpl.task.dueOffsetMin ? (now + tpl.task.dueOffsetMin*60*1000) : null;
  return addTask(state, {
    title: tpl.task.title,
    notes: tpl.task.notes,
    dueAt,
    priority: tpl.task.priority,
    tags: tpl.task.tags,
    subtasks: tpl.task.subtasks,
    recurring: tpl.task.recurring,
  });
}
