# Regenerates preview.html with character.svg inlined (inline SVG is required for CSS vars/animations).
svg=open('character.svg').read()
desk=open('desk.svg').read()
close=open('ui-close.svg').read();gear=open('ui-gear.svg').read()
faces=['idle','blink','focused','sleepy','asleep','curious','excited','proud','shy']
def cell(face='idle',body='idle',label='',tool='laptop',side='right',extra='',src=None):
    s=(src or svg).replace('data-tool="laptop"',f'data-tool="{tool}"').replace('data-side="right"',f'data-side="{side}"' if side else '')
    s=s.replace('data-face="idle"',f'data-face="{face}"').replace('data-body="idle"',f'data-body="{body}"')
    s=s.replace('width="240" height="220"','width="180" height="165"').replace('class="lw-char',f'{extra} class="lw-char',1)
    return f'<figure>{s}<figcaption>{label}</figcaption></figure>'
g=lambda cells:'<div class="grid">'+''.join(cells)+'</div>'
sections=[
 ('Face states (data-face)',[cell(f,label=f) for f in faces]),
 ('Desk scene: data-body=typing × data-tool (data-side=right, the default)',[cell('focused','typing','typing · '+t,t) for t in ['laptop','typewriter','pen']]),
 ('data-side=left (mirrored: tool right, buddy left)',[cell('focused','typing','left · '+t,t,'left') for t in ['laptop','typewriter','pen']]),
 ('Sleeping + desk-alone (data-body=away-from-desk / desk.svg)',[cell('asleep','sleeping','sleeping · '+t,t) for t in ['laptop','typewriter','pen']]+[cell(body='away-from-desk',label='away-from-desk · '+t,tool=t) for t in ['laptop','pen']]+[cell(label='desk.svg · typewriter',tool='typewriter',src=desk)]),
 ('Wandering (data-dir mirrors; hand layering follows direction)',[cell('idle','walking','walking → right'),cell('idle','walking','walking ← left',extra='data-dir="left"'),cell('excited','rushing','rushing → right'),cell('excited','rushing','rushing ← left',extra='data-dir="left"'),cell('excited','racing','racing (legacy)'),cell('curious','peeking','peeking'),cell('idle','watching','watching'),cell('idle','away','away (alias)')]),
 ('Derived shade/hands from --body only',[cell('proud','idle',f'--body {b}',extra=f'style="--body:{b}"') for b in ['#cfe6ff','#ffd0dc','#d6f0c4','#3a3a48','#1f1a17']]),
]
body=''.join(f'<h2>{t}</h2>{g(c)}' for t,c in sections)
html=f'''<!doctype html><html><head><meta charset="utf-8"><title>Little Author Buddy — character preview v0.7</title>
<link rel="stylesheet" href="lw-character.css"><script src="lw-color.js"></script><style>
body{{font:14px system-ui,sans-serif;background:#ead5b3;color:#241414;margin:20px}}
h2{{margin:16px 0 6px;font-size:17px}}.grid{{display:flex;flex-wrap:wrap;gap:10px}}
figure{{margin:0;overflow:hidden;background:#f3e4cb;border-radius:12px;padding:6px;text-align:center}}figcaption{{font-weight:600;font-size:13px}}
#ctl label{{margin-right:14px}}#ctl{{background:#f3e4cb;padding:10px;border-radius:10px;display:inline-block}}
.hov .lw-ui{{transform:scale(1.12)}}.hov .lw-ui-glyph{{transform:rotate(90deg)}}.hov .lw-ui-gear .lw-ui-bg{{fill:#f4dfbf}}.hov .lw-ui-close .lw-ui-bg{{fill:#e9867a}}
</style></head><body><h1>Little Author Buddy v0.7 — all states</h1>
<div id="ctl"><label>--body <input type="color" data-v="--body" value="#e8cfa9"></label><label>--outline <input type="color" data-v="--outline" value="#241414"></label>
<label><input type="checkbox" id="js"> use lwApplyColor() fallback</label>
<button data-p="#e8cfa9,#241414">Beige</button><button data-p="#cfe6ff,#1b2340">Sky</button><button data-p="#ffd0dc,#3a1424">Rose</button><button data-p="#d6f0c4,#1d2b14">Mint</button><button data-p="#2e2a35,#0d0b10">Night</button>
<span id="sh"></span></div>
{body}
<h2>UI buttons (ui-close.svg, ui-gear.svg — hover to test; right pair forced hover)</h2><div class="grid"><figure style="padding:14px">{close} {gear} &nbsp; <span class="hov">{close} {gear}</span><figcaption>normal · hover</figcaption></figure></div>
<script>
const ins=[...document.querySelectorAll('input[data-v]')],chars=()=>document.querySelectorAll('.lw-char:not([style])');
function apply(){{chars().forEach(c=>{{c.style.removeProperty('--shade');c.style.removeProperty('--hands');
  if(document.getElementById('js').checked) lwApplyColor(c,ins[0].value); else c.style.setProperty('--body',ins[0].value);
  c.style.setProperty('--outline',ins[1].value);}});
  document.getElementById('sh').textContent=' derived shade: '+lwDeriveShade(ins[0].value);}}
ins.forEach(i=>i.oninput=apply);document.getElementById('js').onchange=apply;
document.querySelectorAll('button[data-p]').forEach(b=>b.onclick=()=>{{b.dataset.p.split(',').forEach((v,k)=>ins[k].value=v);apply()}});
</script></body></html>'''
open('preview.html','w').write(html)
