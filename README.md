# Knut-Bug — Contrôle WhatsApp via interface web

## Pourquoi le bot affichait « déconnecté »

Le statut affiché sur le site vient du serveur (`GET /api/bot/status`), qui lit la liste des
sockets WhatsApp **en mémoire**. Il ne reflète donc pas l'état réel côté WhatsApp :
un appareil peut rester « Actif » dans *Appareils connectés* alors que le serveur n'a plus
aucune socket ouverte.

Trois causes, toutes liées au plan **Render Free** :

| Cause | Conséquence |
|---|---|
| Mise en veille après ~15 min sans trafic HTTP | le process Node meurt → les sockets disparaissent |
| **Disque éphémère** | les dossiers `sessions/` et `users.json` sont effacés à chaque veille / redémarrage / redeploy → plus aucun identifiant pour se reconnecter sans refaire un code |
| `express-session` en mémoire | tous les utilisateurs déconnectés du site à chaque redémarrage |

S'ajoutait une logique de reconnexion fragile : 3 essais maximum, puis suppression des
identifiants (= déconnexion « définitive »), et aucune restauration au démarrage.

## Ce qui a été corrigé

1. **Sessions WhatsApp dans Postgres** (table `bot_sessions`) — plus de dossier `sessions/`.
   Un redéploy ne perd plus le jumelage.
2. **Restauration automatique au démarrage** — les bots rouvrent leur socket tout seuls,
   sans que personne n'ouvre le navigateur.
3. **Reconnexion robuste** — backoff exponentiel (5 s → 5 min max), tentatives illimitées,
   les identifiants ne sont effacés que sur un vrai `loggedOut` (401) ou une déconnexion
   demandée depuis le site.
4. **Comptes et sessions web dans Postgres** (`users`, `session`) — on reste connecté au site
   après un redémarrage.
5. **Un bot par utilisateur** — les bots sont indexés par `user_id` ; chaque utilisateur ne
   peut voir, piloter ou arrêter que le sien (numéro unique, rooms Socket.IO liées à la session).
6. **`/health`** pour UptimeRobot, afin d'empêcher la mise en veille.

## Installation des variables d'environnement (Render > Environment)

⚠️ Aucun secret n'est dans le dépôt : tout passe par ces variables.

| Variable | Obligatoire | Exemple / défaut |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require` |
| `SESSION_SECRET` | conseillé | longue chaîne aléatoire — sans elle, un secret temporaire est généré au démarrage (tout le monde est déconnecté du site à chaque redeploy) |
| `ADMIN_USERS` | conseillé | `Raizel:Motdepasse,Knut:Motdepasse,Crazy:Motdepasse` |
| `ADMIN_USERNAMES` | optionnel | `Raizel,Knut` → donne les droits admin à des comptes existants |
| `MAX_BOTS` | optionnel | `5` (défaut) — à garder bas, voir RAM ci-dessous |
| `SESSION_TTL_DAYS` | optionnel | `30` |
| `SAVE_DEBOUNCE_MS` | optionnel | `2000` — délai avant écriture des clés WhatsApp en base |
| `RESTORE_DELAY_MS` | optionnel | `3000` — délai entre deux reconnexions au démarrage |
| `AUTO_RESTORE_BOTS` | optionnel | `true` |
| `PGSSL` | optionnel | `auto` (défaut) / `require` / `disable` |

Le schéma est créé automatiquement au premier démarrage :

```
users          (id, username, password_hash, is_admin, status, wa_number unique, created_at)
session        (sid, sess, expire)                    <- sessions web
bot_sessions   (user_id PK, wa_number, creds, keys, connected, last_seen, updated_at)
```

## Garder l'instance éveillée

Créer un moniteur **UptimeRobot** (ou tout cron) qui appelle toutes les **5 minutes** :

```
GET https://ton-service.onrender.com/health
```

Réponse : `{"ok":true,"uptime":123,"bots":{"total":2,"connected":2}}`

Le keep-alive évite la mise en veille, mais Render redémarre parfois l'instance :
c'est la restauration automatique (point 2) qui garantit la continuité.

## Limites à connaître

- **RAM** : une instance Render Free dispose de ~512 Mo. Une socket Baileys consomme
  grosso modo 40 à 80 Mo → `MAX_BOTS` doit rester bas (5 par défaut) sous peine d'être
  tué par l'OOM killer (ce qui produirait exactement le symptôme « bot déconnecté »).
- **Neon Free** passe la base en veille après quelques minutes sans requête : la première
  requête après un réveil peut échouer, le pool réessaie automatiquement deux fois.
- Pendant un redeploy, l'ancien process et le nouveau possèdent brièvement le même
  jumelage : WhatsApp peut renvoyer un code `440` (connexion remplacée), ce qui déclenche
  une reconnexion rapide — c'est normal.

## Démarrer en local

```bash
npm install
export DATABASE_URL="postgresql://..."
export SESSION_SECRET="une-chaine-aleatoire"
export ADMIN_USERS="Raizel:Motdepasse"
npm start
```
