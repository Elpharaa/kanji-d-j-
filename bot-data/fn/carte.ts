// =====================================================================
//  Carte de membre (comme « Partager ma carte » sur le site), dessinée en SVG
//  puis convertie en PNG avec resvg. Police : Zen Kaku Gothic New (celle du site).
// =====================================================================
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

const CDN = "https://cdn.jsdelivr.net/npm/";
const RESSOURCES = {
  wasm: "@resvg/resvg-wasm@2.6.2/index_bg.wasm",
  gras: "@expo-google-fonts/zen-kaku-gothic-new@0.4.2/700Bold/ZenKakuGothicNew_700Bold.ttf",
  moyen: "@expo-google-fonts/zen-kaku-gothic-new@0.4.2/500Medium/ZenKakuGothicNew_500Medium.ttf",
};
export let chargeOctets = async (chemin: string): Promise<Uint8Array> => {
  const r = await fetch(CDN + chemin);
  if (!r.ok) throw new Error(`ressource ${chemin} : ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
export function choisirChargeur(f: (p: string) => Promise<Uint8Array>) { chargeOctets = f; }

let pret: Promise<Uint8Array[]> | null = null;
function demarrer() {
  pret ??= (async () => {
    const [wasm, gras, moyen] = await Promise.all([chargeOctets(RESSOURCES.wasm), chargeOctets(RESSOURCES.gras), chargeOctets(RESSOURCES.moyen)]);
    await initWasm(wasm);
    return [gras, moyen];
  })();
  pret.catch(() => (pret = null));
  return pret;
}

const W = 1080, H = 1350;
const echappe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// largeur approximative d'un texte (les caractères japonais sont carrés)
const largeur = (s: string, taille: number) => [...s].reduce((t, c) => t + (/[　-鿿＀-￯]/.test(c) ? 1 : /[A-Z0-9MW]/.test(c) ? 0.68 : 0.56), 0) * taille;
const T = (x: number, y: number, taille: number, txt: string, couleur: string, poids = 700, ancre = "middle", extra = "") =>
  `<text x="${x}" y="${y + taille * 0.36}" font-family="Zen Kaku Gothic New" font-weight="${poids}" font-size="${taille}" fill="${couleur}" text-anchor="${ancre}" ${extra}>${echappe(txt)}</text>`;

export type Carte = { nom: string; xp: number; niveau: number; pourcent: number; titre: string; badges: string[]; nbBadges: number; mots: number; cartes: number | null; avatar: string | null };

export function svgCarte(c: Carte) {
  const OR = "#F0B97A", CREME = "#FFFAF0", ROSE = "#D0587F", PALE = "#E9D9C8";
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  p.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2C2452"/><stop offset="0.6" stop-color="#4B3D84"/><stop offset="1" stop-color="#8C3A79"/></linearGradient>`);
  p.push(`<clipPath id="rond"><circle cx="540" cy="330" r="150"/></clipPath></defs>`);
  p.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`);
  p.push(T(W / 2, 760 - 760 * 0.36 + 760 * 0.36, 760, "会", "#FFFFFF", 700, "middle", `fill-opacity="0.05"`));
  for (let i = 0; i < 26; i++) {
    const x = (i * 211) % W, y = (i * 137) % H, a = 0.25 + (i % 4) * 0.1;
    p.push(`<ellipse cx="${x}" cy="${y}" rx="9" ry="6" fill="#F9B9CF" fill-opacity="${a.toFixed(2)}" transform="rotate(${i * 23} ${x} ${y})"/>`);
  }
  p.push(`<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="44" fill="none" stroke="${OR}" stroke-width="6"/>`);
  p.push(`<rect x="52" y="52" width="${W - 104}" height="${H - 104}" rx="34" fill="none" stroke="${OR}" stroke-opacity="0.4" stroke-width="2"/>`);
  p.push(T(W / 2, 118, 34, "会員証 · CARTE DE MEMBRE", OR));
  // photo
  p.push(`<circle cx="540" cy="330" r="164" fill="${OR}"/>`);
  const av = c.avatar && /^data:image\/(png|jpe?g|webp|gif)/.test(c.avatar) ? c.avatar : null;
  if (av) p.push(`<image href="${av}" x="390" y="180" width="300" height="300" preserveAspectRatio="xMidYMid slice" clip-path="url(#rond)"/>`);
  else { p.push(`<circle cx="540" cy="330" r="150" fill="${ROSE}"/>`); p.push(T(540, 330, 150, ([...c.nom][0] || "?").toUpperCase(), CREME)); }
  // nom, titre, niveau
  let taille = 92;
  while (taille > 30 && largeur(c.nom, taille) > 860) taille -= 4;
  p.push(T(W / 2, 556, taille, c.nom, CREME));
  if (c.titre) p.push(T(W / 2, 640, 38, c.titre, "#E9A5B6", 500));
  p.push(T(W / 2, 760, 150, `Niv. ${c.niveau}`, OR));
  // barre d'XP
  p.push(`<rect x="140" y="840" width="${W - 280}" height="34" rx="17" fill="#FFFFFF" fill-opacity="0.18"/>`);
  const l = Math.max(34, Math.round((W - 280) * Math.max(0, Math.min(1, c.pourcent))));
  p.push(`<rect x="140" y="840" width="${l}" height="34" rx="17" fill="${ROSE}"/>`);
  p.push(T(W / 2, 912, 30, `${c.xp} XP`, CREME, 500));
  // trois cases
  const stats: [string, string, string][] = [["章", `${c.badges.length}/${c.nbBadges}`, "badges"], ["語", String(c.mots), "mots maîtrisés"], ["札", c.cartes == null ? "—" : String(c.cartes), "cartes"]];
  stats.forEach(([g, val, lib], k) => {
    const x = 100 + k * 290;
    p.push(`<rect x="${x}" y="960" width="260" height="150" rx="24" fill="#FFFAF0" fill-opacity="0.12"/>`);
    p.push(T(x + 22, 1000, 34, g, OR, 700, "start"));
    p.push(T(x + 130, 1042, 60, val, CREME));
    p.push(T(x + 130, 1094, 26, lib, PALE, 500));
  });
  // 6 derniers badges
  const six = c.badges.slice(0, 6);
  six.forEach((g, k) => {
    const x = W / 2 + (k - (six.length - 1) / 2) * 140;
    p.push(`<circle cx="${x}" cy="1190" r="52" fill="${CREME}" stroke="${OR}" stroke-width="5"/>`);
    p.push(T(x, 1192, 54, g, "#2C2452"));
  });
  p.push(T(W / 2, 1272, 28, "漢字道場 · kanji-dojo.fr", PALE, 500));
  p.push(`</svg>`);
  return p.join("");
}

export async function pngCarte(c: Carte): Promise<Uint8Array> {
  const polices = await demarrer();
  const r = new Resvg(svgCarte(c), { font: { fontBuffers: polices, loadSystemFonts: false, defaultFontFamily: "Zen Kaku Gothic New" }, fitTo: { mode: "width", value: 720 } });
  return r.render().asPng();
}
