#!/usr/bin/env python3
"""Vérification avant mise en ligne : python3 tools/smoke.py
Contrôle la syntaxe, la version, les blocs DISCORD-BOT, les données JSON, puis ouvre chaque écran dans un vrai navigateur
(mobile) et signale toute erreur JavaScript ou tout débordement horizontal. Code de sortie 0 = tout est bon."""
import json, os, re, subprocess, sys, tempfile, threading, http.server, socketserver, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad = []

def check(ok, msg):
    print(('  ok   ' if ok else '  ÉCHEC ') + msg)
    if not ok: bad.append(msg)

html = open(os.path.join(ROOT, 'index.html'), encoding='utf8').read()
print('1. Fichiers')
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html)
main = max(scripts, key=len)
tmp = os.path.join(tempfile.gettempdir(), 'kd_smoke_main.js'); open(tmp, 'w', encoding='utf8').write(main)
r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
check(r.returncode == 0, 'syntaxe JavaScript de index.html' + ('' if r.returncode == 0 else ' : ' + r.stderr[:200]))
r = subprocess.run(['node', '--check', os.path.join(ROOT, 'sw.js')], capture_output=True, text=True)
check(r.returncode == 0, 'syntaxe de sw.js')
v = re.search(r"APP_V = '(v\d+)'", html); vj = json.load(open(os.path.join(ROOT, 'version.json')))['v']
check(bool(v) and v.group(1) == vj, 'version : index.html %s / version.json %s' % (v and v.group(1), vj))
n = html.count('DISCORD-BOT'); check(n >= 7, 'blocs DISCORD-BOT présents (%d)' % n)
for k in ['dcBox', 'dcStart', 'dcStop', 'dcClaim', 'dcRender', 'dcPubCards', 'dcPubJlpt', 'discordLink']:
    check(k in html, 'Discord : %s présent' % k)
for f in ['data/faits.json', 'histoire/data/epoques.json', 'histoire/data/fiches.json', 'version.json']:
    try: json.load(open(os.path.join(ROOT, f), encoding='utf8')); check(True, f + ' valide')
    except Exception as e: check(False, f + ' : ' + str(e)[:80])

print('2. Écrans (navigateur mobile)')
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('  playwright absent : étape ignorée'); sys.exit(1 if bad else 0)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
U = 'http://127.0.0.1:%d/' % port
errs = []
def clean(m): return not re.search(r'ERR_TUNNEL|ERR_CONNECTION|Failed to load resource|net::|fonts\.g|jsdelivr', m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 360, 'height': 780})
    pg.on('pageerror', lambda e: errs.append('JS ' + str(e)[:160]))
    pg.on('console', lambda m: errs.append('console ' + m.text[:160]) if m.type == 'error' and clean(m.text) else None)
    pg.goto(U + 'index.html'); pg.wait_for_timeout(1500)
    pg.click('#tabSignup'); pg.fill('#authUser', 'smoketest'); pg.fill('#authPass', 'smoke1234'); pg.click('#authSubmit'); pg.wait_for_timeout(2500)
    for sel in ['#lvPick [data-lvp=skip]', '#coach [data-coach=skip]']:
        try: pg.click(sel, timeout=2500); pg.wait_for_timeout(900)
        except Exception: pass
    check(pg.evaluate("!document.querySelector('#coach:not([hidden])') && !document.querySelector('#lvPick:not([hidden])')"), 'accueil : plus de fenêtre bloquante après la visite')
    def go(tab):
        pg.evaluate("t=>{var b=document.createElement('button');b.setAttribute('data-go',t);document.body.appendChild(b);b.click();b.remove()}", tab); pg.wait_for_timeout(900)
    def visible_len():
        return pg.evaluate("[...document.querySelectorAll('section[id^=v]')].filter(s=>!s.hidden).map(s=>s.innerText.length).reduce((a,b)=>a+b,0)")
    for tab in ['hub', 'home', 'story', 'kanji', 'geo', 'tz', 'online', 'multi', 'profil', 'board', 'friends', 'clz', 'settings']:
        before = len(errs); go(tab)
        check(visible_len() > 40 and len(errs) == before, 'écran « %s »' % tab + ('' if len(errs) == before else ' : ' + errs[-1]))
    # écriture : un seul point d'entrée
    before = len(errs); go('tz')
    pg.fill('#tzSearch', '日'); pg.click('[data-tz=search]'); pg.wait_for_timeout(700)
    check(pg.evaluate("!!document.querySelector('#tzView .swsvg')"), 'Écriture : ordre des traits affiché')
    pg.click('[data-tz="trace1:guide"]'); pg.wait_for_timeout(500)
    check(pg.evaluate("!!document.querySelector('#tzSvg')") and len(errs) == before, 'Écriture : tracé guidé')
    check(pg.evaluate("![...document.querySelectorAll('#games [data-game=write]')].length"), 'Dojo : plus de carte « Écriture libre » à part')
    # géographie
    before = len(errs); go('geo')
    for a in ['ppick', 'pstart']:
        pg.evaluate("a=>{var e=document.querySelector('[data-geo=\"'+a+'\"]');e&&e.click()}", a); pg.wait_for_timeout(400)
    check(len(errs) == before and pg.evaluate("!!document.querySelector('#geoSvg')"), 'Géographie : jeu des préfectures')
    # réglages
    go('settings'); pg.wait_for_timeout(1800)
    check(pg.evaluate("!!document.querySelector('#pushBox') && !!document.querySelector('#pubBox')"), 'Réglages : rappel et profil public')
    check(pg.evaluate("document.querySelectorAll('#vSettings details.kdsec').length>=3 && !!document.querySelector('#sec_pushBox #pushBox')"), 'Réglages : sections repliables')
    pg.screenshot(path='/tmp/claude-0/-home-claude/f92d3fa2-d672-5558-ae38-12264e7e06c8/scratchpad/set.png')
    # accueil
    go('hub'); pg.wait_for_timeout(2500)
    check(pg.evaluate("!!document.querySelector('#kdFact p')"), 'Accueil : « Saviez-vous ? »')
    check(pg.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), 'Accueil : pas de débordement horizontal')
    # histoire
    for h in ['', '#l/', '#l/g2', '#e/jomon', '#e/heian', '#f/riziculture', '#f/himiko', '#c', '#p', '#r']:
        before = len(errs); pg.goto(U + 'histoire/index.html' + h); pg.wait_for_timeout(1300)
        w = pg.evaluate("document.documentElement.scrollWidth"); l = pg.evaluate("document.querySelector('#m').innerText.length")
        check(l > 30 and w <= 361 and len(errs) == before, 'Histoire %s%s' % (h or '(accueil)', '' if w <= 361 else ' : déborde (%d px)' % w))
    b.close()
httpd.shutdown()
for e in sorted(set(errs)): print('  erreur :', e)
print('\nRÉSULTAT :', 'TOUT EST BON ✔' if not bad and not errs else '%d problème(s) à corriger' % (len(bad) + len(set(errs))))
sys.exit(1 if bad or errs else 0)
