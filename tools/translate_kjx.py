#!/usr/bin/env python3
"""Traduit en français les sens anglais (préfixe '*') des kanji rares de data/kjx.gz. Résultat préfixé « ≈ ».
Usage : python3 tools/translate_kjx.py MODELE_CT2|stub"""
import gzip, json, re, sys
model = sys.argv[1]
d = json.loads(gzip.open('data/kjx.gz').read().decode('utf-8'))
todo = sorted({v[6][1:] for v in d.values() if v[6].startswith('*')})
print('sens à traduire :', len(todo), flush=True)
tr = {}
if model == 'stub': tr = {t: t + '*' for t in todo}
else:
    import ctranslate2, transformers
    tok = transformers.AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-tc-big-en-fr')
    tt = ctranslate2.Translator(model, device='cpu', inter_threads=2, intra_threads=2)
    for i in range(0, len(todo), 1000):
        chunk = todo[i:i + 1000]
        out = tt.translate_batch([tok.convert_ids_to_tokens(tok.encode(t)) for t in chunk], beam_size=4, max_batch_size=48, max_decoding_length=60)
        for t, o in zip(chunk, out):
            x = tok.decode(tok.convert_tokens_to_ids(o.hypotheses[0]), skip_special_tokens=True).strip().rstrip('.')
            if x and not x.isupper() and len(x) <= 3 * len(t) + 15:
                if x[0].isupper() and not x[1:2].isupper(): x = x[0].lower() + x[1:]
                tr[t] = x
        print(i + len(chunk), '/', len(todo), flush=True)
ok = 0
for v in d.values():
    if v[6].startswith('*') and v[6][1:] in tr: v[6] = '≈ ' + tr[v[6][1:]]; ok += 1
with gzip.GzipFile('data/kjx.gz', 'wb', 9, mtime=0) as g: g.write(json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode())
print('traduits :', ok, '/', len(todo))
