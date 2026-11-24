// =====================================================================
//  Définition des commandes (envoyées à Discord par l'action « enregistrer »)
// =====================================================================
import { LISTES, SENS } from "./logique.ts";

// integration_types : 0 = installée sur un serveur, 1 = installée sur son compte
// contexts : 0 = serveur, 1 = MP avec le bot, 2 = MP / groupes
const PARTOUT = { integration_types: [0, 1], contexts: [0, 1, 2] };
const SERVEUR = { integration_types: [0], contexts: [0] };
const choix = (o: Record<string, string>) => Object.entries(o).map(([value, name]) => ({ name, value }));

export const COMMANDES = [
  { name: "aide", description: "Comment marche le bot du Kanji Dōjō", ...PARTOUT },
  {
    name: "quiz", description: "Un quiz de vocabulaire : cours, JLPT N5 → N1, Hors JLPT ou keigo", ...PARTOUT,
    options: [
      { type: 3, name: "liste", description: "Ton semestre du cours, un niveau JLPT, Hors JLPT ou le keigo", required: true, choices: choix(LISTES) },
      { type: 3, name: "partie", description: "Une semaine (cours) ou un thème (JLPT, keigo) ; vide = tout", autocomplete: true },
      { type: 3, name: "sens", description: "Japonais → français, français → japonais, lecture ou mélange", choices: choix(SENS) },
      { type: 4, name: "questions", description: "Nombre de questions (5 par défaut)", min_value: 3, max_value: 20 },
    ],
  },
  {
    name: "ecrire", description: "Écrire la réponse au clavier : français → japonais, japonais → français ou lecture des kanji", ...PARTOUT,
    options: [
      { type: 3, name: "liste", description: "Ton semestre du cours, un niveau JLPT, Hors JLPT ou le keigo", required: true, choices: choix(LISTES) },
      { type: 3, name: "partie", description: "Une semaine (cours) ou un thème (JLPT, keigo) ; vide = tout", autocomplete: true },
      { type: 3, name: "sens", description: "Dans quel sens écrire (français → japonais par défaut)", choices: [
        { name: "Français → Japonais (kana, kanji ou romaji)", value: "fr" }, { name: "Japonais → Français", value: "jp" },
        { name: "Lecture des kanji (kana ou romaji)", value: "lecture" }, { name: "Mélange", value: "melange" }] },
      { type: 4, name: "questions", description: "Nombre de mots (5 par défaut)", min_value: 3, max_value: 15 },
    ],
  },
  {
    name: "quiz-groupe", description: "Un quiz pour tout le salon avec un chrono : chacun clique sa réponse, classement à la fin", integration_types: [0], contexts: [0],
    options: [
      { type: 3, name: "liste", description: "Ton semestre du cours, un niveau JLPT, Hors JLPT ou le keigo", required: true, choices: choix(LISTES) },
      { type: 3, name: "partie", description: "Une semaine (cours) ou un thème (JLPT, keigo) ; vide = tout", autocomplete: true },
      { type: 3, name: "sens", description: "Japonais → français, français → japonais, lecture ou mélange", choices: choix(SENS) },
      { type: 4, name: "questions", description: "Nombre de questions (10 par défaut)", min_value: 3, max_value: 15 },
      { type: 4, name: "duree", description: "Secondes par question (20 par défaut)", min_value: 10, max_value: 30 },
    ],
  },
  {
    name: "lecture", description: "Compréhension écrite : un texte japonais (N5 → N1) puis ses questions", ...PARTOUT,
    options: [
      { type: 3, name: "niveau", description: "Le niveau JLPT du texte", required: true, choices: ["n5", "n4", "n3", "n2", "n1"].map((v) => ({ name: "JLPT " + v.toUpperCase(), value: v })) },
      { type: 3, name: "texte", description: "Un texte précis (vide = au hasard)", autocomplete: true },
    ],
  },
  {
    name: "dico", description: "Chercher un mot : kanji, kana, romaji ou français (dictionnaire du site)", ...PARTOUT,
    options: [{ type: 3, name: "recherche", description: "Ex. 食べる, たべる, taberu ou manger", required: true }],
  },
  {
    name: "kanji", description: "La fiche d'un kanji N5 → N1 : lectures, mémo, étymologie, ordre des traits animé", ...PARTOUT,
    options: [{ type: 3, name: "caractere", description: "Un kanji (ou un mot : le bot prend son premier kanji). Vide = le kanji du jour" }],
  },
  {
    name: "profil", description: "La carte de membre d'un joueur du site", ...PARTOUT,
    options: [
      { type: 6, name: "membre", description: "Un membre Discord qui a lié son compte" },
      { type: 3, name: "pseudo", description: "Ou le pseudo sur le site" },
    ],
  },
  { name: "classement", description: "Le classement du Kanji Dōjō", ...PARTOUT },
  { name: "lier", description: "Relier ton compte Discord à ton compte du Kanji Dōjō", ...PARTOUT },
  { name: "delier", description: "Détacher ton compte Discord du Kanji Dōjō", ...PARTOUT },
  {
    name: "config", description: "(Admins) Réglages du bot sur ce serveur : kanji du jour, passages de niveau, quiz", ...SERVEUR,
    default_member_permissions: String(1 << 5), // Gérer le serveur
    options: [
      { type: 7, name: "salon_kanji", description: "Salon où poster le kanji du jour", channel_types: [0, 5] },
      { type: 3, name: "heure", description: "Heure du kanji du jour (heure de Paris), ex. 08:00" },
      { type: 3, name: "niveaux_kanji", description: "Niveaux tirés pour le kanji du jour", choices: [{ name: "Tous", value: "tous" }, ...["L0", "L0S2", "L1", "L1S2", "L2"].map((v) => ({ name: LISTES[v], value: v }))] },
      { type: 7, name: "salon_niveaux", description: "Salon où annoncer les passages de niveau du site", channel_types: [0, 5] },
      { type: 5, name: "seulement_lies", description: "N'annoncer que les joueurs qui ont lié leur compte Discord" },
      { type: 7, name: "salon_quiz", description: "Limiter /quiz et /lecture à ce salon", channel_types: [0, 5] },
      { type: 3, name: "retirer", description: "Désactiver un réglage", choices: [{ name: "Kanji du jour", value: "kanji" }, { name: "Passages de niveau", value: "niveaux" }, { name: "Limite des quiz", value: "quiz" }] },
    ],
  },
];
