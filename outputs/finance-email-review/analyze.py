import json,re,difflib,functools
from pathlib import Path
base=Path(__file__).parent
d=json.loads((base/'source.json').read_text())
norm=lambda x:str(x or '').strip().lower()
clean=lambda x:re.sub(r'[^a-z0-9 ]',' ',norm(x))
generic=set('pty ltd limited cc construction constructions project projects trading enterprise enterprises services solutions holdings and the'.split())
def core(x): return ' '.join(t for t in clean(x).split() if t not in generic)
def ratio(a,b): return difflib.SequenceMatcher(None,a,b).ratio() if a and b else 0
def score(a,b): return max(ratio(clean(a),clean(b)),ratio(core(a),core(b)))
ps=d['participants']; apps=d['applications']
accepted=[a for a in apps if norm(a.get('applicationStatus') or (a.get('decision') or {}).get('status'))=='accepted']
ae=lambda a:norm(a.get('email') or a.get('applicantEmail'))
@functools.lru_cache(None)
def pa_id(pid,email): return [a for a in apps if a.get('participantId')==pid or (email and ae(a)==email)]
def pa(p): return pa_id(p['id'],norm(p.get('email')))
def supported(aa): return any(a in accepted and norm(a.get('programId')) for a in aa)
hidden={str(c['id']) for m in d['finance']['members'] if norm(m.get('email')).endswith('@example.com') for c in m.get('companies',[])}
rows=[]; counts={}
for c in d['finance']['companies']:
 name=c.get('name') or c.get('company') or c.get('companyName') or 'Unknown'; email=norm(c.get('email'))
 if str(c['id']) in hidden or email.endswith(('@example.com','@lepharo.co.za','@quantilytix.co.za')) or email=='lepharo@gmail.com': continue
 exactemail=[p for p in ps if email and norm(p.get('email'))==email]
 exactname=[p for p in ps if norm(name) and norm(p.get('beneficiaryName'))==norm(name)]
 matches=exactemail or exactname
 p=matches[0] if len(matches)==1 else None
 direct=[a for a in accepted if email and ae(a)==email]
 original='Supported' if supported(direct) else ('No programme' if matches else 'No participant link')
 current='Supported' if supported(direct or ([a for a in pa(p) if a in accepted] if p else [])) else ('No programme' if p else 'No participant link')
 counts[current]=counts.get(current,0)+1
 if original=='Supported': continue
 candidates=sorted([{'id':q['id'],'name':q.get('beneficiaryName',''),'email':q.get('email',''),'score':round(score(name,q.get('beneficiaryName')),3),'programmes':list(dict.fromkeys(a.get('programName') or a.get('programId') for a in pa(q) if a in accepted and a.get('programId'))),'applicationStatuses':list(dict.fromkeys(str(a.get('applicationStatus') or (a.get('decision') or {}).get('status') or 'Unspecified') for a in pa(q)))} for q in ps],key=lambda q:q['score'],reverse=True)
 if p: candidates.sort(key=lambda q:q['id']!=p['id'])
 rows.append({'id':str(c['id']),'name':name,'email':c.get('email',''),'originalStatus':original,'currentStatus':current,'exactType':'Email' if exactemail else ('Name' if len(exactname)==1 else ''),'candidates':candidates[:3]})
(base/'analysis.json').write_text(json.dumps({'retrievedAt':d['retrievedAt'],'counts':counts,'rows':rows},indent=2))
print(json.dumps({'counts':counts,'reviewRows':len(rows)}))
for r in rows: print(json.dumps(r,ensure_ascii=True))
