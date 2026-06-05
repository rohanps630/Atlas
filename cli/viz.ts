/**
 * `atlas viz [-w <ws>] [--calls] [--repo <id>] [--out <file>]` (ADR 0018).
 *
 * Renders the workspace map to a self-contained, interactive HTML graph — no CDN,
 * no network, opens offline. Default is the readable **system** view (repos +
 * cross-repo contracts); `--calls` (or `--repo`) draws the dense function call
 * graph for drill-down. Pure rendering of data we already have.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildVizModel, type VizModel } from "../core/viz.js";
import { readAllTopologies, readMap, workspaceDir } from "./store.js";
import { pickWorkspace } from "./query.js";

export function runViz(args: string[]): number {
  const { workspace, repo, out, calls } = parseArgs(args);

  let ws: string;
  try {
    ws = pickWorkspace(workspace);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const tops = readAllTopologies(ws);
  let map;
  try {
    map = readMap(ws);
  } catch {
    map = undefined;
  }

  const level = repo || calls ? "calls" : "system";
  const model = buildVizModel(tops, map, { level, repo });
  if (model.nodes.length === 0) {
    console.error(
      `Nothing to visualize${repo ? ` for repo "${repo}"` : ""} in "${ws}". Run: atlas scan/refresh first.`,
    );
    return 1;
  }

  const suffix = repo ? `.${repo}` : level === "calls" ? ".calls" : "";
  const file = out ?? path.join(workspaceDir(ws), `graph${suffix}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderHtml(model, ws, repo), "utf8");

  const what = model.level === "system" ? "repos + cross-repo contracts" : `${model.nodes.length} nodes, ${model.edges.length} edges`;
  console.error(`wrote ${file}  (${what})`);
  console.error(`open it:  file://${path.resolve(file).replace(/\\/g, "/")}`);
  if (model.level === "system") console.error(`tip: drill into one repo's call graph with  atlas viz --repo <id> -w ${ws}`);
  return 0;
}

const PALETTE = [
  "#5b8ff9", "#f6932b", "#e15759", "#61d6c4", "#5ad45a",
  "#f2d04b", "#b07aa1", "#ff9da7", "#9c755f", "#9aa7b8",
];

function renderHtml(model: VizModel, ws: string, repo?: string): string {
  const colors: Record<string, string> = {};
  model.repos.forEach((r, i) => (colors[r] = PALETTE[i % PALETTE.length]!));
  const title = `atlas — ${ws}${repo ? ` / ${repo}` : model.level === "calls" ? " / calls" : ""}`;
  const data = JSON.stringify({ level: model.level, nodes: model.nodes, edges: model.edges, colors });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#0e1014;color:#cdd3df;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;overflow:hidden}
  #c{display:block;cursor:grab} #c.drag{cursor:grabbing}
  #hud{position:fixed;top:10px;left:10px;background:rgba(18,21,28,.92);border:1px solid #262c38;border-radius:10px;padding:11px 13px;max-width:260px}
  #hud h1{font-size:13px;margin:0 0 4px;color:#fff;font-weight:600}
  #hud .meta{color:#7f8796;font-size:11px;margin-bottom:8px}
  #q{width:100%;box-sizing:border-box;background:#0a0c10;border:1px solid #262c38;border-radius:6px;color:#cdd3df;padding:6px 8px;outline:none}
  #legend{margin-top:9px;max-height:42vh;overflow:auto} .lg{display:flex;align-items:center;gap:7px;margin:3px 0}
  .sw{width:11px;height:11px;border-radius:3px;flex:0 0 auto} .lg span{color:#9aa3b2;font-size:11px}
  #tip{position:fixed;pointer-events:none;background:#1b1f29;border:1px solid #333a47;border-radius:7px;padding:6px 9px;font-size:12px;display:none;max-width:52ch;z-index:5}
  #tip b{color:#fff} #tip .f{color:#828b9b;font-size:11px;margin-top:2px}
  #tip .c{color:#a9b4c6;font-size:11px;white-space:nowrap}
  #help{position:fixed;bottom:9px;left:11px;color:#5b6573;font-size:11px}
</style></head><body>
<canvas id="c"></canvas>
<div id="hud"><h1>${esc(title)}</h1><div class="meta" id="counts"></div>
  <input id="q" placeholder="search…" autocomplete="off" spellcheck="false">
  <div id="legend"></div></div>
<div id="tip"></div>
<div id="help">drag to pan · scroll to zoom · hover for detail · search to highlight</div>
<script>
const D = ${data};
const SYS = D.level === 'system';
const cv = document.getElementById('c'), ctx = cv.getContext('2d'), tip = document.getElementById('tip');
let cam = {x:0,y:0,s:1}, hover=null, hoverEdge=null, query='';
const byId={}; for(const n of D.nodes) byId[n.id]=n;
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const rad = n => SYS ? (n.kind==='repo' ? 11+Math.sqrt(n.degree)*1.3 : 7) : 2.5+Math.sqrt(n.degree)*1.6;
function resize(){ cv.width=innerWidth*devicePixelRatio; cv.height=innerHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); draw(); }
addEventListener('resize', resize);
(function fit(){ const xs=D.nodes.map(n=>n.x), ys=D.nodes.map(n=>n.y);
  const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  const w=maxx-minx||1,h=maxy-miny||1; cam.s=Math.min(innerWidth/(w+200), innerHeight/(h+200), SYS?1.4:2);
  cam.x=innerWidth/2-(minx+maxx)/2*cam.s; cam.y=innerHeight/2-(miny+maxy)/2*cam.s; })();
function label(n,x,y){ ctx.font=(SYS?13:11)/cam.s+'px ui-sans-serif,sans-serif'; ctx.lineWidth=3/cam.s;
  ctx.strokeStyle='rgba(10,12,16,.9)'; ctx.strokeText(n.label,x,y); ctx.fillStyle='#e7ecf5'; ctx.fillText(n.label,x,y); }
function draw(){
  ctx.clearRect(0,0,cv.width,cv.height); ctx.save(); ctx.translate(cam.x,cam.y); ctx.scale(cam.s,cam.s);
  const q=query.toLowerCase(), hi=id=>!q||byId[id].label.toLowerCase().includes(q);
  const act = hover ? new Set([hover.id]) : null;
  if(hover) for(const e of D.edges){ if(e.from===hover.id)act.add(e.to); if(e.to===hover.id)act.add(e.from); }
  for(const e of D.edges){ const a=byId[e.from],b=byId[e.to]; if(!a||!b)continue;
    const on = act ? (act.has(e.from)&&act.has(e.to)) : (q?(hi(e.from)||hi(e.to)):true);
    const w = SYS ? (1+Math.log2((e.weight||1)+1)) : (e.kind==='http'?1.4:0.6);
    ctx.strokeStyle = e===hoverEdge ? '#fff' : (e.kind==='http' ? (on?'#e15759':'rgba(225,87,89,.18)') : (on?'rgba(150,160,180,.55)':'rgba(120,130,150,.06)'));
    ctx.lineWidth=w/cam.s; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    if(SYS && e.weight>1){ ctx.fillStyle='#7f8796'; ctx.font=(10/cam.s)+'px sans-serif'; ctx.fillText(e.weight,(a.x+b.x)/2,(a.y+b.y)/2); } }
  for(const n of D.nodes){ const on = act?act.has(n.id):hi(n.id);
    ctx.globalAlpha=on?1:0.16; ctx.fillStyle = n.kind==='external' ? '#7c8696' : (D.colors[n.repo]||'#888');
    ctx.beginPath(); ctx.arc(n.x,n.y,rad(n),0,7); ctx.fill();
    if(n.kind==='external'){ ctx.lineWidth=1.5/cam.s; ctx.strokeStyle='#aeb7c6'; ctx.stroke(); }
    const show = on && (SYS || n===hover || (q&&hi(n.id)));
    if(show){ ctx.globalAlpha=1; label(n, n.x+rad(n)+3/cam.s, n.y+4/cam.s); } }
  ctx.globalAlpha=1; ctx.restore();
}
function resetTip(){ tip.style.display='none'; }
let drag=null;
cv.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y};cv.classList.add('drag')});
addEventListener('mouseup',()=>{drag=null;cv.classList.remove('drag')});
function segDist(px,py,a,b){ const dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy||1; let t=((px-a.x)*dx+(py-a.y)*dy)/L; t=Math.max(0,Math.min(1,t)); const x=a.x+t*dx,y=a.y+t*dy; return Math.hypot(px-x,py-y); }
addEventListener('mousemove',e=>{ if(drag){ cam.x=drag.cx+(e.clientX-drag.x); cam.y=drag.cy+(e.clientY-drag.y); draw(); return; }
  const wx=(e.clientX-cam.x)/cam.s, wy=(e.clientY-cam.y)/cam.s;
  let best=null,bd=1e9; for(const n of D.nodes){ const d=Math.hypot(n.x-wx,n.y-wy); if(d<bd){bd=d;best=n;} }
  const onNode = best && bd < rad(best)+6/cam.s;
  let he=null;
  if(SYS && !onNode){ let ed=1e9; for(const e2 of D.edges){ const a=byId[e2.from],b=byId[e2.to]; const d=segDist(wx,wy,a,b); if(d<ed){ed=d;he=e2;} } if(ed>8/cam.s) he=null; }
  if((onNode?best:null)!==hover || he!==hoverEdge){ hover=onNode?best:null; hoverEdge=he; draw(); }
  if(hover){ tip.style.display='block'; tip.style.left=(e.clientX+13)+'px'; tip.style.top=(e.clientY+13)+'px';
    tip.innerHTML = hover.kind==='repo' ? '<b>'+esc(hover.label)+'</b><div class="f">'+hover.degree+' functions</div>'
      : hover.kind==='external' ? '<b>'+esc(hover.label)+'</b><div class="f">external — consumed by '+hover.degree+' call site(s)</div>'
      : '<b>'+esc(hover.label)+'</b><div class="f">'+esc(hover.repo)+' · '+hover.degree+' link(s)</div><div class="f">'+esc(hover.id.split(':').slice(1).join(':'))+'</div>'; }
  else if(hoverEdge){ const c=(hoverEdge.contracts||[]); tip.style.display='block'; tip.style.left=(e.clientX+13)+'px'; tip.style.top=(e.clientY+13)+'px';
    tip.innerHTML='<b>'+esc(hoverEdge.from)+' → '+esc(hoverEdge.to)+'</b><div class="f">'+c.length+' contract(s)</div>'+c.slice(0,12).map(x=>'<div class="c">'+esc(x)+'</div>').join('')+(c.length>12?'<div class="f">… +'+(c.length-12)+' more</div>':''); }
  else resetTip(); });
cv.addEventListener('wheel',e=>{ e.preventDefault(); const f=Math.exp(-e.deltaY*0.001), wx=(e.clientX-cam.x)/cam.s, wy=(e.clientY-cam.y)/cam.s;
  cam.s*=f; cam.x=e.clientX-wx*cam.s; cam.y=e.clientY-wy*cam.s; draw(); },{passive:false});
document.getElementById('q').addEventListener('input',e=>{query=e.target.value;draw();});
const counts={}; for(const n of D.nodes) if(n.kind!=='external') counts[n.repo]=(counts[n.repo]||0)+1;
const exts=D.nodes.filter(n=>n.kind==='external').length;
document.getElementById('counts').textContent = SYS
  ? (Object.keys(counts).length+' repos · '+D.edges.length+' contract link(s)'+(exts?' · '+exts+' external':''))
  : (D.nodes.length+' nodes · '+D.edges.length+' edges');
document.getElementById('legend').innerHTML = Object.keys(D.colors).map(r=>'<div class="lg"><span class="sw" style="background:'+D.colors[r]+'"></span><span>'+esc(r)+'</span></div>').join('')
  + (exts?'<div class="lg"><span class="sw" style="background:#7c8696"></span><span>external endpoint</span></div>':'');
resize();
</script></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function parseArgs(args: string[]): { workspace?: string; repo?: string; out?: string; calls: boolean } {
  const o: { workspace?: string; repo?: string; out?: string; calls: boolean } = { calls: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") o.workspace = args[++i];
    else if (a === "--repo") o.repo = args[++i];
    else if (a === "--out") o.out = args[++i];
    else if (a === "--calls") o.calls = true;
  }
  return o;
}
