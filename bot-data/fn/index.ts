// =====================================================================
//  Bot Discord du Kanji Dōjō — version « application toujours en ligne ».
//  Discord envoie chaque commande à cette fonction Supabase, qui répond.
//  Plus besoin de laisser un ordinateur allumé.
//
//  Secrets (Supabase > Edge Functions > Secrets) :
//    KANJI_DISCORD_PUBLIC_KEY  clé publique de l'application (portail Discord)
//    KANJI_DISCORD_TOKEN       token du bot
//  Actions internes (appelées par le minuteur de la base, avec la clé x-cle) :
//    ?tache=cron         kanji du jour + passages de niveau
//    ?tache=enregistrer  envoie la liste des commandes à Discord
// =====================================================================
import {
  api, APP_ID, boutonSite, COULEUR, coupe, echappe, encadre, EPHEMERE, json, ligne, LIEN_SITE, modifierReponse, NOM_SITE, R, signatureValide, suite, modifierSuite, type Fichier,
} from "./discord.ts";
import * as site from "./site.ts";
import * as L from "./logique.ts";
import { donnees, urlTraits } from "./donnees.ts";
import { pngCarte } from "./carte.ts";
import { COMMANDES } from "./commandes.ts";

const XP_BONNE = 10, PIECES_BONNE = 2, BONUS_PARFAIT = 20;
const FUSEAU = "Europe/Paris";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const plusTard = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error("tâche :", e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(q);
};

// ---------- Outils ----------
type Inter = any;
const utilisateur = (i: Inter) => i.member?.user ?? i.user;
const option = (i: Inter, nom: string) => (i.data?.options || []).find((o: any) => o.name === nom)?.value;
const aujourdhui = () => new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const heureParis = () => new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const graine = () => Math.floor(Math.random() * 36 ** 5).toString(36);
const message = (corps: Record<string, unknown>, ephemere = false) => json({ type: R.MESSAGE, data: { ...corps, ...(ephemere ? { flags: EPHEMERE } : {}) } });
const erreur = (texte: string) => message({ content: texte }, true);
/** Répond « en attente », puis fait le travail et remplace la réponse. */
function attendre(i: Inter, travail: () => Promise<{ corps: Record<string, unknown>; fichiers?: Fichier[] }>, ephemere = false) {
  plusTard((async () => {
    let res;
    try { res = await travail(); } catch (e) { console.error(e); res = { corps: { content: "Oups, une erreur est survenue. Réessaie dans un instant." } }; }
    await modifierReponse(i.token, res.corps, res.fichiers || []);
  })());
  return json({ type: R.ATTENTE, data: ephemere ? { flags: EPHEMERE } : {} });
}
function attendreMaj(i: Inter, travail: () => Promise<{ corps: Record<string, unknown>; fichiers?: Fichier[] }>) {
  plusTard((async () => { const res = await travail(); await modifierReponse(i.token, res.corps, res.fichiers || []); })());
  return json({ type: R.ATTENTE_MAJ });
}
async function quizAutorise(i: Inter) {
  if (!i.guild_id) return true;
  const r = await site.reglages(i.guild_id).catch(() => null);
  return !r?.salons_quiz?.length || r.salons_quiz.includes(i.channel_id);
}

// ---------- Récompenses ----------
async function recompense(discordId: string, xp: number, pieces: number, raison: string) {
  try {
    const lien = await site.compteLie(discordId);
    if (!lien) return `Tu aurais gagné **${xp} XP** sur le site : lie ton compte avec **/lier** !`;
    if (!xp && !pieces) return "—";
    const r = await site.recompenser(discordId, xp, pieces, raison);
    if (r.xp || r.coins) return `**+${r.xp} XP** et **+${r.coins} pièces** pour **${echappe(lien.username)}** (elles arrivent à ta prochaine visite du site)` + (r.xp < xp ? "\nPlafond du jour presque atteint 😉" : "");
    return "Plafond du jour atteint (300 XP depuis Discord) : reviens demain !";
  } catch (e) { console.error(e); return "Le site n'a pas pu être joint : pas d'XP cette fois."; }
}
const resume = (masque: number, n: number) => Array.from({ length: n }, (_, k) => (masque >> k) & 1 ? "✅" : "❌").join(" ");

// =====================================================================
//  /quiz (sans mémoire : tout l'état du quiz voyage dans les boutons)
// =====================================================================
type EtatQuiz = { uid: string; liste: string; partie: string | null; sens: string; graine: string; total: number; i: number; score: number; masque: number };
const etatQuizTexte = (e: EtatQuiz) => [e.uid, e.liste, e.partie || "-", e.sens, e.graine, e.total, e.i, e.score, e.masque.toString(36)].join("|");
function lireEtatQuiz(parts: string[]): EtatQuiz {
  const [uid, liste, partie, sens, g, total, i, score, masque] = parts;
  return { uid, liste, partie: partie === "-" ? null : partie, sens, graine: g, total: +total, i: +i, score: +score, masque: parseInt(masque, 36) };
}
async function vueQuestion(e: EtatQuiz, qs: L.Question[], retour = "") {
  const q = qs[e.i];
  const grand = q.genre !== "frjp" ? `# ${q.grand}` : `## ${q.grand}`;
  const choix = q.choix.map((c, n) => q.genre === "jpfr" ? `**${"ABCD"[n]}.** ${c}` : `### ${"ABCD"[n]}. ${c}`).join("\n");
  const titre = (await L.nomPartie(e.liste, e.partie)) + " · " + L.SENS[e.sens];
  const emb: any = { title: `📝 Question ${e.i + 1}/${qs.length}`, color: COULEUR, description: `${q.consigne}\n${grand}\n${choix}`, footer: { text: `${titre} · ${e.score} bonne(s) réponse(s)` } };
  if (retour) emb.fields = [{ name: "Question précédente", value: coupe(retour, 1024) }];
  const etat = etatQuizTexte(e);
  return { embeds: [emb], components: [ligne(...[0, 1, 2, 3].map((n) => ({ type: 2, style: 2, label: "ABCD"[n], custom_id: `qa|${etat}|${n}` })))] };
}
const correction = (m: L.Mot) => `**${m.jp}**` + (m.lect !== m.jp ? ` 【${m.lect}】` : "") + ` ${m.fr}`;

/** Retrouve la partie choisie (une semaine peut être tapée à la main : « 3 »). undefined = introuvable. */
async function resoudrePartie(liste: string, brute: string | undefined): Promise<string | null | undefined> {
  const partie = (brute || "").trim() || null;
  if (!partie) return null;
  const ps = await L.parties(liste);
  if (ps.some(([v]) => v === partie)) return partie;
  const num = partie.replace(/\D/g, "");
  const t = ps.find(([v]) => num && L.NIVEAUX[liste] && String(L.numSemaine(+v)) === num);
  return t ? t[0] : undefined;
}
const PARTIE_INTROUVABLE = "Je ne trouve pas cette semaine / ce thème : choisis-le dans la liste proposée.";

