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

## Commandes en arrière-plan (jobs) — la page ne gèle plus

**Symptôme corrigé** : la page restait figée sur « Exécution en cours... Veuillez patienter »,
puis affichait un message rouge (« Erreur de connexion au serveur ») quand on revenait sur
l'onglet — alors que la commande continuait de tourner côté serveur sans aucun retour.

**Cause** : `POST /api/bot/command` faisait `await executeWebCommand(...)` qui faisait lui-même
`await cmd.execute(...)`. Or les commandes « bug » bouclent pendant **24 h**
(`while (Date.now() - START < DURATION)`). La réponse HTTP n'arrivait donc qu'au bout de 24 h :

| Étape | Conséquence |
|---|---|
| `await fetch()` côté navigateur | la page reste figée indéfiniment |
| proxy (Render / nginx / Cloudflare) | coupe la connexion après ~30-100 s → **502/504** → message rouge |
| boucle Node | continue de tourner : couper une connexion HTTP n'annule pas une promesse |

**Correctif** : les commandes longues (propriété `background: true`) sont confiées à un moteur
de jobs (`js/jobs.js`) et la route répond en **~5 ms** (`HTTP 202` + `jobId`).

```
POST /api/bot/command   → 202 { jobId, job, message }     (immédiat, jamais bloquant)
GET  /api/jobs          → liste des jobs (running en tête) + compteurs live
GET  /api/jobs/:id      → état d'un job
POST /api/jobs/:id/stop → arrêt propre (le sommeil de 5 min est interrompu aussitôt)
Socket.IO  job:started / job:progress / job:status / job:done / job:cancelled / job:error
```

Le job **continue de tourner navigateur fermé** : il vit dans le process Node, pas dans
l'onglet. À la réouverture de la page, `GET /api/jobs` réaffiche le job en cours avec sa
barre de progression et son temps restant.

### Persistance et reprise (table `bot_jobs`)

Chaque job est enregistré en base avec une **échéance absolue** (`ends_at`) et ses compteurs
(`sent_count`, `hour_count`, `hour_start`). Au démarrage, après `restoreAllBots()`,
`resumeAllJobs()` relit les jobs `status='running'` dont l'échéance n'est pas passée et
**reprend la boucle sur le temps restant** — pas 24 h de plus. Un redeploy Render ne perd donc
plus l'exécution en cours.

À l'arrêt (`SIGTERM`), `flushJobs()` sauvegarde les compteurs et laisse le statut à `running`
pour que la reprise ait lieu au boot suivant.

Deux garanties supplémentaires pour tenir réellement 24 h :

- **Socket « vivante »** : `context.sock` est un *getter* qui renvoie la socket courante du bot.
  Si le bot se déconnecte/reconnecte pendant le job, la nouvelle connexion est utilisée
  automatiquement (avant, la référence capturée au lancement devenait morte).
- **`context.waitForSocket()`** : si le bot est déconnecté, le job **patiente** et repart dès la
  reconnexion au lieu de s'arrêter. Un job de 24 h ne meurt plus d'une coupure réseau.
- **`try/catch` par action** : un échec ponctuel (réseau, 429, socket morte) n'interrompt plus
  les 24 h — avant, un seul `catch` global autour de toute la boucle tuait le job.

### Keep-alive interne

Un job dure 24 h : il faut que le process reste vivant. Si `PUBLIC_URL` (ou
`RENDER_EXTERNAL_URL`, fourni automatiquement par Render) est défini, le serveur se ping
lui-même toutes les 5 min (`KEEP_ALIVE_MS`) pour éviter la mise en veille du plan Free.
Un moniteur UptimeRobot sur `/health` reste recommandé en complément.

## Liste blanche — numéros protégés

Tableau écrit en dur dans **`js/config.js`** :

```js
const WHITELIST_NUMBERS = [
  '237600000000', // EXEMPLE — à remplacer par tes vrais numéros
  '237611111111',
  '33600000000'
];
```

Format : chiffres seuls, indicatif pays compris, sans `+` ni `00`. La comparaison est
normalisée (`normalizeNumber`) : `+237 621 631 200`, `00237621631200` et `237621631200`
désignent le même numéro. Un numéro saisi **sans** indicatif pays est aussi bloqué s'il
correspond à la fin d'un numéro protégé (`isWhitelisted`).

Le blocage est appliqué en **3 couches** — dès qu'une cible protégée est détectée, rien n'est
résolu, rien n'est écrit en base, **aucun payload ne part** :

| Couche | Fichier | Réaction |
|---|---|---|
| 1 | `server.js` → `POST /api/bot/command` (contrôle `target`, `groupLink` **et** `args[]`) | `403 { blocked:true, code:'WHITELISTED' }` |
| 2 | `js/pair.js` → `executeWebCommand()` puis sur le JID **résolu** (lien de groupe inclus) | `BlockedTargetError` |
| 3 | `js/jobs.js` → `startJob()` et chaque fichier de commande, juste avant l'envoi | `{ success:false, blocked:true }` |

Côté WhatsApp, une commande visant un numéro protégé répond
« ⛔ Numéro protégé (liste blanche) — exécution annulée, rien n'a été envoyé. »

Au démarrage le serveur affiche `WHITELIST=n numero(s) protege(s)` et avertit si les numéros
d'exemple n'ont pas encore été remplacés.

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
| `JOB_DURATION_MS` | optionnel | `86400000` (24 h) — durée totale d'un job d'arrière-plan |
| `MAX_ACTIVE_JOBS_PER_USER` | optionnel | `3` — jobs simultanés par compte |
| `AUTO_RESUME_JOBS` | optionnel | `true` — reprendre les jobs après un redémarrage |
| `KEEP_ALIVE_MS` | optionnel | `300000` — auto-ping de `/health` (0 = désactivé) |
| `PUBLIC_URL` | optionnel | URL publique du service ; sinon `RENDER_EXTERNAL_URL` est utilisé |

La **liste blanche** n'est pas une variable d'environnement : c'est le tableau
`WHITELIST_NUMBERS` écrit en dur dans `js/config.js`.

Le schéma est créé automatiquement au premier démarrage :

```
users          (id, username, password_hash, is_admin, status, wa_number unique, created_at)
session        (sid, sess, expire)                    <- sessions web
bot_sessions   (user_id PK, wa_number, creds, keys, connected, last_seen, updated_at)
bot_jobs       (id PK, user_id, command, target, status, started_at, ends_at,
                sent_count, hour_count, hour_start, resumed, last_error)   <- jobs 24h
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

## Banc de test

`.test-harness/` (ignoré par Git) fait tourner le **vrai** `server.js`, le **vrai** `js/pair.js`,
le **vrai** moteur de jobs et les **vraies** commandes, avec Postgres et WhatsApp simulés :

```bash
./.test-harness/build.sh          # copie le projet + installe les bouchons
node .test-harness/run-test.mjs   # 46 assertions
```

Il vérifie notamment : réponse de `/api/bot/command` en < 2 s (mesurée à ~5 ms), envoi réel des
payloads en arrière-plan, blocage liste blanche aux 3 formats + dans `args[]`, anti
double-lancement, quota, arrêt immédiat via le bouton Stop, et **reprise du job après un
`SIGTERM`** (compteurs et temps restant conservés, job annulé non relancé).

## Démarrer en local

```bash
npm install
export DATABASE_URL="postgresql://..."
export SESSION_SECRET="une-chaine-aleatoire"
export ADMIN_USERS="Raizel:Motdepasse"
npm start
```
