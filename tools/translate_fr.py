#!/usr/bin/env python3
"""Traduit en français les définitions anglaises du dictionnaire qui n'ont pas encore de traduction.
Ne touche jamais aux entrées déjà présentes dans data/jmfr.json.
Usage : python3 tools/translate_fr.py MODELE_CT2 [limite]   (MODELE_CT2 = 'stub' pour un test sans modèle)"""
import gzip, json, sys, re, time
model = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0
fr = json.load(open('data/jmfr.json', encoding='utf-8'))
rows = []
for n in ('rest', 'common'):
    rows += json.loads(gzip.open('data/jmdict_%s.gz' % n).read().decode('utf-8'))
need = [r for r in rows if str(r[0]) not in fr and r[4]]
if limit: need = need[:limit]
glosses = sorted({g.strip() for r in need for s in r[4].split('|') for g in s.split(';') if g.strip()})
print('entrées à traduire :', len(need), '· définitions uniques :', len(glosses), flush=True)
if model == 'stub':
    tr = {g: '«' + g + '»' for g in glosses}
else:
    import ctranslate2, transformers
    tok = transformers.AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-fr')
    tt = ctranslate2.Translator(model, device='cpu', inter_threads=2, intra_threads=2)
    tr = {}; t0 = time.time(); B = 2000
    glosses.sort(key=len)
    for i in range(0, len(glosses), B):
        chunk = glosses[i:i + B]
        src = [tok.convert_ids_to_tokens(tok.encode(g)) for g in chunk]
        out = tt.translate_batch(src, beam_size=2, max_batch_size=64, max_decoding_length=60)
        for g, o in zip(chunk, out):
            tr[g] = tok.decode(tok.convert_tokens_to_ids(o.hypotheses[0]), skip_special_tokens=True).strip()
        print(i + len(chunk), '/', len(glosses), round(time.time() - t0), 's', flush=True)
added = 0
for r in need:
    senses = []
    for s in r[4].split('|'):
        gs = [tr.get(g.strip(), '') for g in s.split(';') if g.strip()]
        gs = [re.sub(r'\s+', ' ', g) for g in gs if g and g.lower() != 'none']
        if gs: senses.append(';'.join(gs))
    if senses:
        fr[str(r[0])] = '|'.join(senses); added += 1
open('data/jmfr.json', 'w', encoding='utf-8').write(json.dumps(fr, ensure_ascii=False, separators=(',', ':')))
print('ajoutées :', added, '· total :', len(fr))