async function cmdQuiz(i: Inter) {
  if (!(await quizAutorise(i))) return erreur("Les quiz sont limités à un autre salon sur ce serveur.");
  const liste = option(i, "liste");
  const partie = await resoudrePartie(liste, option(i, "partie"));
  if (partie === undefined) return erreur(PARTIE_INTROUVABLE);
  const sens = option(i, "sens") || "melange";
  const pool = await L.items(liste, partie);
  if (pool.length < 6) return erreur("Pas assez de mots dans cette partie pour un quiz.");
  const total = Math.min(option(i, "questions") || 5, pool.length);
  const e: EtatQuiz = { uid: utilisateur(i).id, liste, partie, sens, graine: graine(), total, i: 0, score: 0, masque: 0 };
  const qs = await L.questionsQuiz(liste, partie, sens, e.graine, total);
  if (!qs.length) return erreur("Impossible de créer des questions avec ces réglages (essaie un autre sens).");
  e.total = qs.length;
  return message(await vueQuestion(e, qs));
}

async function clicQuiz(i: Inter, parts: string[]) {
  const choix = +parts.pop()!;
  const e = lireEtatQuiz(parts);
  if (utilisateur(i).id !== e.uid) return erreur("Ce quiz n'est pas le tien : lance le tien avec **/quiz** !");
  const qs = await L.questionsQuiz(e.liste, e.partie, e.sens, e.graine, e.total);
  const q = qs[e.i];
  if (!q) return json({ type: R.ATTENTE_MAJ });
  const ok = choix === q.bonne;
  if (ok) { e.score++; e.masque |= 1 << e.i; }
  const retour = (ok ? "✅ Bonne réponse ! " : `❌ Raté : **${q.choix[q.bonne]}**\n`) + correction(q.mot);
  e.i++;
  if (e.i < qs.length) return json({ type: R.MAJ, data: await vueQuestion(e, qs, retour) });
  // fin du quiz : on calcule la récompense en arrière-plan
  return attendreMaj(i, async () => {
    const xp = e.score * XP_BONNE + (e.score === qs.length ? BONUS_PARFAIT : 0);
    const titre = (await L.nomPartie(e.liste, e.partie)) + " · " + L.SENS[e.sens];
    const lignes = qs.map((x, k) => ((e.masque >> k) & 1 ? "✅ " : "❌ ") + correction(x.mot));
    const emb = {
      title: `🎌 Quiz terminé : ${e.score}/${qs.length}`, color: COULEUR, description: coupe(lignes.join("\n"), 4000),
      fields: [{ name: "Dernière question", value: coupe(retour, 1024) }, { name: "Récompense", value: await recompense(e.uid, xp, e.score * PIECES_BONNE, `Quiz Discord ${e.score}/${qs.length}`) }],
      footer: { text: `${titre} · ${NOM_SITE}` },
    };
    return { corps: { embeds: [emb], components: [ligne(boutonSite("Réviser sur le site"))] } };
  });
}

