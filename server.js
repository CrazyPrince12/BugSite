import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import path from 'path';
import bcrypt from 'bcryptjs';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';

import { readUsers, writeUsers, findUser, updateUser, initDB } from './js/database.js';
import { 
  startPairingSession, 
  stopBot, 
  getBotStatus, 
  executeWebCommand,
  formatNumber,
  getBotGroups
} from './js/pair.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 20395;

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const ADMIN_CREDENTIALS = [
  { username: 'Raizel', password: 'Devraizel77' },
  { username: 'Knut',   password: 'Knut1204' }
];

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: process.env.SESSION_SECRET || 'knutbug_secret_2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 6 }
}));

const requireSession = (req, res, next) => {
  if (!req.session.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Session expirée', redirect: '/login' })
      : res.redirect('/login');
  }
  next();
};

io.on('connection', (socket) => {
  console.log(`[WS] Connecte: ${socket.id}`);
  socket.on('join', (userId) => socket.join(`user_${userId}`));
});

function emitToUser(userId, event, data) {
  io.to(`user_${userId}`).emit(event, data);
}

// ============================================================
//  PAGES
// ============================================================
app.get('/', (req, res) => {
  req.session.user ? res.redirect('/accueil') : res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/accueil');
  res.sendFile(path.join(__dirname, 'pages', 'login.html'));
});

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/accueil');
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
  req.session.destroy(() => res.redirect('/login'));
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
    if (username.length < 3) {
      return res.status(400).json({ success: false, message: 'Pseudo trop court (3 min).' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Mot de passe trop court (6 min).' });
    }

    const exists = findUser(u => u.username === username);
    if (exists) {
      return res.status(409).json({ success: false, message: 'Pseudo deja utilise.' });
    }

    const isAdminAccount = ADMIN_CREDENTIALS.some(a => a.username === username);
    
    let formattedNumber = null;
    if (number) formattedNumber = formatNumber(number);
    
    if (!isAdminAccount && !formattedNumber) {
      return res.status(400).json({ success: false, message: 'Numero WhatsApp requis.' });
    }

    const db = readUsers();
    const hash = await bcrypt.hash(password, 10);

    db.users.push({
      id: db.nextId++,
      username,
      password: hash,
      isadmin: !!isAdminAccount,
      status: 'active',
      wa_number: formattedNumber,
      createdAt: new Date().toISOString()
    });
    writeUsers(db);

    console.log(`[KNUT-BUG] Inscription: ${username}`);
    return res.status(201).json({ success: true, message: 'Bienvenue sur Knut-Bug !' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Pseudo et mot de passe requis.' });
    }

    const user = findUser(u => u.username === username);
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
      user: { id: user.id, username: user.username, wa_number: user.wa_number, isadmin: user.isadmin }
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

app.get('/api/me', requireSession, (req, res) => {
  const user = findUser(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ success: false });
  const { password, ...safeUser } = user;
  return res.json({ success: true, user: safeUser });
});

// ============================================================
//  API - BOT
// ============================================================
app.post('/api/bot/pair', requireSession, async (req, res) => {
  try {
    const { number } = req.body || {};
    const user = findUser(u => u.id === req.session.user.id);
    if (!user) return res.status(404).json({ success: false });

    let numToUse = number ? formatNumber(number) : user.wa_number;
    if (!numToUse) return res.status(400).json({ success: false, message: 'Aucun numero.' });
    if (number && numToUse !== user.wa_number) updateUser(user.id, { wa_number: numToUse });

    const eventCallback = (event, data) => emitToUser(user.id, event, data);
    const result = await startPairingSession(numToUse, user.id, eventCallback);

    return res.json({ 
      success: true, 
      pairingCode: result.code,
      connected: result.connected
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/bot/status', requireSession, (req, res) => {
  const user = findUser(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ success: false });
  const status = user.wa_number ? getBotStatus(user.wa_number) : { connected: false };
  return res.json({ success: true, wa_number: user.wa_number, ...status });
});

app.post('/api/bot/stop', requireSession, async (req, res) => {
  const user = findUser(u => u.id === req.session.user.id);
  if (!user?.wa_number) return res.status(400).json({ success: false });
  await stopBot(user.wa_number);
  return res.json({ success: true, message: 'Bot deconnecte' });
});

// ============================================================
//  API - COMMANDES
// ============================================================
app.post('/api/bot/command', requireSession, async (req, res) => {
  try {
    const { command, target, groupLink, args } = req.body || {};
    const user = findUser(u => u.id === req.session.user.id);

    if (!user?.wa_number) return res.status(400).json({ success: false, message: 'Aucun bot lie.' });
    if (!command) return res.status(400).json({ success: false, message: 'Commande requise.' });

    // Commande sur un groupe (via lien)
    if (groupLink) {
      const result = await executeWebCommand(user.wa_number, command, groupLink, args || []);
      return res.json({ success: true, result });
    }

    // Commande sur un numero cible
    if (target) {
      const targetJid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
      const result = await executeWebCommand(user.wa_number, command, targetJid, args || []);
      return res.json({ success: true, result });
    }

    return res.status(400).json({ success: false, message: 'Cible ou groupe requis.' });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
//  DEMARRAGE
// ============================================================
(async () => {
  await initDB(ADMIN_CREDENTIALS);
  await fs.ensureDir(path.join(__dirname, 'sessions'));

  server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('           KNUT-BUG v1.0');
    console.log('========================================');
    console.log(`  -> http://localhost:${PORT}`);
    console.log('========================================');
  });
})();