import re,sys
pid=sys.argv[1];hits=0;pats=[b'CANARYqz7XK',b'zebra-violet',b'C\x00A\x00N\x00A\x00R\x00Y\x00q\x00z\x00']
for l in open(f'/proc/{pid}/maps'):
    a,b=[int(x,16) for x in l.split()[0].split('-')]
    if 'r' not in l.split()[1] or b-a>1<<30: continue
    try:
        with open(f'/proc/{pid}/mem','rb') as f: f.seek(a); d=f.read(b-a)
    except Exception: continue
    for p in pats: hits+=d.count(p)
print(pid,open(f'/proc/{pid}/cmdline').read().replace('\0',' ')[:60],'hits',hits)