// =====================================================================
//  /ecrire (on tape la réponse dans une petite fenêtre)
// =====================================================================
const SENS_ECRIRE: Record<string, string> = { fr: "Français → Japonais", jp: "Japonais → Français", lecture: "Lecture des kanji", melange: "Mélange" };
const XP_ECRIRE = 15;
type QEcrire = { mot: L.Mot; genre: string };
async function questionsEcrire(liste: string, partie: string | null, mode: string, g: string, total: number): Promise<QEcrire[]> {
  const pool = await L.items(liste, partie);
  const r = L.hasard(g), r2 = L.hasard(g + ":sens");
  const out: QEcrire[] = [];
  for (const m of L.melanger(pool, r)) {
    let genre = mode === "melange" ? ["fr", "jp", "lecture"][Math.floor(r2() * 3)] : mode;
    if (genre === "lecture" && (!L.aKanji(m.jp) || m.lect === m.jp)) { if (mode === "lecture") continue; genre = "fr"; }
    out.push({ mot: m, genre });
    if (out.length >= total) break;
  }
  return out;
}
// --- vérification des réponses ---
const nJp = (s: string) => L.hira((s || "").normalize("NFKC")).toLowerCase().replace(/[\s・「」『』〜～。、.,!！?？()（）…]/g, "");
const variantesJp = (s: string) => [s, s.replace(/[（(].*?[)）]/g, ""), ...s.split(/[、,／/;；]/)].map(nJp).filter(Boolean);
const nFr = (s: string) => L.sansAccents(s || "").replace(/[’']/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const sansArticle = (s: string) => s.replace(/^(le|la|les|l|un|une|des|du|de|d|se|s|etre|faire)\s+/, "");
function reponseJuste(saisie: string, q: QEcrire, pool: L.Mot[]) {
  const m = q.mot;
  if (q.genre === "jp") {
    const v = nFr(saisie);
    if (!v) return false;
    const fr = pool.filter((x) => x.jp === m.jp).map((x) => x.fr).concat(m.fr);
    const segs = fr.flatMap((f) => [nFr(f.replace(/\(.*?\)/g, "")), ...f.split(/[,;/()]/).map(nFr)]).filter(Boolean);
    return segs.some((s) => s === v || sansArticle(s) === sansArticle(v) || (v.length >= 4 && v.length >= s.length * 0.5 && ` ${s} `.includes(` ${v} `)));
  }
  let v = nJp(saisie);
  if (/[a-z]/.test(v)) { const k = L.romajiEnKana(v); if (!k) return false; v = nJp(k); }
  if (!v) return false;
  const acceptes = new Set<string>();
  const memes = q.genre === "fr" ? pool.filter((x) => nFr(x.fr) === nFr(m.fr)).concat(m) : [m];
  for (const x of memes) { variantesJp(x.lect).forEach((a) => acceptes.add(a)); if (q.genre === "fr") variantesJp(x.jp).forEach((a) => acceptes.add(a)); }
  return acceptes.has(v);
}
async function vueEcrire(e: EtatQuiz, qs: QEcrire[], retour = "") {
  const { mot: m, genre } = qs[e.i];
  const corps = genre === "fr"
    ? `🇫🇷 → 🇯🇵 Écris en japonais (kana, kanji ou romaji) :\n# ${m.fr}\n-# ${[...L.hira(m.lect)].length} kana`
    : genre === "jp" ? `🇯🇵 → 🇫🇷 Écris le sens en français :\n# ${m.jp}` : `📖 Écris la lecture (kana ou romaji) :\n# ${m.jp}`;
  const titre = (await L.nomPartie(e.liste, e.partie)) + " · " + SENS_ECRIRE[e.sens];
  const emb: any = { title: `✍️ Question ${e.i + 1}/${qs.length}`, color: COULEUR, description: corps, footer: { text: `${titre} · ${e.score} bonne(s) réponse(s)` } };
  if (retour) emb.fields = [{ name: "Question précédente", value: coupe(retour, 1024) }];
  const etat = etatQuizTexte(e);
  return { embeds: [emb], components: [ligne(
    { type: 2, style: 1, label: "Répondre", emoji: { name: "✍️" }, custom_id: `eb|${etat}` },
    { type: 2, style: 2, label: "Passer", custom_id: `ep|${etat}` },
  )] };
}
async function cmdEcrire(i: Inter) {
  if (!(await quizAutorise(i))) return erreur("Les quiz sont limités à un autre salon sur ce serveur.");
  const liste = option(i, "liste");
  const partie = await resoudrePartie(liste, option(i, "partie"));
  if (partie === undefined) return erreur(PARTIE_INTROUVABLE);
  const mode = option(i, "sens") || "fr";
  const e: EtatQuiz = { uid: utilisateur(i).id, liste, partie, sens: mode, graine: graine(), total: option(i, "questions") || 5, i: 0, score: 0, masque: 0 };
  const qs = await questionsEcrire(liste, partie, mode, e.graine, e.total);
  if (!qs.length) return erreur("Pas de mot à écrire avec ces réglages (essaie un autre sens).");
  e.total = qs.length;
  return message(await vueEcrire(e, qs));
}
function ouvrirFenetreEcrire(i: Inter, parts: string[]) {
  const e = lireEtatQuiz(parts);
  if (utilisateur(i).id !== e.uid) return erreur("Cet exercice n'est pas le tien : lance le tien avec **/ecrire** !");
  return json({ type: R.FENETRE, data: {
    custom_id: `ew|${parts.join("|")}`, title: `Question ${e.i + 1}`,
    components: [ligne({ type: 4, custom_id: "r", label: "Ta réponse", style: 1, required: true, max_length: 60, placeholder: "ex. たべる, taberu, 食べる ou manger" })],
  } });
}
async function repondreEcrire(i: Inter, parts: string[], saisie: string | null) {
  const e = lireEtatQuiz(parts);
  if (utilisateur(i).id !== e.uid) return erreur("Cet exercice n'est pas le tien : lance le tien avec **/ecrire** !");
  const qs = await questionsEcrire(e.liste, e.partie, e.sens, e.graine, e.total);
  const q = qs[e.i];
  if (!q) return json({ type: R.ATTENTE_MAJ });
  const pool = await L.items(e.liste, e.partie);
  const ok = saisie !== null && reponseJuste(saisie, q, pool);
  if (ok) { e.score++; e.masque |= 1 << e.i; }
  const retour = (ok ? "✅ Bravo ! " : saisie === null ? "⏭️ Passé : " : `❌ Tu as écrit « ${coupe(saisie, 60)} » : `) + correction(q.mot);
  e.i++;
  if (e.i < qs.length) return json({ type: R.MAJ, data: await vueEcrire(e, qs, retour) });
  return attendreMaj(i, async () => {
    const xp = e.score * XP_ECRIRE + (e.score === qs.length ? BONUS_PARFAIT : 0);
    const titre = (await L.nomPartie(e.liste, e.partie)) + " · " + SENS_ECRIRE[e.sens];
    const lignes = qs.map((x, k) => ((e.masque >> k) & 1 ? "✅ " : "❌ ") + correction(x.mot));
    return { corps: { embeds: [{
      title: `✍️ Exercice terminé : ${e.score}/${qs.length}`, color: COULEUR, description: coupe(lignes.join("\n"), 4000),
      fields: [{ name: "Dernière question", value: coupe(retour, 1024) }, { name: "Récompense", value: await recompense(e.uid, xp, e.score * PIECES_BONNE, `Écriture Discord ${e.score}/${qs.length}`) }],
      footer: { text: `${titre} · ${NOM_SITE}` },
    }], components: [ligne(boutonSite("Réviser sur le site"))] } };
  });
}

// =====================================================================
//  /quiz-groupe (tout le salon joue en même temps, avec un chrono)
// =====================================================================
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, Math.max(0, ms)));
const nomMembre = (i: Inter) => i.member?.nick || i.member?.user?.global_name || i.user?.global_name || utilisateur(i).username;
async function relancerGroupe(id: string) {
  const cle = await site.rpc("srv_cron_key");
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/kanji-dojo-bot?tache=groupe&id=${id}`, { method: "POST", headers: { "x-cle": cle } });
  await r.body?.cancel();
}
function questionGroupe(g: site.Groupe, q: L.Question, fin: number) {
  const grand = q.genre !== "frjp" ? `# ${q.grand}` : `## ${q.grand}`;
  const choix = q.choix.map((c, n) => q.genre === "jpfr" ? `**${"ABCD"[n]}.** ${c}` : `### ${"ABCD"[n]}. ${c}`).join("\n");
  return {
    embeds: [{ title: `👥 Question ${g.i + 1}/${g.total}`, color: COULEUR, description: `${q.consigne}\n${grand}\n${choix}\n\n⏱️ Fin <t:${Math.floor(fin / 1000)}:R> · un seul essai par personne` }],
    components: [ligne(...[0, 1, 2, 3].map((n) => ({ type: 2, style: 2, label: "ABCD"[n], custom_id: `ga|${g.id}|${g.i}|${n}` })))],
  };
}
async function poserQuestionGroupe(g: site.Groupe, qs: L.Question[]) {
  const fin = Date.now() + g.duree * 1000;
  await site.majGroupe(g.id, { i: g.i, reponses: {}, ouvert: true, fin_question: new Date(fin).toISOString() });
  const msg = await suite(g.token, questionGroupe(g, qs[g.i], fin));
  await site.majGroupe(g.id, { msg_id: msg.id });
}
async function cmdQuizGroupe(i: Inter) {
  if (!i.guild_id) return erreur("Le quiz de groupe se joue sur un serveur.");
  if (!(await quizAutorise(i))) return erreur("Les quiz sont limités à un autre salon sur ce serveur.");
  if (await site.groupeActif(i.channel_id)) return erreur("Un quiz de groupe est déjà en cours dans ce salon !");
  const liste = option(i, "liste");
  const partie = await resoudrePartie(liste, option(i, "partie"));
  if (partie === undefined) return erreur(PARTIE_INTROUVABLE);
  const sens = option(i, "sens") || "melange";
  const g0 = graine(), total = option(i, "questions") || 10, duree = option(i, "duree") || 20;
  const qs = await L.questionsQuiz(liste, partie, sens, g0, total);
  if (qs.length < 3) return erreur("Pas assez de mots dans cette partie pour un quiz.");
  const g = await site.creerGroupe({ channel_id: i.channel_id, token: i.token, liste, partie, sens, graine: g0, total: qs.length, duree });
  plusTard((async () => { await dormir(6000); await poserQuestionGroupe(g, qs); await relancerGroupe(g.id); })());
  const titre = (await L.nomPartie(liste, partie)) + " · " + L.SENS[sens];
  return message({ embeds: [encadre("👥 Quiz de groupe !",
    `**${titre}**\n${qs.length} questions · ${duree} secondes par question\n\nTout le monde peut jouer : clique sur la bonne lettre. Un seul essai par question, le classement s'affiche à la fin.\n\n**Première question dans quelques secondes…**`)] });
}
async function clicGroupe(i: Inter, parts: string[]) {
  const [id, qi, choix] = parts;
  const r = await site.rpc("srv_groupe_repondre", { p_id: id, p_i: +qi, p_uid: utilisateur(i).id, p_nom: nomMembre(i), p_choix: +choix });
  if (r === "ok") return erreur(`Réponse **${"ABCD"[+choix]}** enregistrée ! Résultat à la fin du chrono.`);
  if (r === "deja") return erreur("Tu as déjà répondu à cette question.");
  return erreur("Trop tard pour cette question !");
}
/** Une étape : attendre la fin du chrono, montrer la réponse, puis poser la question suivante (ou finir). */
async function etapeGroupe(id: string) {
  let g = await site.groupe(id);
  if (!g || g.fini || !g.ouvert) return;
  await dormir(Math.min(40000, new Date(g.fin_question!).getTime() - Date.now() + 800));
  await site.majGroupe(id, { ouvert: false });
  g = (await site.groupe(id))!;
  const qs = await L.questionsQuiz(g.liste, g.partie, g.sens, g.graine, g.total);
  const q = qs[g.i];
  const scores = g.scores || {};
  const gagnants: string[] = [];
  for (const [uid, [choix, nom]] of Object.entries(g.reponses || {})) {
    scores[uid] ??= { n: 0, nom };
    scores[uid].nom = nom;
    if (choix === q.bonne) { scores[uid].n++; gagnants.push(nom); }
  }
  const nb = Object.keys(g.reponses || {}).length;
  const bilan = !nb ? "Personne n'a répondu 😴" : gagnants.length ? `✅ ${gagnants.length}/${nb} : ${gagnants.map(echappe).join(", ")}` : `❌ Personne n'a trouvé (${nb} réponse${nb > 1 ? "s" : ""})`;
  const grand = q.genre !== "frjp" ? `# ${q.grand}` : `## ${q.grand}`;
  if (g.msg_id) {
    await modifierSuite(g.token, g.msg_id, {
      embeds: [{ title: `👥 Question ${g.i + 1}/${g.total} · terminée`, color: COULEUR, description: `${q.consigne}\n${grand}\nRéponse : **${"ABCD"[q.bonne]}. ${q.choix[q.bonne]}**\n${correction(q.mot)}\n\n${bilan}` }],
      components: [ligne(...q.choix.map((c, n) => ({ type: 2, style: n === q.bonne ? 3 : 2, label: "ABCD"[n], custom_id: `ga|${g!.id}|${g!.i}|${n}`, disabled: true })))],
    }).catch((e) => console.error("groupe maj", e));
  }
  await site.majGroupe(id, { scores });
  if (g.i + 1 < qs.length) {
    await dormir(3000);
    g.i++;
    await poserQuestionGroupe(g, qs);
    await relancerGroupe(id);
    return;
  }
  // fin : classement et XP
  await site.majGroupe(id, { fini: true });
  const classement = Object.entries(scores).sort((a, b) => b[1].n - a[1].n);
  const lignes = classement.map(([uid, s], k) => `${k < 3 ? MEDAILLES[k] : "`" + String(k + 1).padStart(2) + "`"} <@${uid}> — **${s.n}**/${qs.length}`);
  for (const [uid, s] of classement) {
    if (s.n) await recompense(uid, s.n * XP_BONNE + (s.n === qs.length ? BONUS_PARFAIT : 0), s.n * PIECES_BONNE, `Quiz de groupe ${s.n}/${qs.length}`).catch(() => {});
  }
  const titre = (await L.nomPartie(g.liste, g.partie)) + " · " + L.SENS[g.sens];
  await suite(g.token, {
    embeds: [{ title: "🏆 Quiz de groupe terminé !", color: COULEUR, description: lignes.join("\n") || "Personne n'a joué cette fois…",
      fields: [{ name: "Récompense", value: `${XP_BONNE} XP par bonne réponse (+${BONUS_PARFAIT} si sans faute) pour les comptes liés au site avec **/lier**.` }], footer: { text: `${titre} · ${NOM_SITE}` } }],
    components: [ligne(boutonSite("Réviser sur le site"))], allowed_mentions: { parse: [] },
  });
}

