// =====================================================================
//  Logique du Kanji Dōjō : niveaux, listes de quiz, questions, dictionnaire,
//  accent, conjugaison. Traduction fidèle du bot Python (dojo.py, dico.py).
// =====================================================================
import { donnees } from "./donnees.ts";

// ---------- Niveaux et grades (mêmes formules que le site) ----------
const XP_BASE = 160, XP_STEP = 60;
export const xpTotal = (lv: number) => (lv - 1) * XP_BASE + Math.floor(XP_STEP * (lv - 1) * (lv - 2) / 2);
export function niveau(xp: number) { let lv = 1; while (xp >= xpTotal(lv + 1)) lv++; return lv; }
export function progression(xp: number): [number, number] { const lv = niveau(xp); return [xp - xpTotal(lv), XP_BASE + XP_STEP * (lv - 1)]; }
export function grade(lv: number): [string, string] {
  if (lv >= 16) return ["師範", "Maître"];
  if (lv >= 12) return ["師範代", "Sous-maître"];
  if (lv >= 8) return ["達人", "Expert"];
  if (lv >= 5) return ["弟子", "Disciple"];
  if (lv >= 3) return ["門下生", "Élève"];
  return ["見習い", "Apprenti"];
}

// ---------- Hasard reproductible (le quiz se recalcule à chaque clic) ----------
export function hasard(graine: string) {
  let h = 1779033703 ^ graine.length;
  for (let i = 0; i < graine.length; i++) { h = Math.imul(h ^ graine.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function melanger<T>(t: T[], r: () => number): T[] {
  const a = t.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Cours, JLPT, keigo ----------
export const NIVEAUX: Record<string, string> = { L0: "L0 · Semestre 1", L0S2: "L0 · Semestre 2", L1: "L1 · Semestre 1", L1S2: "L1 · Semestre 2", L2: "L2 · Semestre 3" };
export const NIVEAUX_JLPT = ["n5", "n4", "n3", "n2", "n1"];
export const LISTES: Record<string, string> = { ...NIVEAUX };
for (const lv of NIVEAUX_JLPT) LISTES[lv] = "JLPT " + lv.toUpperCase();
LISTES.q = "Hors JLPT"; LISTES.kg = "Keigo";
export const SENS: Record<string, string> = { jpfr: "Japonais → Français", frjp: "Français → Japonais", lecture: "Lecture (kanji → kana)", melange: "Mélange" };

export const niveauDeSemaine = (wk: number) => wk >= 400 ? "L0S2" : wk >= 300 ? "L0" : wk >= 200 ? "L1S2" : wk >= 100 ? "L1" : "L2";
export const numSemaine = (wk: number) => wk % 100;
export async function nomSemaine(wk: number) {
  const c = await donnees.cours();
  const t = NIVEAUX[niveauDeSemaine(wk)] + ` · Semaine ${numSemaine(wk)}`;
  const titre = c.titres?.[String(wk)];
  return titre ? `${t} — ${titre}` : t;
}
async function semaines(nv: string) {
  const c = await donnees.cours();
  return [...new Set<number>(c.kanji.filter((k: any) => niveauDeSemaine(k.wk) === nv).map((k: any) => k.wk))].sort((a, b) => a - b);
}

let _hors: { autres: Record<string, any[]>; reste: Record<string, any[]> } | null = null;
async function horsJlpt() {
  if (_hors) return _hors;
  const c = await donnees.cours();
  const autres: Record<string, any[]> = {}, reste: Record<string, any[]> = {};
  for (const lv of NIVEAUX_JLPT) autres[lv] = [];
  for (const t of c.jlpt) {
    if (t.lv !== "q") continue;
    for (const m of t.mots) {
      const lv = c.jlv[m[0]];
      if (lv && autres[lv]) autres[lv].push(m); else (reste[t.id] ??= []).push(m);
    }
  }
  return (_hors = { autres, reste });
}

export async function parties(liste: string): Promise<[string, string][]> {
  const c = await donnees.cours();
  if (NIVEAUX[liste]) return (await semaines(liste)).map((w) => [String(w), `Semaine ${numSemaine(w)}` + (c.titres?.[String(w)] ? ` — ${c.titres[String(w)]}` : "")]);
  if (liste === "kg") return c.keigo.map((t: any) => [t.id, t.nom + (t.sub ? ` (${t.sub})` : "")]);
  const h = await horsJlpt();
  if (liste === "q") return c.jlpt.filter((t: any) => t.lv === "q" && (h.reste[t.id]?.length ?? 0) >= 6).map((t: any) => [t.id, t.nom]);
  const out: [string, string][] = c.jlpt.filter((t: any) => t.lv === liste).map((t: any) => [t.id, t.nom]);
  if (h.autres[liste]?.length) out.push([liste + "_autres", `Autres mots du ${liste.toUpperCase()}`]);
  return out;
}
export async function nomPartie(liste: string, partie?: string | null) {
  if (!partie) return (LISTES[liste] ?? liste) + " · tout";
  const p = Object.fromEntries(await parties(liste));
  return (LISTES[liste] ?? liste) + " · " + (p[partie] ?? partie);
}

export type Mot = { jp: string; lect: string; fr: string; grp: string };
export async function items(liste: string, partie?: string | null): Promise<Mot[]> {
  const c = await donnees.cours();
  const out: Mot[] = [], vus = new Set<string>();
  const ajoute = (jp: string, lect: string, fr: string, grp: string) => { if (jp && !vus.has(jp)) { vus.add(jp); out.push({ jp, lect: lect || jp, fr, grp }); } };
  if (NIVEAUX[liste]) {
    for (const k of c.kanji) if (niveauDeSemaine(k.wk) === liste && (!partie || String(k.wk) === partie)) for (const m of k.mots) ajoute(m[0], m[1], m[2], String(k.wk));
  } else if (liste === "kg") {
    for (const t of c.keigo) if (!partie || t.id === partie) for (const [jp, rd, fr] of t.mots) ajoute(jp, rd, fr, t.id);
  } else if (liste === "q") {
    const h = await horsJlpt();
    for (const [tid, mots] of Object.entries(h.reste)) if (!partie || tid === partie) for (const [jp, kana, fr] of mots) ajoute(jp, kana, fr, tid);
  } else {
    for (const t of c.jlpt) if (t.lv === liste && (!partie || t.id === partie)) for (const [jp, kana, fr] of t.mots) ajoute(jp, kana, fr, t.id);
    if (!partie || partie === liste + "_autres") { const h = await horsJlpt(); for (const [jp, kana, fr] of h.autres[liste] ?? []) ajoute(jp, kana, fr, liste + "_autres"); }
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const aKanji = (s: string) => /[一-鿿々]/.test(s || "");

export type Question = { consigne: string; grand: string; choix: string[]; bonne: number; mot: Mot; genre: string };
function question(pool: Mot[], sens: string, deja: Set<string>, r: () => number): Question | null {
  const candidats = melanger(pool.filter((m) => !deja.has(m.jp)), r);
  for (const m of candidats) {
    let genre = sens === "melange" ? ["jpfr", "frjp", "lecture"][Math.floor(r() * 3)] : sens;
    if (genre === "lecture" && (!aKanji(m.jp) || m.lect === m.jp)) { if (sens === "lecture") continue; genre = "jpfr"; }
    const champ = ({ jpfr: "fr", frjp: "jp", lecture: "lect" } as Record<string, keyof Mot>)[genre];
    const bonne = m[champ];
    const proches = melanger(pool.filter((x) => x.grp === m.grp), r);
    const autresPool = proches.concat(melanger(pool, r));
    const autres: string[] = [], vus = new Set([norm(bonne)]);
    for (const x of autresPool) {
      if (genre === "lecture" && !aKanji(x.jp)) continue;
      const v = x[champ];
      if (vus.has(norm(v))) continue;
      vus.add(norm(v)); autres.push(v);
      if (autres.length === 3) break;
    }
    if (autres.length < 3) continue;
    const choix = melanger([...autres, bonne], r);
    const [consigne, grand] = genre === "jpfr" ? ["🇯🇵 → 🇫🇷 Que signifie :", m.jp] : genre === "frjp" ? ["🇫🇷 → 🇯🇵 Comment dit-on en japonais :", m.fr] : ["📖 Comment se lit :", m.jp];
    return { consigne, grand, choix, bonne: choix.indexOf(bonne), mot: m, genre };
  }
  return null;
}

/** Toutes les questions d'un quiz, recalculées à l'identique à partir de la graine. */
export async function questionsQuiz(liste: string, partie: string | null, sens: string, graine: string, total: number) {
  const pool = await items(liste, partie);
  const r = hasard(graine);
  const qs: Question[] = [], deja = new Set<string>();
  for (let i = 0; i < total; i++) { const q = question(pool, sens, deja, r); if (!q) break; deja.add(q.mot.jp); qs.push(q); }
  return qs;
}

export async function kanjiDuJour(dateIso: string, niveaux: string[]) {
  const c = await donnees.cours();
  let pool = c.kanji.filter((k: any) => !niveaux.length || niveaux.includes(niveauDeSemaine(k.wk)));
  if (!pool.length) pool = c.kanji;
  return pool[Math.floor(hasard("kanji-du-jour-" + dateIso)() * pool.length)];
}

// =====================================================================
//  Dictionnaire
// =====================================================================
export const hira = (s: string) => [...(s || "")].map((c) => c >= "ァ" && c <= "ヶ" ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c).join("");
export const aJaponais = (s: string) => /[぀-ヿ一-鿿]/.test(s || "");
export const sansAccents = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const ROMA: Record<string, string> = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", sha: "しゃ", shu: "しゅ", sho: "しょ", sya: "しゃ", syu: "しゅ", syo: "しょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ", nya: "にゃ", nyu: "にゅ", nyo: "にょ",
  hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ", mya: "みゃ", myu: "みゅ", myo: "みょ", rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ", ja: "じゃ", ju: "じゅ", jo: "じょ", jya: "じゃ", jyu: "じゅ", jyo: "じょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ", pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ", shi: "し", chi: "ち", tsu: "つ",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ", sa: "さ", si: "し", su: "す", se: "せ", so: "そ",
  ta: "た", ti: "ち", tu: "つ", te: "て", to: "と", na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", fu: "ふ", hu: "ふ", he: "へ", ho: "ほ", ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ", ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ", wa: "わ", wo: "を",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご", za: "ざ", ji: "じ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど", ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ", a: "あ", i: "い", u: "う", e: "え", o: "お",
};
export function romajiEnKana(q: string): string | null {
  let s = sansAccents(q).replace(/-/g, "ー").replace(/'/g, "").replace(/[^a-zー]/g, "");
  let out = "", i = 0;
  while (i < s.length) {
    if (s[i] === "ー") { out += "ー"; i++; continue; }
    if (i + 1 < s.length && s[i] === s[i + 1] && !"aeioun".includes(s[i])) { out += "っ"; i++; continue; }
    if (s[i] === "n" && (i + 1 === s.length || !"aeiouy".includes(s[i + 1]))) {
      out += "ん"; i += 1 + (i + 1 < s.length && s[i + 1] === "n" && (i + 2 === s.length || !"aeiouy".includes(s[i + 2])) ? 1 : 0); continue;
    }
    let ok = false;
    for (const n of [3, 2, 1]) { const k = s.slice(i, i + n); if (ROMA[k]) { out += ROMA[k]; i += n; ok = true; break; } }
    if (!ok) return null;
  }
  return out || null;
}

// entrée : [jp, kana, fr, niveau, pos, [sens], variantes, [sources]]
export type Entree = [string, string, string, string, string, string[], string, string[]];
const prio = (e: Entree): [number, number] => {
  const s = (e[7] || []).join(" ");
  return [s.includes("JLPT") || s.includes("Cours") ? 0 : s.includes("Hors") || s.includes("Bonus") || s.includes("Lecture") ? 1 : 2, e[0].length];
};
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export async function chercher(q: string, maxi = 25): Promise<Entree[]> {
  q = (q || "").trim();
  if (!q) return [];
  const d = await donnees.dico();
  const MOTS: Entree[] = d.mots;
  const res: Entree[] = [], vus = new Set<string>();
  const ajoute = (liste: Entree[], tri = true) => { for (const e of tri ? liste.slice().sort((a, b) => cmp(prio(a), prio(b))) : liste) if (!vus.has(e[0])) { vus.add(e[0]); res.push(e); } };
  if (aJaponais(q)) {
    const hq = hira(q);
    ajoute(MOTS.filter((e) => e[0] === q || hira(e[1]) === hq || (e[6] || "").split(" ").includes(q)));
    if (res.length < maxi) ajoute(MOTS.filter((e) => e[0].startsWith(q) || (hq && hira(e[1]).startsWith(hq) && !aKanji(q))).slice(0, 400));
    if (res.length < maxi && aKanji(q)) ajoute(MOTS.filter((e) => e[0].includes(q)).slice(0, 400));
    return res.slice(0, maxi);
  }
  const kana = romajiEnKana(q);
  if (kana && kana.length >= 2) ajoute(MOTS.filter((e) => hira(e[1] || e[0]) === kana));
  const nq = sansAccents(q);
  const motif = new RegExp("(?<![a-z])" + nq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z])");
  const rangFr = (e: Entree) => {
    const premier = sansAccents(e[2]).split(/[,;(]/)[0].trim();
    return [premier === nq ? 0 : premier.startsWith(nq) ? 1 : 2, ...prio(e)];
  };
  ajoute(MOTS.filter((e) => motif.test(sansAccents(e[2]))).sort((a, b) => cmp(rangFr(a), rangFr(b))).slice(0, 600), false);
  if (res.length < maxi) ajoute(MOTS.filter((e) => (e[5] || []).some((x) => motif.test(sansAccents(x)))).slice(0, 600));
  if (res.length < 3 && kana) ajoute(MOTS.filter((e) => hira(e[1] || e[0]).startsWith(kana)).slice(0, 200));
  return res.slice(0, maxi);
}
export async function entree(jp: string): Promise<Entree | undefined> {
  const d = await donnees.dico();
  return d.mots.find((e: Entree) => e[0] === jp);
}
export async function niveauMot(e: Entree) {
  const c = await donnees.cours();
  const lv = c.jlv[e[0]];
  if (lv) return "JLPT " + lv.toUpperCase();
  for (const s of e[7] || []) if (s.startsWith("JLPT")) return s;
  return e[3] && e[3] !== "Bonus" ? e[3] : "";
}

// ---------- Accent de hauteur (Kanjium) ----------
function mores(kana: string) {
  const out: string[] = [];
  for (const c of kana) { if ("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ".includes(c) && out.length) out[out.length - 1] += c; else out.push(c); }
  return out;
}
export async function accent(jp: string, kana: string): Promise<[string, number] | null> {
  const d = await donnees.dico();
  const a = d.accent[jp] || d.accent[kana];
  if (!a) return null;
  const n = parseInt(String(a[1]).split(",")[0], 10);
  if (Number.isNaN(n)) return null;
  const m = mores(hira(a[0]));
  const haut = m.map((_, i) => n === 0 ? i > 0 : n === 1 ? i === 0 : i > 0 && i < n);
  let txt = "";
  m.forEach((mo, i) => { if (i > 0 && haut[i] && !haut[i - 1]) txt += "↗"; txt += mo; if (n && i === n - 1) txt += "↘"; });
  return [txt, n];
}

// ---------- Conjugaison ----------
const G: Record<string, string> = { "う": "わいうえお", "く": "かきくけこ", "ぐ": "がぎぐげご", "す": "さしすせそ", "つ": "たちつてと", "ぬ": "なにぬねの", "ぶ": "ばびぶべぼ", "む": "まみむめも", "る": "らりるれろ" };
const TE: Record<string, string> = { "う": "って", "つ": "って", "る": "って", "く": "いて", "ぐ": "いで", "す": "して", "ぬ": "んで", "ぶ": "んで", "む": "んで" };
const NOMS_V = ["Dictionnaire", "Poli (ます)", "Négatif (ない)", "Négatif poli", "Passé (た)", "Passé poli", "Passé négatif", "Forme en て", "Potentiel", "Volitif (on va…)", "Passif", "Causatif", "Impératif", "Conditionnel (ば)", "Conditionnel (たら)", "Désir (たい)"];
const NOMS_A = ["Présent", "Poli", "Négatif", "Passé", "Passé négatif", "Forme en て", "Adverbe", "Conditionnel (ば)", "Conditionnel (たら)"];

async function classe(jp: string, kana: string, pos: string) {
  const d = await donnees.dico();
  pos = pos || d.pos[jp] || d.pos[kana] || "";
  const t = pos.split(/\s+/);
  if (t.includes("vk") || jp === "来る" || jp === "くる") return "vk";
  if (t.includes("v5k-s") || jp === "行く" || jp === "いく") return "v5k-s";
  if (t.includes("v5aru")) return "v5aru";
  if (t.includes("v5r-i") || jp === "ある" || jp === "有る") return "v5r-i";
  if (t.some((x) => x.startsWith("v5"))) return "v5";
  if (t.includes("v1") || t.includes("v1-s")) return "v1";
  if (t.includes("vs-i") || t.includes("vs-s") || (jp.endsWith("する") && jp.length > 2)) return "vs";
  if (t.includes("vs")) return "nvs";
  if (t.includes("adj-ix") || ((jp === "いい" || jp === "良い") && t.includes("adj-i"))) return "adj-ix";
  if (t.includes("adj-i")) return "adj-i";
  return null;
}
export async function conjuguer(jp: string, kana: string, pos = ""): Promise<[string, string][]> {
  let c = await classe(jp, kana, pos);
  if (!c) return [];
  const zip = (noms: string[], f: string[]) => noms.map((n, i) => [n, f[i]] as [string, string]);
  if (c === "nvs") { jp = jp + "する"; c = "vs"; }
  if (c === "vs") { const b = jp.slice(0, -2); return zip(NOMS_V, ["する", "します", "しない", "しません", "した", "しました", "しなかった", "して", "できる", "しよう", "される", "させる", "しろ", "すれば", "したら", "したい"].map((x) => b + x)); }
  if (c === "vk") {
    if (jp.includes("来")) { const b = jp.slice(0, -2) + "来"; return zip(NOMS_V, ["る", "ます", "ない", "ません", "た", "ました", "なかった", "て", "られる", "よう", "られる", "させる", "い", "れば", "たら", "たい"].map((x) => b + x)); }
    const b = jp.slice(0, -2);
    return zip(NOMS_V, ["くる", "きます", "こない", "きません", "きた", "きました", "こなかった", "きて", "こられる", "こよう", "こられる", "こさせる", "こい", "くれば", "きたら", "きたい"].map((x) => b + x));
  }
  if (c === "v1") { const b = jp.slice(0, -1); return zip(NOMS_V, ["る", "ます", "ない", "ません", "た", "ました", "なかった", "て", "られる", "よう", "られる", "させる", "ろ", "れば", "たら", "たい"].map((x) => b + x)); }
  if (c.startsWith("v5")) {
    const fin = jp.slice(-1), b = jp.slice(0, -1);
    if (!G[fin]) return [];
    const [a, i, , e, o] = [...G[fin]];
    const te = c === "v5k-s" ? "って" : TE[fin];
    const ta = te.slice(0, -1) + (te.endsWith("で") ? "だ" : "た");
    const nai = c === "v5r-i" ? "ない" : a + "ない";
    const naiB = c === "v5r-i" ? "" : b;
    const ii = c === "v5aru" ? "い" : i;
    return zip(NOMS_V, [jp, b + ii + "ます", naiB + nai, b + ii + "ません", b + ta, b + ii + "ました", naiB + nai.slice(0, -1) + "かった", b + te, b + e + "る", b + o + "う", b + a + "れる", b + a + "せる", b + (c === "v5aru" ? "い" : e), b + e + "ば", b + ta + "ら", b + i + "たい"]);
  }
  if (c === "adj-i" || c === "adj-ix") {
    const b = c === "adj-ix" ? jp.slice(0, -2) + (jp.includes("良") ? "良" : "よ") : jp.slice(0, -1);
    return zip(NOMS_A, [jp, jp + "です", b + "くない", b + "かった", b + "くなかった", b + "くて", b + "く", b + "ければ", b + "かったら"]);
  }
  return [];
}

export async function exemples(jp: string, n = 2): Promise<[string, string][]> {
  const d = await donnees.dico();
  return (d.ex[jp] || []).slice(0, n).filter((i: number) => i < d.phrases.length).map((i: number) => d.phrases[i]);
}
export async function motsAvec(kanji: string, n = 8): Promise<Entree[]> {
  const d = await donnees.dico();
  const MOTS: Entree[] = d.mots;
  let liste = MOTS.filter((e) => e[0].includes(kanji) && !(e[7] || []).includes("Dictionnaire (JMdict)"));
  liste.sort((a, b) => ((a[7] || []).some((s) => s.includes("Cours")) ? 0 : 1) - ((b[7] || []).some((s) => s.includes("Cours")) ? 0 : 1) || a[0].length - b[0].length);
  if (liste.length < n) liste = liste.concat(MOTS.filter((e) => e[0].includes(kanji) && !liste.includes(e)).sort((a, b) => a[0].length - b[0].length).slice(0, n - liste.length));
  return liste.slice(0, n);
}
