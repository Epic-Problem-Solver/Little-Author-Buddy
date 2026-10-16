const src=require('fs').readFileSync('/workspace/little-writer-companion/app/ui/main.js','utf8').split('// ---- hiding')[0].split('\n').slice(4).join('\n');
global.window={devicePixelRatio:1};
eval(src+`;
const M=[{x:0,y:360,w:1920,h:1080,scale:1},{x:1920,y:0,w:2560,h:1440,scale:1.5}];
snap={origin:[0,0],monitors:M,desk_monitor:0,roam_all_monitors:true};
for(let i=0;i<500;i++){const a=randomSpot(),b=randomSpot();route(a,b)}
snap={origin:[0,0],monitors:M,desk_monitor:1,roam_all_monitors:false};
let off=0;for(let i=0;i<5000;i++){const s=randomSpot();if(s[0]<1920){off++;if(off<2)console.log(JSON.stringify(roamMonitors()),s, M===snap.monitors)}}console.log('off',off);`);
