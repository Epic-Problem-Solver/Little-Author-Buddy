const fs=require('fs');const src=fs.readFileSync(process.argv[2],'utf8');
const body=src.split('// ---- state')[0].replace(/^const T[^\n]*\n/m,'').replace(/^const \$[^\n]*\n/m,'').replace(/^const comp[^\n]*\n/m,'');
global.window={devicePixelRatio:1};global.innerWidth=0;global.innerHeight=0;global.document={};
const comp={style:{}},bubble={style:{}};
eval(body+';global.G={seam,route,monitorsCss,pickHide,randomSpot,deskPos,setSnap:s=>{snap=s},snapget:()=>snap}');
function inGap(p,ms){const c=[p[0]+60,p[1]+55];return !ms.some(m=>c[0]>=m.x-1&&c[0]<=m.x+m.w+1&&c[1]>=m.y-1&&c[1]<=m.y+m.h+1)}
// layout: L 1920x1080 at y=120 (bottom aligned), R 2560x1440 at x=1920 y=0 -> R scale 1.5
const mons=[{x:0,y:360,w:1920,h:1080,scale:1,primary:true},{x:1920,y:0,w:2560,h:1440,scale:1.5,primary:false}];
G.setSnap({origin:[0,0],monitors:mons,desk_monitor:0,roam_all_monitors:true,fg_rect:null});
let bad=0,n=0;
for(let i=0;i<500;i++){const a=G.randomSpot(),b=G.randomSpot();const r=G.route(a,b);let prev=a;
 for(const p of r){for(let t=0;t<=1;t+=0.02){const q=[prev[0]+(p[0]-prev[0])*t,prev[1]+(p[1]-prev[1])*t];n++;if(inGap(q,G.monitorsCss()))bad++;}prev=p;}}
console.log('route samples',n,'in-gap',bad);
let rs=0;for(let i=0;i<1000;i++){if(inGap(G.randomSpot(),G.monitorsCss()))rs++}console.log('randomSpot in gap',rs);
G.setSnap({origin:[0,0],monitors:mons,desk_monitor:1,roam_all_monitors:false,fg_rect:null});
const ds=G.deskPos();console.log('desk on mon1',ds, ds[0]>1920);
let off=0;for(let i=0;i<500;i++){const s=G.randomSpot();if(s[0]<1920){off++;if(off<2)console.log("OFF",s,JSON.stringify(G.snapget()))}}console.log('roam=desk-only spots off desk mon',off);
// hides: outer edges only
G.setSnap({origin:[0,0],monitors:mons,desk_monitor:0,roam_all_monitors:true,fg_rect:null});
const lines={};for(let i=0;i<500;i++){const h=G.pickHide();lines[h.line+h.side]=(lines[h.line+h.side]||0)+1}console.log('hide lines',lines);
const h=G.pickHide();const k=h.line===0?1:1.5;const w=120*k;const vis=h.side==='left'?(h.pos[0]+w-h.line)/w:(h.line-h.pos[0])/w;console.log('visible frac',vis.toFixed(2));
G.setSnap({origin:[0,0],monitors:mons,desk_monitor:0,roam_all_monitors:true,fg_rect:[300,500,800,600]});
const fl={};for(let i=0;i<500;i++){const h=G.pickHide();fl[h.line+h.side]=(fl[h.line+h.side]||0)+1}console.log('with window',fl);
console.log('faces',[...new Set(Array.from({length:200},()=>G.pickHide().face))]);
G.setSnap({origin:[0,0],monitors:mons,desk_monitor:1,roam_all_monitors:false,fg_rect:null});
const xs=[];for(let i=0;i<500;i++){const s=G.randomSpot();if(s[0]<1920)xs.push(s.map(Math.round))}console.log(xs.slice(0,5),G.monitorsCss());
