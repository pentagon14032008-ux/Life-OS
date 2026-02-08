import { CONFIG } from "../config.js";

export const DEFAULT_STATE = () => ({
  schema: 2,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  user: { email: null, userId: null },

  settings: {
    hardMode: "Medium", // Low/Medium/High
    autoFailMin: 60,
    idleLockMin: CONFIG.IDLE_LOCK_MIN,
    updateChannel: CONFIG.DEFAULT_CHANNEL,
    analyticsEnabled: true,
    integrityEnabled: true,
    performanceMode: false,
    notificationsEnabled: true,
    wallpaper: null, // data url
  },

  stats: {
    xp: 0,
    level: 0,
    rank: "Beginner",
    streak: 0,
    lastDoneDate: null,
  },

  tasks: [], // {id,title,section,notes,status,createdAt,updatedAt,dueAt,priority,tags,subtasks,xp,recurring}

  templates: [], // {id,name,task:{title,notes,dueOffsetMin,priority,tags,subtasks,recurring}}
  notifications: [], // {id,t,level,title,body}

  audit: { events: [], ok: true, badIndex: null, lastCheckedAt: null },

  // {id,title,section,notes,status,createdAt,updatedAt,dueAt,priority,tags,subtasks,xp}
  history: [], // {t, type, meta}

  undo: { stack: [], redo: [] },
});

export function computeRank(level){
  // Simple: no max; after King of Kings -> Infinity
  const ladder = [
    { name:"Beginner", min:0 },
    { name:"Apprentice", min:5 },
    { name:"Adept", min:15 },
    { name:"Expert", min:30 },
    { name:"Master", min:60 },
    { name:"Grandmaster", min:100 },
    { name:"King", min:160 },
    { name:"King of Kings", min:240 },
  ];
  let r = ladder[0].name;
  for (const step of ladder) if (level >= step.min) r = step.name;
  if (level >= 400) r = "Infinity";
  return r;
}

export function hardModeMult(mode){
  if (mode === "Low") return 0.8;
  if (mode === "High") return 1.25;
  return 1.0;
}

export function deriveXpPerSection(tasks, section, hardMode){
  // v2.2: single "General" list by default; XP splits across the whole list (or section if you later enable sections)
  const count = (section === "General" || !section) ? (tasks.length || 1) : (tasks.filter(t => t.section === section).length || 1);
  const base = CONFIG.XP_PER_LEVEL / count;
  return Math.max(1, Math.round(base * hardModeMult(hardMode)));
}

export function applyXpAndLevel(state, deltaXp){
  const s = structuredClone(state);
  s.stats.xp = Math.max(0, s.stats.xp + deltaXp);
  s.stats.level = Math.floor(s.stats.xp / CONFIG.XP_PER_LEVEL);
  s.stats.rank = computeRank(s.stats.level);
  s.updatedAt = Date.now();
  return s;
}