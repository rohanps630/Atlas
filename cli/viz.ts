/**
 * `atlas viz [-w <ws>] [--repo <id>] [--out <file>]` (ADR 0018).
 *
 * Renders the workspace map to a self-contained, interactive HTML graph built on
 * Cytoscape.js (fcose layout + expand/collapse, all vendored & inlined — no CDN,
 * no network, opens offline). A compound hierarchy you drill into by clicking:
 * repo → module → function. Pure rendering of data we already have.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCyModel, type CyModel } from "../core/viz.js";
import { readAllTopologies, readMap, workspaceDir } from "./store.js";
import { pickWorkspace } from "./query.js";

// Tool root = three levels up from dist/cli/viz.js → vendored libs live in cli/vendor.
const TOOL_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const VENDOR = path.join(TOOL_ROOT, "cli", "vendor");
// Dependency order matters: layout-base → cose-base → fcose; cytoscape; expand-collapse.
const VENDOR_FILES = [
  "cytoscape.min.js",
  "layout-base.js",
  "cose-base.js",
  "cytoscape-fcose.js",
  "cytoscape-expand-collapse.js",
];

const PALETTE = [
  "#5b8ff9", "#f6932b", "#e15759", "#37c1b0", "#5ad45a",
  "#f2d04b", "#b07aa1", "#ff9da7", "#9c755f", "#9aa7b8",
];

export function runViz(args: string[]): number {
  const { workspace, repo, out } = parseArgs(args);

  let ws: string;
  try {
    ws = pickWorkspace(workspace);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let vendor: string[];
  try {
    vendor = VENDOR_FILES.map((f) => fs.readFileSync(path.join(VENDOR, f), "utf8"));
  } catch {
    console.error(`Missing vendored viz libraries in ${VENDOR}. (They ship with the repo under cli/vendor/.)`);
    return 1;
  }

  const tops = readAllTopologies(ws);
  let map;
  try {
    map = readMap(ws);
  } catch {
    map = undefined;
  }

  const model = buildCyModel(tops, map, { repo });
  if (model.counts.functions === 0) {
    console.error(`Nothing to visualize${repo ? ` for repo "${repo}"` : ""} in "${ws}". Run: atlas scan/refresh first.`);
    return 1;
  }

  const file = out ?? path.join(workspaceDir(ws), repo ? `graph.${repo}.html` : "graph.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderHtml(model, ws, repo, vendor), "utf8");

  const c = model.counts;
  console.error(`wrote ${file}  (${c.repos} repos · ${c.modules} modules · ${c.functions} functions · ${c.edges} edges)`);
  console.error(`open it:  file://${path.resolve(file).replace(/\\/g, "/")}`);
  console.error(`tip: top level shows the repos — click a node to drill into its modules, then functions.`);
  return 0;
}

function renderHtml(model: CyModel, ws: string, repo: string | undefined, vendor: string[]): string {
  const colors: Record<string, string> = {};
  model.repos.forEach((r, i) => (colors[r] = PALETTE[i % PALETTE.length]!));
  const title = `atlas — ${ws}${repo ? ` / ${repo}` : ""}`;
  const elements = [...model.nodes, ...model.edges];

  const head =
    "<!doctype html><html lang=en><head><meta charset=utf-8>" +
    "<title>" + esc(title) + "</title><meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<style>" + CSS + "</style></head><body>" +
    "<div id=cy></div>" +
    "<div id=panel><div id=ttl>" + esc(title) + "</div>" +
    "<div id=meta></div>" +
    "<input id=q placeholder='search functions / modules…' autocomplete=off spellcheck=false>" +
    "<div id=btns><button id=bExpand>Expand all</button><button id=bCollapse>Collapse all</button><button id=bFit>Fit</button></div>" +
    "<div id=info></div><div id=legend></div></div>" +
    "<div id=hint>click a node to drill in · scroll to zoom · drag to pan · the +/− badge collapses a group</div>";

  const vendorScripts = vendor.map((src) => "<script>" + src + "</script>").join("\n");
  const dataScript =
    "<script>var ELEMENTS=" + JSON.stringify(elements) +
    ";var COLORS=" + JSON.stringify(colors) +
    ";var META=" + JSON.stringify({ ...model.counts, title }) + ";</script>";

  return head + vendorScripts + dataScript + "<script>" + INIT + "</script></body></html>";
}

const CSS = `
html,body{margin:0;height:100%;background:#0d0f14;color:#cdd3df;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;overflow:hidden}
#cy{position:absolute;inset:0}
#panel{position:fixed;top:12px;left:12px;width:250px;max-height:calc(100vh - 24px);overflow:auto;background:rgba(17,20,27,.94);border:1px solid #262c38;border-radius:12px;padding:13px 14px;backdrop-filter:blur(6px)}
#ttl{font-size:14px;font-weight:600;color:#fff;margin-bottom:3px}
#meta{font-size:11px;color:#7f8796;margin-bottom:9px}
#q{width:100%;box-sizing:border-box;background:#0a0c11;border:1px solid #262c38;border-radius:7px;color:#cdd3df;padding:7px 9px;outline:none}
#btns{display:flex;gap:6px;margin:9px 0}
#btns button{flex:1;background:#161b24;border:1px solid #2a313d;color:#aeb7c6;border-radius:7px;padding:6px 4px;font-size:11px;cursor:pointer}
#btns button:hover{background:#1d2430;color:#fff}
#info{font-size:12px;border-top:1px solid #232a36;margin-top:6px;padding-top:8px;min-height:14px}
#info b{color:#fff}#info .f{color:#828b9b;font-size:11px;margin-top:2px;word-break:break-all}
#legend{margin-top:10px;border-top:1px solid #232a36;padding-top:9px}
.lg{display:flex;align-items:center;gap:7px;margin:3px 0}.sw{width:11px;height:11px;border-radius:3px}.lg span{font-size:11px;color:#9aa3b2}
#hint{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);color:#5b6573;font-size:11px;background:rgba(13,15,20,.7);padding:4px 10px;border-radius:20px}
`;

// Browser init — plain JS only (no template literals / ${} — this is literal text).
const INIT = `
// Loaded via <script> tags after cytoscape, the extensions may already have
// auto-registered — registering again throws, so guard each use().
try { cytoscape.use(window.cytoscapeFcose); } catch (e) {}
try { cytoscape.use(window.cytoscapeExpandCollapse); } catch (e) {}
var rc = function(ele){ return COLORS[ele.data('repo')] || '#7c8696'; };
var cy = cytoscape({
  container: document.getElementById('cy'), elements: ELEMENTS, wheelSensitivity: 0.2,
  style: [
    { selector: 'node', style: { 'label':'data(label)','font-size':10,'color':'#dfe5ef','text-wrap':'ellipsis','text-max-width':130,'min-zoomed-font-size':7 } },
    { selector: 'node[kind="repo"]', style: { 'shape':'round-rectangle','background-color':rc,'background-opacity':0.10,'border-width':2,'border-color':rc,'text-valign':'top','text-halign':'center','font-size':15,'font-weight':'bold','color':'#fff','padding':16 } },
    { selector: 'node[kind="module"]', style: { 'shape':'round-rectangle','background-color':rc,'background-opacity':0.06,'border-width':1,'border-color':rc,'text-valign':'top','font-size':10,'color':'#aeb7c6','padding':9 } },
    { selector: 'node[kind="fn"]', style: { 'shape':'ellipse','background-color':rc,'width':15,'height':15,'font-size':8,'text-valign':'bottom','color':'#97a1b2' } },
    { selector: '.cy-expand-collapse-collapsed-node', style: { 'text-valign':'center','text-halign':'center','font-size':14,'font-weight':'bold','color':'#fff','background-opacity':0.18 } },
    { selector: 'edge', style: { 'curve-style':'bezier','width':1,'line-color':'rgba(150,160,180,.26)','target-arrow-shape':'triangle','target-arrow-color':'rgba(150,160,180,.26)','arrow-scale':0.7 } },
    { selector: 'edge[kind="repohttp"]', style: { 'width':function(e){return Math.min(2+Math.sqrt(e.data('weight')||1)*1.4,10);},'line-color':'#e15759','line-style':'dashed','target-arrow-shape':'triangle','target-arrow-color':'#e15759','curve-style':'bezier','label':function(e){return e.data('weight');},'font-size':11,'color':'#f4a6a7','text-background-color':'#15171d','text-background-opacity':0.9,'text-background-padding':2,'z-index':30 } },
    { selector: 'node:selected', style: { 'border-width':3,'border-color':'#fff' } },
    { selector: '.dim', style: { 'opacity':0.08 } },
    { selector: '.hl', style: { 'border-width':3,'border-color':'#ffd166','background-opacity':0.28 } }
  ],
  layout: { name:'preset' }
});
var api = cy.expandCollapse({
  layoutBy: { name:'fcose', animate:false, randomize:false, fit:false, nodeSeparation:220, idealEdgeLength:90, nodeRepulsion:20000, padding:24 },
  fisheye:false, animate:true, animationDuration:220, undoable:false, cueEnabled:true, expandCollapseCueSize:18, expandCollapseCueLineSize:10
});
function relayout(){ cy.layout({ name:'fcose', animate:false, randomize:true, nodeSeparation:520,
  idealEdgeLength: function(e){ return e.data('kind')==='repohttp'?300:90; }, nodeRepulsion:90000, gravity:0.05, gravityRangeCompound:1.5,
  packComponents:false, padding:80, quality:'proof' }).run();
  cy.fit(undefined,80); }
api.collapseAll(); relayout();
cy.on('tap','node', function(evt){ var n=evt.target; showInfo(n); if(api.isExpandable(n)) api.expand(n); });
cy.on('tap','edge', function(evt){ var e=evt.target; if(e.data('kind')!=='repohttp') return;
  var c=e.data('contracts')||[]; document.getElementById('info').innerHTML='<b>'+esc(String(e.data('source')).replace('repo:',''))+' → '+esc(String(e.data('target')).replace('repo:',''))+'</b><div class="f">'+e.data('weight')+' contract(s)</div>'+c.slice(0,24).map(function(x){return '<div class="f">'+esc(x)+'</div>';}).join(''); });
cy.on('tap', function(evt){ if(evt.target===cy){ cy.elements().unselect(); document.getElementById('info').innerHTML=''; } });
function descCount(n){ return n.isParent()? n.descendants().filter('[kind="fn"]').length : 0; }
function showInfo(n){ var k=n.data('kind'); var h='';
  if(k==='repo'){ h='<b>'+esc(n.data('label'))+'</b><div class="f">repo · '+descCount(n)+' functions</div>'; }
  else if(k==='module'){ h='<b>'+esc(n.data('label'))+'</b><div class="f">'+esc(n.data('full'))+'</div><div class="f">'+descCount(n)+' functions</div>'; }
  else { h='<b>'+esc(n.data('label'))+'</b><div class="f">'+esc(n.data('repo'))+'</div><div class="f">'+esc(n.data('file')||'')+':'+(n.data('line')||'')+'</div><div class="f">'+n.connectedEdges().length+' link(s)</div>'; }
  document.getElementById('info').innerHTML=h; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
document.getElementById('bExpand').onclick=function(){ api.expandAll(); relayout(); };
document.getElementById('bCollapse').onclick=function(){ api.collapseAll(); relayout(); };
document.getElementById('bFit').onclick=function(){ cy.fit(undefined,55); };
var qEl=document.getElementById('q'); qEl.addEventListener('input', function(){ var q=qEl.value.trim().toLowerCase();
  cy.batch(function(){ cy.elements().removeClass('hl dim'); if(!q) return;
    var m=cy.nodes().filter(function(n){ return (n.data('label')||'').toLowerCase().indexOf(q)>=0; });
    cy.elements().addClass('dim'); m.removeClass('dim').addClass('hl');
    m.ancestors().removeClass('dim'); var e=m.connectedEdges(); e.removeClass('dim'); e.connectedNodes().removeClass('dim'); }); });
document.getElementById('meta').textContent = META.repos+' repos · '+META.modules+' modules · '+META.functions+' functions';
document.getElementById('legend').innerHTML = Object.keys(COLORS).map(function(r){ return '<div class="lg"><span class="sw" style="background:'+COLORS[r]+'"></span><span>'+esc(r)+'</span></div>'; }).join('')
  + '<div class="lg"><span class="sw" style="background:#e15759"></span><span>cross-repo contract</span></div>';
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function parseArgs(args: string[]): { workspace?: string; repo?: string; out?: string } {
  const o: { workspace?: string; repo?: string; out?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workspace" || a === "-w") o.workspace = args[++i];
    else if (a === "--repo") o.repo = args[++i];
    else if (a === "--out") o.out = args[++i];
  }
  return o;
}
