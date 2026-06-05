/**
 * `atlas viz [-w <ws>] [--repo <id>] [--out <file>]` (ADR 0018).
 *
 * Renders the workspace's merged map to a self-contained, interactive HTML
 * force-graph — no CDN, no network, opens offline. Pure rendering of data we
 * already have (`core/viz.ts` builds + lays out the model); writes to the data
 * store (ADR 0003) by default.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildVizModel, type VizModel } from "../core/viz.js";
import { readAllTopologies, readMap, workspaceDir } from "./store.js";
import { pickWorkspace } from "./query.js";

export function runViz(args: string[]): number {
  const { workspace, repo, out } = parseArgs(args);

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
    map = undefined; // not linked yet — intra-repo edges still render
  }

  const model = buildVizModel(tops, map, { repo });
  if (model.nodes.length === 0) {
    console.error(
      `Nothing to visualize${repo ? ` for repo "${repo}"` : ""} in "${ws}" ` +
        `(no connected nodes). Run: atlas scan/refresh first.`,
    );
    return 1;
  }

  const file = out ?? path.join(workspaceDir(ws), repo ? `graph.${repo}.html` : "graph.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderHtml(model, ws, repo), "utf8");

  console.error(`wrote ${file}  (${model.nodes.length} nodes, ${model.edges.length} edges)`);
  console.error(`open it:  file://${path.resolve(file).replace(/\\/g, "/")}`);
  return 0;
}

const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

function renderHtml(model: VizModel, ws: string, repo?: string): string {
  const colors: Record<string, string> = {};
  model.repos.forEach((r, i) => (colors[r] = PALETTE[i % PALETTE.length]!));
  const title = `atlas — ${ws}${repo ? ` / ${repo}` : ""}`;
  // Embedded data is plain JSON (node ids never contain "</script>").
  const data = JSON.stringify({ nodes: model.nodes, edges: model.edges, colors });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#0f1115;color:#cdd3df;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;overflow:hidden}
  #c{display:block;cursor:grab} #c.drag{cursor:grabbing}
  #hud{position:fixed;top:10px;left:10px;background:rgba(20,23,30,.9);border:1px solid #2a2f3a;border-radius:8px;padding:10px 12px;max-width:260px}
  #hud h1{font-size:13px;margin:0 0 6px;color:#fff;font-weight:600}
  #hud .meta{color:#7f8796;font-size:11px;margin-bottom:8px}
  #q{width:100%;box-sizing:border-box;background:#0b0d12;border:1px solid #2a2f3a;border-radius:6px;color:#cdd3df;padding:5px 8px;outline:none}
  #legend{margin-top:8px;max-height:40vh;overflow:auto} .lg{display:flex;align-items:center;gap:6px;margin:2px 0;cursor:default}
  .sw{width:10px;height:10px;border-radius:2px;flex:0 0 auto} .lg span{color:#9aa3b2;font-size:11px}
  #tip{position:fixed;pointer-events:none;background:#1b1f29;border:1px solid #333a47;border-radius:6px;padding:5px 8px;font-size:12px;display:none;max-width:46ch}
  #tip b{color:#fff} #tip .f{color:#7f8796;font-size:11px}
  #help{position:fixed;bottom:8px;left:10px;color:#5b6573;font-size:11px}
</style></head><body>
<canvas id="c"></canvas>
<div id="hud"><h1>${esc(title)}</h1><div class="meta" id="counts"></div>
  <input id="q" placeholder="search nodes…" autocomplete="off" spellcheck="false">
  <div id="legend"></div></div>
<div id="tip"></div>
<div id="help">drag to pan · scroll to zoom · hover for detail · search to highlight</div>
<script>
const D = ${data};
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const tip = document.getElementById('tip');
let cam = {x:0,y:0,s:1}, hover=null, query='';
function resize(){ cv.width = innerWidth*devicePixelRatio; cv.height = innerHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); draw(); }
addEventListener('resize', resize);
// fit to bounds
(function fit(){ let xs=D.nodes.map(n=>n.x), ys=D.nodes.map(n=>n.y);
  let minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  let w=maxx-minx||1,h=maxy-miny||1; let s=Math.min(innerWidth/(w+120), innerHeight/(h+120),2);
  cam.s=s; cam.x=innerWidth/2 - (minx+maxx)/2*s; cam.y=innerHeight/2 - (miny+maxy)/2*s; })();
const rad = n => 2.5 + Math.sqrt(n.degree)*1.6;
function draw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.save(); ctx.translate(cam.x,cam.y); ctx.scale(cam.s,cam.s);
  const q = query.toLowerCase();
  const hi = id => !q ? true : (byId[id].label.toLowerCase().includes(q));
  const active = hover ? new Set([hover.id]) : null;
  if (hover) for(const e of D.edges){ if(e.from===hover.id) active.add(e.to); if(e.to===hover.id) active.add(e.from); }
  // edges
  for(const e of D.edges){ const a=byId[e.from], b=byId[e.to]; if(!a||!b) continue;
    const on = active ? (active.has(e.from)&&active.has(e.to)) : (q ? (hi(e.from)||hi(e.to)) : true);
    ctx.strokeStyle = e.kind==='http' ? (on?'#e15759':'rgba(225,87,89,.15)') : (on?'rgba(140,150,170,.5)':'rgba(120,130,150,.06)');
    ctx.lineWidth = (e.kind==='http'?1.4:0.6)/cam.s; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
  // nodes
  for(const n of D.nodes){ const on = active ? active.has(n.id) : hi(n.id);
    ctx.globalAlpha = on?1:0.18; ctx.fillStyle = D.colors[n.repo]||'#888';
    ctx.beginPath(); ctx.arc(n.x,n.y,rad(n),0,7); ctx.fill();
    if(on && (n.degree>=8 || n===hover || (q && hi(n.id)))){ ctx.globalAlpha=1; ctx.fillStyle='#e7ecf5';
      ctx.font = (11/cam.s)+'px sans-serif'; ctx.fillText(n.label, n.x+rad(n)+2/cam.s, n.y+3/cam.s); } }
  ctx.globalAlpha=1; ctx.restore();
}
const byId={}; for(const n of D.nodes) byId[n.id]=n;
// interaction
let drag=null;
cv.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y};cv.classList.add('drag')});
addEventListener('mouseup',()=>{drag=null;cv.classList.remove('drag')});
addEventListener('mousemove',e=>{ if(drag){ cam.x=drag.cx+(e.clientX-drag.x); cam.y=drag.cy+(e.clientY-drag.y); draw(); return; }
  const wx=(e.clientX-cam.x)/cam.s, wy=(e.clientY-cam.y)/cam.s; let best=null,bd=1e9;
  for(const n of D.nodes){ const dx=n.x-wx,dy=n.y-wy,d=dx*dx+dy*dy; if(d<bd){bd=d;best=n;} }
  const near = best && Math.sqrt(bd) < (rad(best)+6/cam.s);
  if(near!==!!hover || (near&&best!==hover)){ hover=near?best:null; draw(); }
  if(hover){ tip.style.display='block'; tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px';
    tip.innerHTML='<b>'+esc(hover.label)+'</b> <span class="f">'+esc(hover.repo)+' · '+hover.degree+' link(s)</span><div class="f">'+esc(hover.id.split(':').slice(1).join(':'))+'</div>'; }
  else tip.style.display='none'; });
cv.addEventListener('wheel',e=>{ e.preventDefault(); const f=Math.exp(-e.deltaY*0.001);
  const wx=(e.clientX-cam.x)/cam.s, wy=(e.clientY-cam.y)/cam.s; cam.s*=f; cam.x=e.clientX-wx*cam.s; cam.y=e.clientY-wy*cam.s; draw(); },{passive:false});
document.getElementById('q').addEventListener('input',e=>{query=e.target.value;draw();});
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
// legend + counts
const counts={}; for(const n of D.nodes) counts[n.repo]=(counts[n.repo]||0)+1;
document.getElementById('counts').textContent = D.nodes.length+' nodes · '+D.edges.length+' edges · '+Object.keys(counts).length+' repo(s)';
document.getElementById('legend').innerHTML = Object.keys(D.colors).map(r=>'<div class="lg"><span class="sw" style="background:'+D.colors[r]+'"></span><span>'+esc(r)+' ('+(counts[r]||0)+')</span></div>').join('');
resize();
</script></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function parseArgs(args: string[]): { workspace?: string; repo?: string; out?: string } {
  const out: { workspace?: string; repo?: string; out?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") out.workspace = args[++i];
    else if (a === "--repo") out.repo = args[++i];
    else if (a === "--out") out.out = args[++i];
  }
  return out;
}
