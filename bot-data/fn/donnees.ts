// =====================================================================
//  Données du bot, lues sur le site (kanji-dojo.fr/bot-data/) et gardées
//  en mémoire tant que la fonction reste chaude.
// =====================================================================
export const BASE = (Deno.env.get("KANJI_DATA_URL") || "https://kanji-dojo.fr/bot-data/").replace(/\/?$/, "/");
const DOSSIER_LOCAL = Deno.env.get("KANJI_DATA_DIR"); // pour les tests sur ordinateur

const cache = new Map<string, Promise<any>>();
function charge(nom: string): Promise<any> {
  if (!cache.has(nom)) {
    const p = (async () => {
      if (DOSSIER_LOCAL) return JSON.parse(await Deno.readTextFile(`${DOSSIER_LOCAL}/${nom}`));
      const r = await fetch(BASE + nom);
      if (!r.ok) throw new Error(`données ${nom} : ${r.status}`);
      return await r.json();
    })();
    p.catch(() => cache.delete(nom));
    cache.set(nom, p);
  }
  return cache.get(nom)!;
}

let kx: Promise<Record<string, any[]>> | null = null;
export const donnees = {
  cours: () => charge("cours.json"),
  lecture: () => charge("lecture.json"),
  dico: () => charge("dico.json"),
  // [kanji, traits, classe, jlpt (5 = N5 … 1 = N1), fréquence, on, kun, sens, mémo, composants, étymologie]
  kanjidic: () => (kx ??= charge("kanjidic.json").then((l: any[]) => Object.fromEntries(l.map((r) => [r[0], r])))),
};

export const urlTraits = (c: string) => `${BASE}traits/${c.codePointAt(0)!.toString(16)}.gif`;
