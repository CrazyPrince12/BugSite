/**
 * ============================================================
 *  KNUT-BUG — SERVEUR
 * ============================================================
 *  - sessions web stockees dans Postgres (avant : RAM => deconnecte a chaque restart)
 *  - sessions WhatsApp stockees dans Postgres (avant : disque ephemere de Render)
 *  - chaque utilisateur n'accede qu'a SON bot
 *  - /health pour UptimeRobot (empeche la mise en veille du plan Free)
 */

import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bodyParser from 'body-parser';
import path from 'path';
import bcrypt from 'bcryptjs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

// Doit etre importe en premier : charge les variables d'environnement
import { CONFIG, checkConfig } from './js/config.js';

import { getPool, closePool } from './js/db.js';
import {
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  initDB,
  isUniqueViolation
} from './js/database.js';
import {
  initBotManager,
  startPairingSession,
  stopBot,
  getBotStatus,
  getBotGroups,
  executeWebCommand,
  formatNumber,
  restoreAllBots,
  flushAllBots,
  setShuttingDown,
  countBots
} from './js/pair.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = CONFIG.PORT;
const server = createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============================================================
//  SESSIONS WEB — dans Postgres
// ============================================================
const PgStore = connectPgSimple(session);

let sessionMiddleware;
try {
  sessionMiddleware = session({
    store: new PgStore({
      pool: getPool(),
      tableName: 'session',
      createTableIfMissing: false, // la table est creee par js/db.js
      pruneSessionInterval: 60 * 15
    }),
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // la duree de vie du cookie se prolonge a chaque visite
    name: 'knutbug.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: CONFIG.IS_PRODUCTION, // Render sert en HTTPS
      maxAge: CONFIG.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
    }
  });
} catch (err) {
  console.error('[KNUT-BUG] Configuration impossible :', err?.message || err);
  for (const warning of checkConfig()) console.error(`  [CONFIG] ${warning}`);
  process.exit(1);
}

app.use(sessionMiddleware);

const requireSession = (req, res, next) => {
  if (!req.session?.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Session expirée', redirect: '/login' })
      : res.redirect('/login');
  }
  next();
};

// ============================================================
//  SOCKET.IO — on ne rejoint QUE la room de son propre compte
// ============================================================
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

io.on('connection', socket => {
  const userId = socket.request?.session?.user?.id;
  if (!userId) return socket.disconnect(true);

  socket.join(`user_${userId}`);
  // Compatibilite avec l'ancien client : meme s'il envoie un autre id,
  // on le remet dans SA room.
  socket.on('join', () => socket.join(`user_${userId}`));

  socket.on('disconnect', () => {
    /* la socket WhatsApp du user reste vivante, c'est tout le principe */
  });
});

function emitToUser(userId, event, data) {
  io.to(`user_${Number(userId)}`).emit(event, data);
}

// ============================================================
//  PAGES
// ============================================================
app.get('/', (req, res) => {
  req.session?.user ? res.redirect('/accueil') : res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/accueil');
  res.sendFile(path.join(__dirname, 'pages', 'login.html'));
});

app.get('/register', (req, res) => {
  if (req.session?.user) return res.redirect('/accueil');
  res.sendFile(path.join(__dirname, 'pages', 'register.html'));
});

app.get('/accueil', requireSession, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'accueil.html'));
});

app.get('/pair', requireSession, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'pair.html'));
});

app.get('/buglist', requireSession, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'buglist.html'));
});

app.get('/bugtarget', requireSession, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'bugtarget.html'));
});

app.get('/buggroup', requireSession, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'buggroup.html'));
});

app.get('/logout', (req, res) => {
  req.session?.destroy(() => res.redirect('/login'));
});

// ============================================================
//  KEEP-ALIVE (UptimeRobot / cron -> empeche Render de dormir)
// ============================================================
app.get(['/health', '/ping'], (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: Math.round(process.uptime()),
    bots: countBots()
  });
});

// ============================================================
//  API - AUTH
// ============================================================
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, number } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Pseudo et mot de passe requis.' });
    }
    if (String(username).length < 3) {
      return res.status(400).json({ success: false, message: 'Pseudo trop court (3 min).' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe trop court (6 min).' });
    }

    if (await getUserByUsername(username)) {
      return res.status(409).json({ success: false, message: 'Pseudo deja utilise.' });
    }

    // Un pseudo reserve aux admins ne peut etre pris qu'avec le mot de passe
    // defini dans la variable d'environnement ADMIN_USERS.
    const adminEntry = CONFIG.ADMIN_USERS.find(
      a => a.username.toLowerCase() === String(username).toLowerCase()
    );
    if (adminEntry && (!adminEntry.password || adminEntry.password !== password)) {
      return res.status(403).json({ success: false, message: 'Pseudo reserve.' });
    }

    let formattedNumber = number ? formatNumber(number) : null;
    if (formattedNumber && formattedNumber.length < 8) formattedNumber = null;

    if (!adminEntry && !formattedNumber) {
      return res.status(400).json({ success: false, message: 'Numero WhatsApp requis.' });
    }

    const user = await createUser({
      username,
      password,
      isAdmin: !!adminEntry,
      waNumber: formattedNumber
    });

    console.log(`[KNUT-BUG] Inscription: ${user.username}`);
    return res.status(201).json({ success: true, message: 'Bienvenue sur Knut-Bug !' });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ success: false, message: 'Pseudo ou numero deja utilise.' });
    }
    console.error('[KNUT-BUG] register:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Pseudo et mot de passe requis.' });
    }

    const user = await getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Pseudo ou mot de passe incorrect.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Compte desactive.' });
    }

    req.session.user = { id: user.id, username: user.username, isAdmin: !!user.isadmin };

    console.log(`[KNUT-BUG] Connexion: ${user.username}`);
    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        wa_number: user.wa_number,
        isadmin: user.isadmin
      }
    });
  } catch (err) {
    console.error('[KNUT-BUG] login:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.get('/api/me', requireSession, async (req, res) => {
  try {
    const user = await getUserById(req.session.user.id);
    if (!user) return res.status(404).json({ success: false });
    const { password, password_hash, ...safeUser } = user;
    return res.json({ success: true, user: safeUser });
  } catch {
    return res.status(500).json({ success: false });
  }
});