// =====================================================================
//  /lecture
// =====================================================================
type EtatLec = { uid: string; lv: string; id: string; graine: string; i: number; score: number; masque: number };
const etatLecTexte = (e: EtatLec) => [e.uid, e.lv, e.id, e.graine, e.i, e.score, e.masque.toString(36)].join("|");
function lireEtatLec(p: string[]): EtatLec { const [uid, lv, id, g, i, score, m] = p; return { uid, lv, id, graine: g, i: +i, score: +score, masque: parseInt(m, 36) }; }
async function texteLecture(lv: string, id: string) { const d = await donnees.lecture(); return (d[lv] || []).find((t: any) => t.id === id); }
const ordreOptions = (t: any, g: string, k: number) => L.melanger(t.q[k].opts as string[], L.hasard(g + ":" + k));
const embTexte = (t: any) => ({ title: `📜 ${t.title}`, color: COULEUR, description: coupe(t.paras.join("\n\n"), 4000), footer: { text: `${t.kind} · lis le texte puis réponds aux ${t.q.length} questions` } });
function vueLecture(e: EtatLec, t: any, retour = "") {
  const q = t.q[e.i], opts = ordreOptions(t, e.graine, e.i);
  const emb: any = { title: `❓ Question ${e.i + 1}/${t.q.length}`, color: COULEUR, description: `### ${q.q}\n` + opts.map((o, n) => `**${"ABCD"[n]}.** ${o}`).join("\n"), footer: { text: `${e.score} bonne(s) réponse(s)` } };
  if (retour) emb.fields = [{ name: "Question précédente", value: coupe(retour, 1024) }];
  const etat = etatLecTexte(e);
  return { embeds: [embTexte(t), emb], components: [ligne(...opts.map((_, n) => ({ type: 2, style: 2, label: "ABCD"[n], custom_id: `la|${etat}|${n}` })))] };
}
async function cmdLecture(i: Inter) {
  if (!(await quizAutorise(i))) return erreur("Les quiz sont limités à un autre salon sur ce serveur.");
  const lv = option(i, "niveau"), d = await donnees.lecture();
  const textes = d[lv] || [];
  const id = option(i, "texte");
  const t = (id && textes.find((x: any) => x.id === id)) || textes[Math.floor(Math.random() * textes.length)];
  if (!t) return erreur("Pas de texte pour ce niveau.");
  return message(vueLecture({ uid: utilisateur(i).id, lv, id: t.id, graine: graine(), i: 0, score: 0, masque: 0 }, t));
}
async function clicLecture(i: Inter, parts: string[]) {
  const choix = +parts.pop()!;
  const e = lireEtatLec(parts);
  if (utilisateur(i).id !== e.uid) return erreur("Cette lecture n'est pas la tienne : lance la tienne avec **/lecture** !");
  const t = await texteLecture(e.lv, e.id);
  const q = t?.q[e.i];
  if (!q) return json({ type: R.ATTENTE_MAJ });
  const opts = ordreOptions(t, e.graine, e.i);
  const ok = opts[choix] === q.good;
  if (ok) { e.score++; e.masque |= 1 << e.i; }
  const retour = (ok ? "✅ " : `❌ Réponse : **${q.good}**\n`) + (q.ex || "");
  e.i++;
  if (e.i < t.q.length) return json({ type: R.MAJ, data: vueLecture(e, t, retour) });
  return attendreMaj(i, async () => {
    const n = t.q.length;
    const xp = e.score * XP_BONNE + (e.score === n ? BONUS_PARFAIT : 0);
    const fin = {
      title: `🎌 Lecture terminée : ${e.score}/${n}`, color: COULEUR,
      description: t.q.map((x: any, k: number) => ((e.masque >> k) & 1 ? "✅ " : "❌ ") + x.q).join("\n").slice(0, 3500),
      fields: [
        { name: "Dernière question", value: coupe(retour, 1024) },
        { name: "De quoi parle le texte ?", value: coupe(t.fr || "—", 1024) },
        { name: "Récompense", value: await recompense(e.uid, xp, e.score * PIECES_BONNE, `Lecture Discord ${e.score}/${n}`) },
      ],
    };
    return { corps: { embeds: [embTexte(t), fin], components: [ligne(boutonSite("Lire sur le site (mots cliquables)"))] } };
  });
}

