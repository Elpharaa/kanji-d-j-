// =====================================================================
//  Accès à la base Supabase du site (clé de service : la fonction tourne
//  côté serveur, chez Supabase, la clé n'est jamais montrée à personne).
// =====================================================================
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = () => ({ apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" });

async function get(chemin: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, { headers: { ...H(), ...extra } });
  if (!r.ok) throw new Error(`base ${chemin.split("?")[0]} : ${r.status} ${await r.text()}`);
  return r;
}
export async function rpc(nom: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: H(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${nom} : ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function ecrire(methode: string, chemin: string, corps: unknown, prefer = "return=minimal") {
  const r = await fetch(`${URL_SB}/rest/v1/${chemin}`, { method: methode, headers: { ...H(), Prefer: prefer }, body: JSON.stringify(corps) });
  if (!r.ok) throw new Error(`base ${chemin} : ${r.status} ${await r.text()}`);
}

// ---------- Joueurs du site ----------
export const classement = async (n = 10) => (await get(`profiles?select=id,username,xp&order=xp.desc&limit=${n}`)).json();
export const tousLesJoueurs = async () => (await get(`profiles?select=id,username,xp&limit=5000`)).json();
export async function profilParNom(nom: string) {
  const r = await (await get(`profiles?select=id,username,xp,avatar,stats&username_lower=eq.${encodeURIComponent(nom.trim().toLowerCase())}`)).json();
  return r[0] ?? null;
}
export async function profilParId(id: string) {
  const r = await (await get(`profiles?select=id,username,xp,avatar,stats&id=eq.${id}`)).json();
  return r[0] ?? null;
}
export async function rang(xp: number) {
  const r = await get(`profiles?select=id&xp=gt.${xp}`, { Prefer: "count=exact", Range: "0-0" });
  const tot = (r.headers.get("Content-Range") || "*/0").split("/").pop()!;
  await r.body?.cancel();
  return /^\d+$/.test(tot) ? Number(tot) + 1 : 0;
}

// ---------- Liaison Discord et récompenses (fonctions srv_* réservées au serveur) ----------
export const codeLiaison = (discordId: string, nom: string) => rpc("srv_create_link_code", { p_discord_id: discordId, p_discord_name: nom });
export async function compteLie(discordId: string) { const r = await rpc("srv_get_link", { p_discord_id: discordId }); return r?.[0] ?? null; }
export async function liaisons(): Promise<Record<string, string>> {
  const r = await rpc("srv_list_links");
  return Object.fromEntries((r || []).map((x: any) => [x.user_id, x.discord_id]));
}
export const delier = (discordId: string) => rpc("srv_unlink", { p_discord_id: discordId });
export async function recompenser(discordId: string, xp: number, pieces: number, raison: string) {
  const r = await rpc("srv_give_reward", { p_discord_id: discordId, p_xp: xp, p_coins: pieces, p_reason: raison });
  return r?.[0] ?? { xp: 0, coins: 0, xp_left: 0 };
}

// ---------- Réglages par serveur Discord ----------
export type Reglages = {
  guild_id: string; salon_kanji: string | null; heure: string; salon_niveaux: string | null;
  salons_quiz: string[]; niveaux_kdj: string[]; seulement_lies: boolean; dernier_kdj: string | null;
};
export async function reglages(guildId: string): Promise<Reglages | null> {
  const r = await (await get(`kd_guild_config?guild_id=eq.${guildId}`)).json();
  return r[0] ?? null;
}
export const tousReglages = async (): Promise<Reglages[]> => (await get(`kd_guild_config?select=*`)).json();
export const enregistrerReglages = (r: Partial<Reglages> & { guild_id: string }) =>
  ecrire("POST", "kd_guild_config?on_conflict=guild_id", { ...r, maj: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");

// ---------- Niveaux connus (annonces de passage de niveau) ----------
export const niveauxConnus = async (): Promise<Record<string, number>> =>
  Object.fromEntries(((await (await get(`kd_levels?select=user_id,lv&limit=10000`)).json()) as any[]).map((x) => [x.user_id, x.lv]));
export const enregistrerNiveaux = (lignes: { user_id: string; lv: number }[]) =>
  lignes.length ? ecrire("POST", "kd_levels?on_conflict=user_id", lignes, "resolution=merge-duplicates,return=minimal") : Promise.resolve();

// ---------- Quiz de groupe ----------
export type Groupe = {
  id: string; channel_id: string; token: string; liste: string; partie: string | null; sens: string; graine: string;
  total: number; duree: number; i: number; msg_id: string | null; ouvert: boolean; fin_question: string | null;
  reponses: Record<string, [number, string]>; scores: Record<string, { n: number; nom: string }>; fini: boolean; cree: string;
};
export async function creerGroupe(g: Partial<Groupe>): Promise<Groupe> {
  const r = await fetch(`${URL_SB}/rest/v1/kd_groupe`, { method: "POST", headers: { ...H(), Prefer: "return=representation" }, body: JSON.stringify(g) });
  if (!r.ok) throw new Error(`base kd_groupe : ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}
export async function groupe(id: string): Promise<Groupe | null> {
  const r = await (await get(`kd_groupe?id=eq.${id}`)).json();
  return r[0] ?? null;
}
export const majGroupe = (id: string, patch: Partial<Groupe>) => ecrire("PATCH", `kd_groupe?id=eq.${id}`, patch);
export async function groupeActif(salon: string) {
  const depuis = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const r = await (await get(`kd_groupe?select=id&channel_id=eq.${salon}&fini=eq.false&cree=gt.${depuis}`)).json();
  return r.length > 0;
}
