
export function drawXpChart(canvas, state){
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width = canvas.clientWidth * devicePixelRatio;
  const H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0,0,W,H);

  const events = (state.audit?.events && Array.isArray(state.audit.events)) ? state.audit.events : [];
  const legacy = Array.isArray(state.history) ? state.history : [];

  const now = Date.now();
  const days = [];
  for (let i=29;i>=0;i--){
    const d = new Date(now);
    d.setDate(d.getDate()-i);
    const k = d.toISOString().slice(0,10);
    days.push({k, xp:0});
  }
  const byDay = new Map(days.map(x=>[x.k,0]));
  const dayKey = (ts)=> new Date(ts).toISOString().slice(0,10);

  for (const ev of events){
    if (ev.type === "TASK_DONE"){
      const k = dayKey(ev.timestamp||0);
      byDay.set(k, (byDay.get(k)||0) + (ev.payload?.gain||0));
    }
  }
  if (events.length===0){
    // fallback: legacy doesn't always have gain, count as 0.. use 1
    for (const h of legacy){
      if (h.type === "task_done"){
        const k = dayKey(h.t||0);
        byDay.set(k, (byDay.get(k)||0) + (h.meta?.gain||0));
      }
    }
  }
  for (const d of days) d.xp = byDay.get(d.k)||0;

  const data = days.map(d=>d.xp);
  const max = Math.max(1, ...data);
  const min = 0;

  const pad = 12*devicePixelRatio;
  const xStep = (W - pad*2) / (data.length - 1);
  const scaleY = (H - pad*2) / (max - min || 1);

  // grid line
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(pad, H-pad);
  ctx.lineTo(W-pad, H-pad);
  ctx.stroke();

  // line
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2*devicePixelRatio;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + i*xStep;
    const y = H - pad - (v - min) * scaleY;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // points (sparse)
  ctx.globalAlpha = 0.9;
  for (let i=0;i<data.length;i+=3){
    const v=data[i];
    const x = pad + i*xStep;
    const y = H - pad - (v - min) * scaleY;
    ctx.beginPath();
    ctx.arc(x,y,2.4*devicePixelRatio,0,Math.PI*2);
    ctx.fillStyle="#fff";
    ctx.fill();
  }

  // labels
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#fff";
  ctx.font = `${12*devicePixelRatio}px ui-monospace`;
  ctx.fillText(`0`, pad, pad+14*devicePixelRatio);
  ctx.fillText(`${max} XP/day`, pad, pad+28*devicePixelRatio);
}