// =====================================================================
//  /dico
// =====================================================================
async function ficheMot(e: L.Entree) {
  const [jp, kana] = e;
  const emb: any = { title: `📖 ${jp}` + (kana && kana !== jp ? ` 【${kana}】` : ""), color: COULEUR, fields: [] };
  const sens = e[5]?.length ? e[5] : [e[2]];
  emb.description = coupe(sens.slice(0, 6).map((s, k) => `**${k + 1}.** ${s}`).join("\n"), 3500) || e[2];
  const info: string[] = [];
  const nv = await L.niveauMot(e); if (nv) info.push(nv);
  const acc = await L.accent(jp, kana || jp); if (acc) info.push(`accent : **${acc[0]}** [${acc[1]}]`);
  if (e[6]) { const autres = e[6].split(" ").filter((x) => x && x !== jp).slice(0, 4); if (autres.length) info.push("aussi écrit : " + autres.join("、")); }
  if (info.length) emb.fields.push({ name: "Repères", value: info.join(" · ") });
  const ex = await L.exemples(jp, 2);
  if (ex.length) emb.fields.push({ name: "Exemples", value: coupe(ex.map(([a, b]) => `${a}\n*${b}*`).join("\n"), 1024) });
  const kx = await donnees.kanjidic();
  const kanjis = [...jp].filter((c) => kx[c]).slice(0, 6);
  if (kanjis.length) emb.fields.push({ name: "Kanji", value: coupe(kanjis.map((c) => `**${c}** ${coupe(kx[c][7] || "", 25)}`).join(" · "), 1024) });
  emb.footer = { text: `${NOM_SITE} · JMdict (EDRDG) en français · exemples Tatoeba · accent Kanjium` };
  return emb;
}
async function vueDico(res: L.Entree[], requete: string, index: number) {
  const e = res[index];
  const lignes: any[] = [];
  if (res.length > 1) {
    lignes.push(ligne({
      type: 3, custom_id: `ds|${coupe(requete, 80)}`, placeholder: `${res.length} résultats : choisis un autre mot`,
      options: res.slice(0, 25).map((r) => ({ label: coupe(r[0] + (r[1] && r[1] !== r[0] ? ` 【${r[1]}】` : ""), 100), description: coupe(r[2] || "—", 100), value: coupe(r[0], 100), default: r[0] === e[0] })),
    }));
  }
  const conj = await L.conjuguer(e[0], e[1], e[4]);
  lignes.push(ligne(
    { type: 2, style: 2, label: "Conjugaison", emoji: { name: "🔁" }, custom_id: `dc|${coupe(e[0], 90)}`, disabled: !conj.length },
    { type: 2, style: 5, label: "Dictionnaire du site", url: LIEN_SITE, emoji: { name: "⛩️" } },
  ));
  return { embeds: [await ficheMot(e)], components: lignes };
}
function cmdDico(i: Inter) {
  const q = option(i, "recherche") || "";
  return attendre(i, async () => {
    const res = await L.chercher(q, 25);
    if (!res.length) return { corps: { content: `Aucun mot trouvé pour « ${coupe(q, 80)} ».` } };
    return { corps: await vueDico(res, q, 0) };
  });
}
async function clicDicoChoix(i: Inter, requete: string) {
  const jp = i.data.values?.[0];
  const res = await L.chercher(requete, 25);
  let k = res.findIndex((r) => r[0] === jp);
  if (k < 0) { const e = await L.entree(jp); if (!e) return json({ type: R.ATTENTE_MAJ }); res.unshift(e); k = 0; }
  return json({ type: R.MAJ, data: await vueDico(res, requete, k) });
}
async function clicConjugaison(jp: string) {
  const e = await L.entree(jp);
  const formes = e ? await L.conjuguer(e[0], e[1], e[4]) : [];
  if (!formes.length) return erreur("Pas de conjugaison pour ce mot.");
  return message({ embeds: [{ title: `🔁 Conjugaison de ${e![0]}`, color: COULEUR, description: formes.map(([n, f]) => `**${n}** : ${f}`).join("\n"), footer: { text: "Formes courantes (forme neutre sauf mention « poli »)" } }] }, true);
}

