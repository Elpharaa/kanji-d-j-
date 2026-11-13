# Consignes pour les modifications de ce site (Kanji Dōjō)

Avant toute modification :
1. Repartir de la **dernière version en ligne** sur GitHub (`git pull`), jamais d'une ancienne copie d'`index.html`.
2. Ne jamais supprimer ni réécrire les blocs marqués **`DISCORD-BOT`** dans `index.html`.
   Ils servent au bot Discord du Kanji Dōjō :
   - la case « Lier mon Discord » dans Réglages → Compte et progression (`id="dcBox"`) ;
   - les fonctions `dcStart`, `dcStop`, `dcClaim`, `dcRender`, `dcPubCards`, `dcPubJlpt` ;
   - `rpc` et `discordLink` dans le backend Supabase ;
   - les champs `cc` et `jl` ajoutés à `publicStats` (lus par la commande `/profil` du bot).
3. Ne pas modifier les tables et fonctions Supabase `discord_links`, `discord_rewards`,
   `link_discord`, `unlink_discord`, `claim_discord_rewards`, `bot_*` : le bot en dépend.

Avant toute mise en ligne :
4. Lancer `python3 tools/smoke.py` (vérifie la syntaxe, la version, les blocs `DISCORD-BOT`, les écrans principaux, l'Écriture, la Géographie, l'Histoire et les Réglages). Ne publier que si le résultat est « TOUT EST BON ».
