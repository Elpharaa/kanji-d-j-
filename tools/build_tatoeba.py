#!/usr/bin/env python3
"""Ajoute des phrases d'exemple Tatoeba (jpn-fra) pour les mots du dictionnaire.
Lit les exports Tatoeba (téléchargés par le workflow), segmente le japonais avec fugashi,
et écrit data/tatoeba_extra.gz au même format que tatoeba_more.gz : {"p": [[jp, fr]], "i": {mot: [indices]}}."""
import bz2, gzip, json, re, sys, collections
import fugashi

MAXPER = 4
def read_tsv(p):
    with bz2.open(p, 'rt', encoding='utf-8') as f:
        for l in f:
            a = l.rstrip('\n').split('\t')
            if len(a) >= 3: yield a

jp = {a[0]: a[2] for a in read_tsv('/tmp/tt/jpn_sentences.tsv.bz2')}
fr = {a[0]: a[2] for a in read_tsv('/tmp/tt/fra_sentences.tsv.bz2')}
pairs = {}
with bz2.open('/tmp/tt/jpn-fra_links.tsv.bz2', 'rt', encoding='utf-8') as f:
    for l in f:
        a = l.rstrip('\n').split('\t')
        if len(a) < 2: continue
        x, y = a[0], a[1]
        if x in jp and y in fr and x not in pairs: pairs[x] = y
print('paires', len(pairs))

# mots du dictionnaire
words = set()
for fn in ('data/jmdict_common.gz', 'data/lz_jm.gz'):
    for r in json.loads(gzip.open(fn).read()):
        for w in r[1].split('・'):
            w = w.strip()
            if w: words.add(w)
        if not r[1] and r[2]: words.add(r[2])
print('mots', len(words))

# déjà présents
have = collections.defaultdict(set)
for fn in ('data/lz_tx.gz', 'data/tatoeba_more.gz'):
    t = json.loads(gzip.open(fn).read())
    for k, ids in t['i'].items():
        for n in ids:
            have[k].add(t['p'][n][0])

tagger = fugashi.Tagger()
cand = collections.defaultdict(list)
for sid, fid in pairs.items():
    s = jp[sid].strip(); f = fr[fid].strip()
    n = len(s)
    if n < 6 or n > 40 or len(f) > 160: continue
    if re.search(r'[A-Za-z]{4,}', s): continue
    keys = set()
    for t in tagger(s):
        sf = t.surface
        try: lm = (t.feature.lemma or '').split('-')[0]
        except Exception: lm = ''
        for k in (sf, lm):
            if k and k in words and len(k) >= 2: keys.add(k)
    for k in keys:
        cand[k].append((n, s, f))

P = []; I = {}
for k, L in cand.items():
    L.sort(key=lambda x: (abs(x[0] - 16), x[1]))
    out = []
    for n, s, f in L:
        if s in have[k] or any(s == o for o in out): continue
        out.append(s)
        if len(out) >= MAXPER: break
    if not out: continue
    idx = []
    for s in out:
        f = next(x[2] for x in L if x[1] == s)
        idx.append(len(P)); P.append([s, f])
    I[k] = idx
print('phrases', len(P), 'mots', len(I))
# dédoublonnage des phrases
seen = {}; P2 = []; remap = {}
for i, p in enumerate(P):
    if p[0] not in seen: seen[p[0]] = len(P2); P2.append(p)
    remap[i] = seen[p[0]]
I = {k: [remap[i] for i in v] for k, v in I.items()}
with gzip.open('data/tatoeba_extra.gz', 'wt', encoding='utf-8', compresslevel=9) as f:
    json.dump({'p': P2, 'i': I}, f, ensure_ascii=False, separators=(',', ':'))
print('écrit', len(P2))