// =====================================================================
//  /kanji et kanji du jour
// =====================================================================
const NIV_KX: Record<number, string> = { 5: "N5", 4: "N4", 3: "N3", 2: "N2", 1: "N1" };
const classeTxt = (g: number) => !g ? "" : g <= 6 ? `Primaire · ${g}ᵉ année` : g === 8 ? "Jōyō (collège / lycée)" : "Noms de personnes";
async function ficheKanji(c: string, prefixe = "") {
  const cours = await donnees.cours(), kx = await donnees.kanjidic();
  const k = cours.kanji.find((x: any) => x.k === c);
  const r = kx[c];
  const x = r ? { traits: r[1], classe: r[2], jlpt: r[3], freq: r[4], on: r[5], kun: r[6], sens: r[7], memo: r[8], comp: r[9], etym: r[10] } : null;
  const emb: any = { title: `${prefixe}${c}  ·  ${k?.sens || x?.sens || "?"}`, color: COULEUR, fields: [] };
  const on = k?.on?.length ? k.on : x?.on || [], kun = k?.kun?.length ? k.kun : x?.kun || [];
  emb.fields.push({ name: "On'yomi 音読み", value: on.join("、") || "—", inline: true }, { name: "Kun'yomi 訓読み", value: kun.join("、") || "—", inline: true });
  const puces: string[] = [];
  if (x) { if (x.jlpt) puces.push(`JLPT ${NIV_KX[x.jlpt]}`); if (x.traits) puces.push(`${x.traits} traits`); if (x.classe) puces.push(classeTxt(x.classe)); if (x.freq) puces.push(`fréquence n°${x.freq}`); }
  if (k) puces.push(await L.nomSemaine(k.wk));
  if (puces.length) emb.fields.push({ name: "Repères", value: puces.join(" · ") });
  if (k?.cle) emb.fields.push({ name: "Clé 部首", value: k.cle, inline: true });
  const compo = k?.parts || (x?.comp ? [...x.comp].join(" + ") : "");
  if (compo) emb.fields.push({ name: "Composition", value: coupe(compo, 1000) });
  const memo = k?.astuce || x?.memo;
  if (memo) emb.fields.push({ name: "💡 Moyen mémo", value: coupe(memo, 1000) });
  if (x?.etym) emb.fields.push({ name: "📜 Étymologie", value: coupe(x.etym, 1000) });
  const lignes = k?.mots?.length
    ? k.mots.slice(0, 8).map((m: string[]) => `**${m[0]}** 【${m[1]}】 ${m[2]}`)
    : (await L.motsAvec(c, 8)).map((m) => `**${m[0]}**` + (m[1] && m[1] !== m[0] ? ` 【${m[1]}】` : "") + ` ${coupe(m[2], 60)}`);
  if (lignes.length) emb.fields.push({ name: "Vocabulaire", value: coupe(lignes.join("\n"), 1024) });
  if (k?.jp) emb.fields.push({ name: "Exemple", value: coupe(`${k.jp}\n*${k.fr}*`, 1024) });
  if (x?.traits) emb.thumbnail = { url: urlTraits(c) };
  emb.footer = { text: `${NOM_SITE} · KANJIDIC (EDRDG), tracés KanjiVG` };
  return emb;
}
function cmdKanji(i: Inter) {
  const saisie: string = option(i, "caractere") || "";
  return attendre(i, async () => {
    const cours = await donnees.cours(), kx = await donnees.kanjidic();
    if (saisie) {
      const c = [...saisie].find((x) => kx[x] || cours.kanji.some((k: any) => k.k === x));
      if (!c) return { corps: { content: `« ${coupe(saisie, 40)} » n'est pas dans les fiches du dōjō.` } };
      return { corps: { embeds: [await ficheKanji(c)], components: [ligne(boutonSite())] } };
    }
    const niveaux = i.guild_id ? (await site.reglages(i.guild_id).catch(() => null))?.niveaux_kdj ?? ["L2"] : ["L2"];
    const k = await L.kanjiDuJour(aujourdhui(), niveaux);
    return { corps: { embeds: [await ficheKanji(k.k, "今日の漢字 · ")], components: [ligne(boutonSite("Réviser sur le site"))] } };
  });
}

// =====================================================================
//  /profil, /classement, /lier, /delier, /aide
// =====================================================================
function cmdProfil(i: Inter) {
  const pseudo: string | undefined = option(i, "pseudo");
  const membre: string | undefined = option(i, "membre");
  const moi = utilisateur(i).id;
  return attendre(i, async () => {
    let p;
    if (pseudo) {
      p = await site.profilParNom(pseudo);
      if (!p) return { corps: { content: `Aucun joueur « ${coupe(pseudo, 40)} » sur le site.` } };
    } else {
      const cible = membre || moi;
      const lien = await site.compteLie(cible);
      if (!lien) {
        return { corps: { content: cible === moi
          ? "Ton compte Discord n'est pas encore lié au site. Fais **/lier**, ou utilise `/profil pseudo:` avec ton pseudo du site."
          : "Ce membre n'a pas lié son compte. Essaie `/profil pseudo:` avec son pseudo du site." } };
      }
      p = await site.profilParId(lien.user_id);
    }
    const cours = await donnees.cours();
    const BADGES: Record<string, string> = Object.fromEntries(cours.badges);
    const rang = await site.rang(p.xp);
    const lv = L.niveau(p.xp), [dans, besoin] = L.progression(p.xp), [jp, fr] = L.grade(lv);
    const st = p.stats || {};
    const badges = (st.b || []).filter((b: string) => BADGES[b]).reverse().map((b: string) => BADGES[b]);
    const png = await pngCarte({
      nom: p.username, xp: p.xp, niveau: lv, pourcent: besoin ? dans / besoin : 0, titre: cours.titre_noms?.[st.ti || ""] || "",
      badges, nbBadges: Object.keys(BADGES).length, mots: st.m || 0, cartes: st.cc ?? null, avatar: p.avatar,
    });
    let texte = `🎴 **${echappe(p.username)}** · ${jp} ${fr} · rang **#${rang}** du dōjō`;
    const jl = st.jl || {};
    if (Object.values(jl).some(Boolean)) texte += "\n📚 Mots JLPT maîtrisés : " + L.NIVEAUX_JLPT.filter((v) => jl[v]).map((v) => `**${v.toUpperCase()}** ${jl[v]}`).join(" · ");
    return { corps: { content: texte, components: [ligne(boutonSite())], attachments: [{ id: 0, filename: "carte-kanji-dojo.png" }] }, fichiers: [{ nom: "carte-kanji-dojo.png", data: png, type: "image/png" }] };
  });
}

