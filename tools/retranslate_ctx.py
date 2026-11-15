#!/usr/bin/env python3
"""Passe « contexte » : retraduit avec un modèle plus gros les sens qui ont plusieurs définitions,
en les traduisant ENSEMBLE (« quern, hand mill ») pour lever les ambiguïtés. Ne remplace que si le résultat est propre.
Usage : python3 tools/retranslate_ctx.py MODELE_CT2|stub [limite]"""
import gzip, json, re, sys
model = sys.argv[1]; limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
auto = json.load(open('data/jmfr_auto.json', encoding='utf-8'))
rows = {}
for n in ('rest', 'common'):
    for r in json.loads(gzip.open('data/jmdict_%s.gz' % n).read().decode('utf-8')): rows[str(r[0])] = r
jobs = []   # (id, index du sens, texte anglais, nb de définitions)
for k in auto:
    for i, s in enumerate(rows[k][4].split('|')):
        gs = [g.strip() for g in s.split(';') if g.strip()]
        if len(gs) >= 2 and not any(re.search(r'[(),"]', g) for g in gs) and all(re.fullmatch(r"[A-Za-z' .-]+", g) for g in gs):
            jobs.append((k, i, ', '.join(gs), len(gs)))
if limit: jobs = jobs[:limit]
print('sens à retraduire :', len(jobs), flush=True)
texts = sorted({j[2] for j in jobs}); tr = {}
if model == 'stub': tr = {t: ', '.join(x + '*' for x in t.split(', ')) for t in texts}
else:
    import ctranslate2, transformers
    tok = transformers.AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-tc-big-en-fr')
    tt = ctranslate2.Translator(model, device='cpu', inter_threads=2, intra_threads=2)
    for i in range(0, len(texts), 1000):
        chunk = texts[i:i + 1000]
        out = tt.translate_batch([tok.convert_ids_to_tokens(tok.encode(t)) for t in chunk], beam_size=4, max_batch_size=48, max_decoding_length=80)
        for t, o in zip(chunk, out): tr[t] = tok.decode(tok.convert_tokens_to_ids(o.hypotheses[0]), skip_special_tokens=True).strip().rstrip('.')
        print(i + len(chunk), '/', len(texts), flush=True)
chg = 0
for k, i, t, n in jobs:
    new = [x.strip() for x in tr[t].split(',')]
    if len(new) != n or any(not x or x.isupper() or len(x) > 60 for x in new): continue
    new = [x[0].lower() + x[1:] if x[0].isupper() and not x[1:2].isupper() else x for x in new]
    new = list(dict.fromkeys(new))
    senses = auto[k][2:].split('|')
    if i >= len(senses): continue
    senses[i] = ';'.join(new)
    auto[k] = '≈ ' + '|'.join(senses); chg += 1
open('data/jmfr_auto.json', 'w', encoding='utf-8').write(json.dumps(auto, ensure_ascii=False, separators=(',', ':')))
print('sens remplacés :', chg)
