# Generates desk-labeled.html/.svg from ../character.svg (v0.7.4 desk, data-side=right, typing + laptop)
ch=open('../character.svg').read()
import re
ch=re.sub(r'\s*<path class="lw-desk-top"[^>]*/>','',ch)  # debug: top plane is not visible from the viewer
ch=ch.replace('M172 158L218 143V199L172 214z','M172 158L218 170V217H172z').replace('M22 150L172 158V214L22 207z','M22 150L172 158V217H22z').replace('M24 196L170 203V211L24 204z','M25 205H170V214H25z').replace('M176 153L226 137V144L176 160z','M176 153L226 165V172L176 160z')  # debug: side panel + slab lip slope DOWN as they recede
ch=ch.replace('data-face="idle" data-body="idle"','data-face="focused" data-body="typing"').replace('<svg class="lw-char"','<svg x="0" y="0" class="lw-char"')
L,R,W=-262,262,205
labels=[
 (["Hands: peek out either side","of the laptop, behind it"],L,-22,88,122),
 (["Laptop (moved to the desk's middle):","lid BACK faces us, screen faces buddy"],L,14,112,104),
 (["Desk TOP (hidden): tilts toward the","buddy, away from us; only its front","slab edge is visible from here"],L,50,150,147),
 (["Laptop base (keyboard deck),","resting on the slab edge"],L,96,96,148),
 (["Top slab – front overhang edge","(the topmost visible desk line)"],L,124,50,152),
 (["BIG PANEL facing the viewer = the BACK","of the desk (plain, no drawer), now taller"],L,154,80,185),
 (["Bottom shade band (level, along the","base; desk bottom is level at y=217)"],L,198,60,210),
 (["Buddy: sits BEHIND the desk, right","of the tool (body centre 164,110)"],R,-22,190,80),
 (["Top slab – side lip (slopes DOWN","as it recedes, toward the buddy)"],R,40,212,165),
 (["SIDE PANEL: RIGHT end of the desk","(buddy's side). Near edge x≈172, far","edge x≈218; top slopes DOWN, bottom level"],R,90,198,195),
 (["Blue arrow = way the desk FACES:","the seat side is the far side,","where the buddy sits (away from us)"],R,160,188,128),
]
out=[]
for lines,x,y,tx,ty in labels:
    h=len(lines)*11+6
    out.append(f'<rect x="{x}" y="{y}" width="{W}" height="{h}" rx="3" fill="#fffdf7" stroke="#c0392b" stroke-width=".8"/>')
    out+= [f'<text x="{x+5}" y="{y+12+i*11}">{l}</text>' for i,l in enumerate(lines)]
    ax = x+W if x<0 else x
    out.append(f'<line x1="{ax}" y1="{y+h/2}" x2="{tx}" y2="{ty}" stroke="#c0392b" stroke-width=".9"/><circle cx="{tx}" cy="{ty}" r="2.2" fill="#c0392b"/>')
arrow='<g stroke="#1565c0" fill="#1565c0" stroke-width="2.5"><line x1="168" y1="144" x2="188" y2="128"/><path d="M194 123l-12 2 7 8z" stroke-width="1"/></g>'
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-270 -50 750 290" width="2250" height="870" font-family="system-ui,sans-serif" font-size="9" fill="#241414">
<rect x="-270" y="-50" width="750" height="290" fill="#f3e4cb"/>
<text x="-262" y="-34" font-size="11" font-weight="700">Little Writer v0.7.4 desk (DEBUG variant: no top plane, laptop centred) — labels (data-side=right, typing · laptop, 3×)</text>
{ch}
{arrow}
{''.join(out)}
</svg>'''
open('desk-labeled.html','w').write(f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../lw-character.css">
<style>body{{margin:0;overflow:hidden}} .lw-char *{{animation-play-state:paused!important}} /* debug-only layout: laptop centred on the desk */ .lw-char .lw-tool-laptop{{transform:translate(47px,4px)}} .lw-char[data-body=typing] .lw-hand-mid.lw-hand-l{{transform:translate(-9px,20px)}} .lw-char[data-body=typing] .lw-hand-mid.lw-hand-r{{transform:translate(-75px,0px)}}</style></head><body>{svg}</body></html>''')
open('desk-labeled.svg','w').write(svg.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-270','<?xml-stylesheet href="../lw-character.css"?>\n<?xml-stylesheet href="debug-overrides.css"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="-270',1))

open('debug-overrides.css','w').write('.lw-char .lw-tool-laptop{transform:translate(47px,4px)} .lw-char[data-body=typing] .lw-hand-mid.lw-hand-l{transform:translate(-9px,20px)} .lw-char[data-body=typing] .lw-hand-mid.lw-hand-r{transform:translate(-75px,0px)}')