const MEDAILLES = ["🥇", "🥈", "🥉"];
function cmdClassement(i: Inter) {
  return attendre(i, async () => {
    const [rows, liens] = await Promise.all([site.classement(10), site.liaisons().catch(() => ({} as Record<string, string>))]);
    const lignes = rows.map((r: any, k: number) => {
      const lv = L.niveau(r.xp), [jp, fr] = L.grade(lv);
      let qui = `**${echappe(r.username)}**`;
      if (liens[r.id]) qui += ` (<@${liens[r.id]}>)`;
      return `${k < 3 ? MEDAILLES[k] : "`" + String(k + 1).padStart(2) + "`"} ${qui} — Niv. ${lv} · ${r.xp.toLocaleString("fr-FR")} XP · ${jp} ${fr}`;
    });
    return { corps: { embeds: [encadre("🏯 Classement du dōjō", lignes.join("\n") || "Personne pour l'instant.")], components: [ligne(boutonSite("Voir sur le site"))], allowed_mentions: { parse: [] } } };
  });
}

function cmdLier(i: Inter) {
  const u = utilisateur(i);
  return attendre(i, async () => {
    const code = await site.codeLiaison(u.id, u.username);
    return { corps: { embeds: [encadre("🔗 Lier ton compte",
      `Ton code : **\`${code}\`** (valable 15 minutes)\n\n1. Ouvre le site et connecte-toi\n2. **Réglages** ⚙ → **Compte et progression** → **Lier mon Discord**\n3. Colle le code et valide\n\nEnsuite, les XP gagnées dans les quiz et les lectures Discord arrivent sur ton compte du site.`)], components: [ligne(boutonSite())] } };
  }, true);
}
function cmdDelier(i: Inter) {
  const u = utilisateur(i);
  return attendre(i, async () => ({ corps: { content: (await site.delier(u.id)) ? "Ton compte Discord est détaché du site." : "Ton compte n'était pas lié." } }), true);
}
function cmdAide() {
  const e: any = encadre("⛩️ Le bot du Kanji Dōjō", "Le bot est relié au site : mêmes comptes, même XP, même classement. Il fonctionne 24 h/24.");
  e.fields = [
    { name: "/quiz", value: "Cours de Lille (semestre, semaine), JLPT N5 → N1, Hors JLPT ou keigo, dans le sens que tu veux (🇯🇵 → 🇫🇷, 🇫🇷 → 🇯🇵, lecture)" },
    { name: "/ecrire", value: "Tu tapes la réponse toi-même : français → japonais, japonais → français ou lecture des kanji (kana ou romaji)" },
    { name: "/quiz-groupe", value: "Un quiz pour tout le salon avec un chrono : chacun clique sa réponse, classement à la fin" },
    { name: "/lecture", value: "Un texte de compréhension écrite (N5 → N1) suivi de ses questions" },
    { name: "/dico", value: "Le dictionnaire du site : kanji, kana, romaji ou français, avec accent, exemples et conjugaison" },
    { name: "/kanji [caractère]", value: "La fiche d'un kanji N5 → N1 avec moyen mémo, étymologie et ordre des traits animé (vide = kanji du jour)" },
    { name: "/profil · /classement", value: "Ta carte de membre et le top 10 du dōjō" },
    { name: "/lier · /delier", value: "Relier ton compte Discord au site : les quiz et les lectures te donnent alors de l'XP sur le site" },
    { name: "/config (admins)", value: "Choisir le salon du kanji du jour, des passages de niveau et des quiz sur ce serveur" },
  ];
  return message({ embeds: [e], components: [ligne(boutonSite())] });
}

// =====================================================================
//  /config (réglages par serveur)
// =====================================================================
async function cmdConfig(i: Inter) {
  if (!i.guild_id) return erreur("Cette commande s'utilise sur un serveur.");
  const g = i.guild_id;
  const r: site.Reglages = (await site.reglages(g)) ?? { guild_id: g, salon_kanji: null, heure: "08:00", salon_niveaux: null, salons_quiz: [], niveaux_kdj: ["L2"], seulement_lies: false, dernier_kdj: null };
  const opts = Object.fromEntries((i.data.options || []).map((o: any) => [o.name, o.value]));
  if (Object.keys(opts).length) {
    if (opts.salon_kanji) r.salon_kanji = opts.salon_kanji;
    if (opts.heure) {
      const m = String(opts.heure).trim().replace("h", ":").match(/^(\d{1,2})(?::(\d{2}))?$/);
      if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return erreur("Heure illisible : écris par exemple `08:00` ou `19h30`.");
      r.heure = `${m[1].padStart(2, "0")}:${(m[2] || "00")}`;
    }
    if (opts.niveaux_kanji) r.niveaux_kdj = opts.niveaux_kanji === "tous" ? [] : [opts.niveaux_kanji];
    if (opts.salon_niveaux) r.salon_niveaux = opts.salon_niveaux;
    if (opts.seulement_lies !== undefined) r.seulement_lies = !!opts.seulement_lies;
    if (opts.salon_quiz) r.salons_quiz = [opts.salon_quiz];
    if (opts.retirer === "kanji") r.salon_kanji = null;
    if (opts.retirer === "niveaux") r.salon_niveaux = null;
    if (opts.retirer === "quiz") r.salons_quiz = [];
    const { dernier_kdj: _d, ...aEnregistrer } = r;
    await site.enregistrerReglages(aEnregistrer);
  }
  const s = (id: string | null) => (id ? `<#${id}>` : "désactivé");
  return message({ embeds: [encadre("🔧 Réglages du bot sur ce serveur",
    `**Kanji du jour** : ${s(r.salon_kanji)} à **${r.heure}** (heure de Paris) · niveaux : ${r.niveaux_kdj.length ? r.niveaux_kdj.map((v) => L.NIVEAUX[v] || v).join(", ") : "tous"}\n` +
    `**Passages de niveau** : ${s(r.salon_niveaux)}${r.seulement_lies ? " (seulement les comptes liés)" : ""}\n` +
    `**Quiz et lectures** : ${r.salons_quiz.length ? r.salons_quiz.map((x) => `<#${x}>`).join(", ") : "partout"}\n\n` +
    "Pour changer un réglage, refais `/config` avec l'option voulue. Le bot doit pouvoir écrire dans ces salons.")] }, true);
}

