// =====================================================================
//  Petits outils pour parler à Discord (réponses, messages, signatures)
// =====================================================================
export const API = "https://discord.com/api/v10";
export const TOKEN = () => Deno.env.get("KANJI_DISCORD_TOKEN") || "";
// L'identifiant de l'application se lit dans la première partie du token
export const APP_ID = () => Deno.env.get("KANJI_DISCORD_APP_ID") || (() => {
  try { return atob(TOKEN().split(".")[0].replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
})();

export const COULEUR = 0xB3271D;
export const NOM_SITE = "Kanji Dōjō";
export const LIEN_SITE = "https://kanji-dojo.fr/";
export const EPHEMERE = 64;

// Types de réponse aux interactions
export const R = { PONG: 1, MESSAGE: 4, ATTENTE: 5, ATTENTE_MAJ: 6, MAJ: 7, AUTOCOMPLETE: 8, FENETRE: 9 };

export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// ---------- Signature Ed25519 ----------
const hex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
let cle: CryptoKey | null = null;
export async function signatureValide(req: Request, corps: string) {
  const sig = req.headers.get("X-Signature-Ed25519"), ts = req.headers.get("X-Signature-Timestamp");
  const pub = Deno.env.get("KANJI_DISCORD_PUBLIC_KEY") || "";
  if (!sig || !ts || !pub) return false;
  try {
    cle ??= await crypto.subtle.importKey("raw", hex(pub.trim()), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", cle, hex(sig), new TextEncoder().encode(ts + corps));
  } catch { return false; }
}

// ---------- Appels à l'API ----------
export type Fichier = { nom: string; data: Uint8Array; type?: string };
async function envoyer(methode: string, chemin: string, corps?: unknown, fichiers: Fichier[] = [], bot = true) {
  const headers: Record<string, string> = {};
  if (bot) headers.Authorization = `Bot ${TOKEN()}`;
  let body: BodyInit | undefined;
  if (fichiers.length) {
    const f = new FormData();
    f.append("payload_json", JSON.stringify(corps ?? {}));
    fichiers.forEach((x, i) => f.append(`files[${i}]`, new Blob([x.data], { type: x.type || "application/octet-stream" }), x.nom));
    body = f;
  } else if (corps !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(corps);
  }
  for (let essai = 0; essai < 3; essai++) {
    const r = await fetch(API + chemin, { method: methode, headers, body });
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise((ok) => setTimeout(ok, ((j as any).retry_after ?? 1) * 1000)); continue; }
    if (!r.ok) throw new Error(`${methode} ${chemin} : ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.status === 204 ? null : await r.json();
  }
  throw new Error("Discord : trop de requêtes");
}
export const api = (methode: string, chemin: string, corps?: unknown, fichiers: Fichier[] = []) => envoyer(methode, chemin, corps, fichiers, true);

/** Modifier la réponse d'une interaction (après une attente). */
export const modifierReponse = (token: string, corps: unknown, fichiers: Fichier[] = []) =>
  envoyer("PATCH", `/webhooks/${APP_ID()}/${token}/messages/@original`, corps, fichiers, false);
export const modifierSuite = (token: string, id: string, corps: unknown) =>
  envoyer("PATCH", `/webhooks/${APP_ID()}/${token}/messages/${id}`, corps, [], false);
export const suite = (token: string, corps: unknown, fichiers: Fichier[] = []) =>
  envoyer("POST", `/webhooks/${APP_ID()}/${token}`, corps, fichiers, false);

// ---------- Composants ----------
export const encadre = (titre: string, texte = "", extra: Record<string, unknown> = {}) =>
  ({ title: titre, description: texte, color: COULEUR, footer: { text: `${NOM_SITE} · kanji-dojo.fr` }, ...extra });
export const boutonSite = (label = "Ouvrir le Kanji Dōjō") => ({ type: 2, style: 5, label, url: LIEN_SITE, emoji: { name: "⛩️" } });
export const ligne = (...composants: unknown[]) => ({ type: 1, components: composants });
export const coupe = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const echappe = (s: string) => s.replace(/([*_`~|>\\])/g, "\\$1");
