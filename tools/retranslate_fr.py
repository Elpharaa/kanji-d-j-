#!/usr/bin/env python3
"""Seconde passe sur data/jmfr_auto.json : repère les définitions restées en anglais (ou en double),
les retraduit avec un petit cadre de phrase (« the X »), et retire du fichier les entrées encore douteuses
(l'appli affichera alors l'anglais d'origine, plus fiable qu'une traduction fausse).
Usage : python3 tools/retranslate_fr.py MODELE_CT2|stub"""
import gzip, json, re, sys
from wordfreq import zipf_frequency as z
model = sys.argv[1]
auto = json.load(open('data/jmfr_auto.json', encoding='utf-8'))
rows = {}
for n in ('rest', 'common'):
    for r in json.loads(gzip.open('data/jmdict_%s.gz' % n).read().decode('utf-8')): rows[str(r[0])] = r
W = lambda s: re.findall(r"[a-zàâçéèêëîïôûùüÿœ]{3,}", s.lower())
def english_only(g):
    ws = W(g)
    return any(z(w, 'fr') < 1.0 or z(w, 'en') - z(w, 'fr') >= 1.2 for w in ws)
def split(v): return [[g.strip() for g in s.split(';')] for s in v.split('|')]
suspect = {}   # id -> liste des glosses anglaises à retraduire
for k, v in auto.items():
    src = {g.strip().lower() for s in rows[k][4].split('|') for g in s.split(';')}
    bad = []
    for s in split(v[2:]):
        for g in s:
            if (g.lower() in src and not g[:1].isupper() and english_only(g)) or re.search(r'["«»{}]|\.\.\.', g): bad.append(g)
    if bad or len(set(g for s in split(v[2:]) for g in s)) < sum(len(s) for s in split(v[2:])): suspect[k] = bad
print('entrées suspectes :', len(suspect), flush=True)
todo = sorted({g for b in suspect.values() for g in b if len(g) <= 40 and '(' not in g})
tr = {}
if model == 'stub': tr = {g: g + '*' for g in todo}
else:
    import ctranslate2, transformers
    tok = transformers.AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-fr')
    tt = ctranslate2.Translator(model, device='cpu', inter_threads=2, intra_threads=2)
    for i in range(0, len(todo), 2000):
        chunk = todo[i:i + 2000]
        src = [tok.convert_ids_to_tokens(tok.encode('the ' + g)) for g in chunk]
        out = tt.translate_batch(src, beam_size=4, max_batch_size=64, max_decoding_length=40)
        for g, o in zip(chunk, out):
            t = tok.decode(tok.convert_tokens_to_ids(o.hypotheses[0]), skip_special_tokens=True).strip().rstrip('.')
            m = re.match(r"^(?:le|la|l'|les|un|une|des)\s*(.+)$", t, re.I)
            t = m.group(1).strip() if m else ''
            if t and t.lower() != g.lower() and not t.isupper() and len(t) <= 3 * len(g) + 12 and t[0].isalpha(): tr[g] = t
        print(i + len(chunk), '/', len(todo), flush=True)
fixed = dropped = 0
for k, bad in suspect.items():
    ok = True; out = []
    for s in split(auto[k][2:]):
        ns = []
        for g in s:
            if g in bad:
                if g in tr: ns.append(tr[g])
                else: ok = False
            else: ns.append(g)
        ns = list(dict.fromkeys(ns))
        if ns: out.append(';'.join(ns))
    if ok and out: auto[k] = '≈ ' + '|'.join(out); fixed += 1
    else: del auto[k]; dropped += 1
open('data/jmfr_auto.json', 'w', encoding='utf-8').write(json.dumps(auto, ensure_ascii=False, separators=(',', ':')))
print('corrigées :', fixed, '· retirées (anglais affiché) :', dropped, '· restantes :', len(auto))