// =====================================================================
//  Autocomplétion
// =====================================================================
async function autocompletion(i: Inter) {
  const focus = (i.data.options || []).find((o: any) => o.focused);
  const courant = String(focus?.value || "").toLowerCase();
  let choix: { name: string; value: string }[] = [];
  if (["quiz", "ecrire", "quiz-groupe"].includes(i.data.name) && focus?.name === "partie") {
    const liste = option(i, "liste");
    if (!liste) choix = [{ name: "Choisis d'abord la liste", value: "" }];
    else {
      const ps = (await L.parties(liste)).filter(([, n]) => n.toLowerCase().includes(courant));
      choix = (courant ? [] : [{ name: "Tout mélangé", value: "" }]).concat(ps.slice(0, 24).map(([v, n]) => ({ name: coupe(n, 100), value: v })));
    }
  } else if (i.data.name === "lecture" && focus?.name === "texte") {
    const lv = option(i, "niveau");
    if (!lv) choix = [{ name: "Choisis d'abord le niveau", value: "" }];
    else {
      const d = await donnees.lecture();
      choix = (d[lv] || []).filter((t: any) => (t.title + t.kind).toLowerCase().includes(courant)).slice(0, 25).map((t: any) => ({ name: coupe(`${t.title} (${t.kind})`, 100), value: t.id }));
    }
  }
  return json({ type: R.AUTOCOMPLETE, data: { choices: choix } });
}

// =====================================================================
//  Tâches automatiques (appelées toutes les 5 minutes par la base)
// =====================================================================
async function tacheKanjiDuJour() {
  const jour = aujourdhui(), h = heureParis();
  for (const r of await site.tousReglages()) {
    if (!r.salon_kanji || r.dernier_kdj === jour || h < (r.heure || "08:00")) continue;
    try {
      const k = await L.kanjiDuJour(jour, r.niveaux_kdj ?? ["L2"]);
      await api("POST", `/channels/${r.salon_kanji}/messages`, { embeds: [await ficheKanji(k.k, "今日の漢字 · ")], components: [ligne(boutonSite("Réviser sur le site"))] });
    } catch (e) { console.error("kanji du jour", r.guild_id, e); }
    await site.enregistrerReglages({ guild_id: r.guild_id, dernier_kdj: jour });
  }
}
async function tacheNiveaux() {
  const [joueurs, connus, reglages] = await Promise.all([site.tousLesJoueurs(), site.niveauxConnus(), site.tousReglages()]);
  const premier = Object.keys(connus).length === 0;
  const salons = reglages.filter((r) => r.salon_niveaux);
  const liens = salons.length ? await site.liaisons() : {};
  const maj: { user_id: string; lv: number }[] = [];
  for (const j of joueurs) {
    const lv = L.niveau(j.xp || 0), avant = connus[j.id];
    if (avant === lv) continue;
    maj.push({ user_id: j.id, lv });
    if (premier || avant === undefined || lv <= avant) continue;
    const [jp, fr] = L.grade(lv);
    const d = liens[j.id];
    for (const r of salons) {
      if (r.seulement_lies && !d) continue;
      const qui = d ? `<@${d}>` : `**${echappe(j.username)}**`;
      let texte = `${qui} passe au **niveau ${lv}** sur le Kanji Dōjō !`;
      if (L.grade(avant)[1] !== fr) texte += `\nNouveau grade : **${jp}** ${fr} 🥋`;
      await api("POST", `/channels/${r.salon_niveaux}/messages`, { embeds: [encadre("⭐ Passage de niveau !", texte)], allowed_mentions: { users: d ? [d] : [] } }).catch((e) => console.error("niveau", e));
    }
  }
  await site.enregistrerNiveaux(maj);
}
async function enregistrerCommandes() {
  const app = APP_ID();
  const res = await api("PUT", `/applications/${app}/commands`, COMMANDES);
  // on retire les anciennes commandes « de serveur » de l'ancien bot, sinon elles s'afficheraient en double
  const serveurs = await api("GET", "/users/@me/guilds").catch(() => []);
  for (const g of serveurs || []) await api("PUT", `/applications/${app}/guilds/${g.id}/commands`, []).catch((e) => console.error("nettoyage", g.id, e));
  return { commandes: (res || []).map((c: any) => c.name), serveurs: (serveurs || []).map((g: any) => g.name) };
}

// =====================================================================
//  Point d'entrée
// =====================================================================
async function cleInterneValide(req: Request) {
  const k = req.headers.get("x-cle") || "";
  return !!k && (await site.rpc("srv_check_cron", { p_key: k })) === true;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tache = url.searchParams.get("tache");
  if (tache) {
    if (!(await cleInterneValide(req))) return json({ erreur: "non autorisé" }, 401);
    try {
      if (tache === "cron") { await Promise.allSettled([tacheKanjiDuJour(), tacheNiveaux()]); return json({ ok: true }); }
      if (tache === "enregistrer") return json(await enregistrerCommandes());
      if (tache === "groupe") { const id = url.searchParams.get("id") || ""; plusTard(etapeGroupe(id)); return json({ ok: true }, 202); }
    } catch (e) { console.error(e); return json({ erreur: String(e) }, 500); }
    return json({ erreur: "tâche inconnue" }, 400);
  }
  if (req.method !== "POST") return new Response("Bot Discord du Kanji Dōjō — en ligne ⛩️", { status: 200 });
  const corps = await req.text();
  if (!(await signatureValide(req, corps))) return new Response("signature invalide", { status: 401 });
  const i = JSON.parse(corps);
  try {
    if (i.type === 1) return json({ type: R.PONG });
    if (i.type === 4) return await autocompletion(i);
    if (i.type === 2) {
      switch (i.data.name) {
        case "aide": return cmdAide();
        case "quiz": return await cmdQuiz(i);
        case "ecrire": return await cmdEcrire(i);
        case "quiz-groupe": return await cmdQuizGroupe(i);
        case "lecture": return await cmdLecture(i);
        case "dico": return cmdDico(i);
        case "kanji": return cmdKanji(i);
        case "profil": return cmdProfil(i);
        case "classement": return cmdClassement(i);
        case "lier": return cmdLier(i);
        case "delier": return cmdDelier(i);
        case "config": return await cmdConfig(i);
      }
    }
    if (i.type === 3) {
      const [genre, ...parts] = String(i.data.custom_id).split("|");
      if (genre === "qa") return await clicQuiz(i, parts);
      if (genre === "la") return await clicLecture(i, parts);
      if (genre === "eb") return ouvrirFenetreEcrire(i, parts);
      if (genre === "ep") return await repondreEcrire(i, parts, null);
      if (genre === "ga") return await clicGroupe(i, parts);
      if (genre === "ds") return await clicDicoChoix(i, parts.join("|"));
      if (genre === "dc") return await clicConjugaison(parts.join("|"));
    }
    if (i.type === 5) {
      const [genre, ...parts] = String(i.data.custom_id).split("|");
      if (genre === "ew") return await repondreEcrire(i, parts, String(i.data.components?.[0]?.components?.[0]?.value ?? ""));
    }
    return erreur("Commande inconnue.");
  } catch (e) {
    console.error(e);
    return erreur("Oups, une erreur est survenue. Réessaie dans un instant.");
  }
});