// ============================================================
//  API - BOT (toujours scope sur l'utilisateur connecte)
// ============================================================
app.post('/api/bot/pair', requireSession, async (req, res) => {
  try {
    const { number } = req.body || {};
    const userId = req.session.user.id;
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    if (number) {
      const formatted = formatNumber(number);
      if (!formatted || formatted.length < 8) {
        return res.status(400).json({ success: false, message: 'Numéro invalide.' });
      }
      if (formatted !== user.wa_number) {
        try {
          await updateUser(userId, { wa_number: formatted });
        } catch (err) {
          if (isUniqueViolation(err)) {
            return res
              .status(400)
              .json({ success: false, message: 'Ce numéro est déjà lié à un autre compte.' });
          }
          throw err;
        }
      }
    }

    const numToUse = number ? formatNumber(number) : user.wa_number;
    if (!numToUse) {
      return res
        .status(400)
        .json({ success: false, message: 'Numéro WhatsApp requis (ex: 237621631200).' });
    }

    const result = await startPairingSession(userId, numToUse, (event, data) =>
      emitToUser(userId, event, data)
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || result.error || 'Erreur lors de la génération du code.'
      });
    }

    return res.json({
      success: true,
      pairingCode: result.code,
      connected: result.connected,
      restoring: result.restoring,
      message: result.message
    });
  } catch (err) {
    console.error('[KNUT-BUG] pair:', err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || 'Erreur interne' });
  }
});

app.get('/api/bot/status', requireSession, async (req, res) => {
  try {
    return res.json({ success: true, ...(await getBotStatus(req.session.user.id)) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message });
  }
});

app.get('/api/bot/groups', requireSession, async (req, res) => {
  try {
    return res.json({ success: true, groups: await getBotGroups(req.session.user.id) });
  } catch (err) {
    return res.status(400).json({ success: false, message: err?.message });
  }
});

/** Deconnecte SON bot et supprime la session WhatsApp (nouveau code necessaire). */
app.post('/api/bot/stop', requireSession, async (req, res) => {
  try {
    await stopBot(req.session.user.id, { wipe: true });
    return res.json({ success: true, message: 'Bot deconnecte' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message });
  }
});

app.post('/api/bot/command', requireSession, async (req, res) => {
  try {
    const { command, target, groupLink, args } = req.body || {};
    const userId = req.session.user.id;
    const user = await getUserById(userId);

    if (!user?.wa_number) {
      return res.status(400).json({ success: false, message: 'Aucun bot lie.' });
    }
    if (!command) {
      return res.status(400).json({ success: false, message: 'Commande requise.' });
    }

    if (groupLink) {
      const result = await executeWebCommand(userId, command, groupLink, args || []);
      return res.json({ success: true, result });
    }

    if (target) {
      const targetJid = target.includes('@') ? target : `${formatNumber(target)}@s.whatsapp.net`;
      const result = await executeWebCommand(userId, command, targetJid, args || []);
      return res.json({ success: true, result });
    }

    return res.status(400).json({ success: false, message: 'Cible ou groupe requis.' });
  } catch (err) {
    return res.status(400).json({ success: false, message: err?.message });
  }
});

// ============================================================
//  ARRET PROPRE (Render envoie SIGTERM a chaque redeploy)
// ============================================================
let closing = false;

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  setShuttingDown(true);
  console.log(`\n[KNUT-BUG] ${signal} recu, sauvegarde des sessions...`);

  try {
    await flushAllBots();
  } catch {
    /* ignore */
  }

  server.close(() => {
    closePool().finally(() => process.exit(0));
  });

  // Securite : on ne bloque pas le redeploy plus de 10s
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', err =>
  console.error('[KNUT-BUG] Promesse non geree:', err?.message || err)
);

// ============================================================
//  DEMARRAGE
// ============================================================
(async () => {
  console.log('');
  console.log('========================================');
  console.log('           KNUT-BUG v2.0');
  console.log('========================================');

  for (const warning of checkConfig()) console.warn(`  [CONFIG] ${warning}`);

  try {
    await initDB();
    await initBotManager({ emit: emitToUser });
  } catch (err) {
    console.error('[KNUT-BUG] Demarrage impossible:', err?.message || err);
    process.exit(1);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`  -> http://localhost:${PORT}`);
    console.log('========================================');
    console.log(`  MAX_BOTS=${CONFIG.MAX_BOTS} | AUTO_RESTORE=${CONFIG.AUTO_RESTORE_BOTS}`);
    console.log('========================================');

    // Les bots se reconnectent apres l'ecoute du port : /health repond tout de suite
    restoreAllBots().catch(err =>
      console.error('[KNUT-BUG] Restauration:', err?.message || err)
    );
  });
})();
