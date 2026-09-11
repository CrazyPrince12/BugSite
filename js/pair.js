/**
 * ============================================================
 *  GESTIONNAIRE DE BOTS WHATSAPP (un bot par utilisateur)
 * ============================================================
 *
 *  Changements par rapport a l'ancienne version :
 *
 *  1. Les sessions WhatsApp (creds + cles Signal) ne sont plus ecrites dans le
 *     dossier sessions/ (disque EPHEMERE de Render) mais dans la table
 *     Postgres `bot_sessions`. Un redemarrage / redeploy / mise en veille ne
 *     perd plus le jumelage : le bot se reconnecte tout seul au boot.
 *
 *  2. Les bots sont indexes par `user_id` et plus par numero de telephone.
 *     Chaque utilisateur ne peut voir / piloter / arreter QUE son propre bot.
 *
 *  3. Reconnexion robuste : backoff exponentiel, tentatives illimitees, les
 *     identifiants ne sont effaces QUE sur un vrai "loggedOut" (401) ou une
 *     deconnexion demandee par l'utilisateur.
 *
 *  4. Restauration automatique au demarrage (restoreAllBots) : les bots
 *     reouvrent leur socket sans que personne n'ouvre le navigateur.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import pino from 'pino';

import {
  makeWASocket,
  initAuthCreds,
  BufferJSON,
  proto,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  delay
} from '@whiskeysockets/baileys';

import { query } from './db.js';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/** userId -> { userId, number, sock, connected, ... } */
const bots = new Map();
/** utilisateurs en cours de jumelage / connexion (anti double demarrage) */
const locks = new Set();

let emitToUser = () => {};
let commandsPromise = null;
let shuttingDown = false;

const log = (...args) => console.log('  [KNUT]', ...args);
const logError = (...args) => console.error('  [KNUT]', ...args);

// ============================================================
//  SERIALISATION (les cles Signal contiennent des Buffers)
// ============================================================
const serialize = value => JSON.stringify(value ?? null, BufferJSON.replacer);

const deserialize = value => {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value === 'string') return JSON.parse(value, BufferJSON.reviver);
    return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  } catch (err) {
    logError('Deserialisation impossible :', err?.message || err);
    return null;
  }
};

// ============================================================
//  COMMANDES
// ============================================================
async function loadCommands() {
  if (commandsPromise) return commandsPromise;

  commandsPromise = (async () => {
    const commands = new Map();

    await fs.ensureDir(COMMANDS_DIR);
    const files = (await fs.readdir(COMMANDS_DIR)).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const filePath = path.join(COMMANDS_DIR, file);
        const mod = await import(`file://${filePath}?v=${Date.now()}`);
        if (mod.default?.name && typeof mod.default.execute === 'function') {
          commands.set(mod.default.name.toLowerCase(), mod.default);
          console.log(`  [CMD] ${mod.default.name}`);
        }
      } catch (err) {
        logError(`[CMD] Erreur ${file}: ${err.message}`);
      }
    }

    console.log(`  [CMD] ${commands.size} commandes chargees`);
    return commands;
  })();

  return commandsPromise;
}

// ============================================================
//  UTILITAIRES
// ============================================================
export function formatNumber(num) {
  if (!num) return '';
  let digits = String(num).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  return digits;
}

const jidOf = number => `${formatNumber(number)}@s.whatsapp.net`;

// ============================================================
//  ACCES BASE — sessions WhatsApp
// ============================================================
async function dbLoadSession(userId) {
  const { rows } = await query('SELECT * FROM bot_sessions WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function dbUpsertSession(userId, number) {
  await query(
    `INSERT INTO bot_sessions (user_id, wa_number)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       wa_number = EXCLUDED.wa_number,
       -- changement de numero => anciens identifiants invalides, on repart de zero
       creds = CASE WHEN bot_sessions.wa_number = EXCLUDED.wa_number THEN bot_sessions.creds ELSE NULL END,
       keys  = CASE WHEN bot_sessions.wa_number = EXCLUDED.wa_number THEN bot_sessions.keys  ELSE '{}'::jsonb END,
       connected = FALSE,
       updated_at = now()`,
    [userId, number]
  );
}

async function dbSaveSession(userId, number, creds, keys) {
  await query(
    `INSERT INTO bot_sessions (user_id, wa_number, creds, keys)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       wa_number = EXCLUDED.wa_number,
       creds     = EXCLUDED.creds,
       keys      = EXCLUDED.keys,
       updated_at = now()`,
    [userId, number, serialize(creds), serialize(keys)]
  );
}

async function dbSetConnected(userId, connected) {
  await query(
    `UPDATE bot_sessions SET connected = $2, last_seen = CASE WHEN $2 THEN now() ELSE last_seen END, updated_at = now()
     WHERE user_id = $1`,
    [userId, !!connected]
  ).catch(() => {});
}

async function dbDeleteSession(userId) {
  await query('DELETE FROM bot_sessions WHERE user_id = $1', [userId]).catch(() => {});
}

async function dbNumberTakenByOther(number, userId) {
  const { rows } = await query(
    `SELECT u.id, u.username
       FROM users u
      WHERE u.wa_number = $1 AND u.id <> $2
     UNION
     SELECT b.user_id AS id, u2.username
       FROM bot_sessions b
       JOIN users u2 ON u2.id = b.user_id
      WHERE b.wa_number = $1 AND b.user_id <> $2
     LIMIT 1`,
    [number, userId]
  );
  return rows[0] || null;
}

async function dbListRestorable(limit) {
  const { rows } = await query(
    `SELECT user_id, wa_number
       FROM bot_sessions
      WHERE creds IS NOT NULL
        AND COALESCE((creds->>'registered')::boolean, FALSE) = TRUE
      ORDER BY last_seen DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ============================================================
//  AUTH STATE STOCKE DANS POSTGRES
// ============================================================
async function usePostgresAuthState(userId, number) {
  const row = await dbLoadSession(userId);

  const creds = deserialize(row?.creds) || initAuthCreds();
  /** { [type]: { [id]: value } } */
  const keysStore = deserialize(row?.keys) || {};

  let chain = Promise.resolve();
  let timer = null;
  let closed = false;

  const write = () => {
    chain = chain
      .then(() => dbSaveSession(userId, number, creds, keysStore))
      .catch(err => logError(`[SAVE] ${userId}: ${err?.message || err}`));
    return chain;
  };

  const scheduleFlush = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write();
    }, CONFIG.SAVE_DEBOUNCE_MS);
    timer.unref?.();
  };

  const reviveAppStateKey = value => {
    try {
      return proto.Message.AppStateSyncKeyData.fromObject(value);
    } catch {
      return value;
    }
  };

  const state = {
    creds,
    keys: {
      async get(type, ids) {
        const data = {};
        const bucket = keysStore[type] || {};
        for (const id of ids) {
          const value = bucket[id];
          if (value === undefined || value === null) continue;
          data[id] = type === 'app-state-sync-key' ? reviveAppStateKey(value) : value;
        }
        return data;
      },

      async set(data) {
        for (const type of Object.keys(data || {})) {
          const values = data[type];
          if (!values) continue;
          keysStore[type] = keysStore[type] || {};
          for (const id of Object.keys(values)) {
            const value = values[id];
            if (value === null || value === undefined) delete keysStore[type][id];
            else keysStore[type][id] = value;
          }
        }
        scheduleFlush();
      },

      async clear() {
        for (const type of Object.keys(keysStore)) delete keysStore[type];
        scheduleFlush();
      }
    }
  };

  return {
    state,
    saveCreds: () => scheduleFlush(),
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    }
  };
}

// ============================================================
//  VERSION WHATSAPP WEB
// ============================================================
async function resolveVersion() {
  const fallback = [2, 3000, 1043857760];
  try {
    const waVer = await fetchLatestWaWebVersion().catch(() => null);
    if (waVer?.version) return waVer.version;
    const bVer = await fetchLatestBaileysVersion().catch(() => null);
    if (bVer?.version) return bVer.version;
  } catch {
    /* on garde le fallback */
  }
  return fallback;
}

// ============================================================
//  CYCLE DE VIE D'UN BOT
// ============================================================
function clearTimers(bot) {
  if (bot?.reconnectTimer) {
    clearTimeout(bot.reconnectTimer);
    bot.reconnectTimer = null;
  }
  if (bot?.pairingTimer) {
    clearTimeout(bot.pairingTimer);
    bot.pairingTimer = null;
  }
}

/** Coupe la socket, sauvegarde l'etat, retire le bot de la map. */
async function teardownBot(bot, { endSocket = true } = {}) {
  if (!bot) return;
  clearTimers(bot);

  if (bots.get(bot.userId) === bot) bots.delete(bot.userId);
  locks.delete(bot.userId);

  if (endSocket) {
    try {
      bot.sock?.end(undefined);
    } catch {
      /* ignore */
    }
  }

  try {
    await bot.auth?.close?.();
  } catch {
    /* ignore */
  }
}

function scheduleReconnect(bot, statusCode) {
  const fast =
    statusCode === DisconnectReason.restartRequired ||
    statusCode === DisconnectReason.connectionReplaced;

  bot.retry = (bot.retry || 0) + 1;

  const backoff = fast
    ? 3000
    : Math.min(5 * 60 * 1000, 5000 * 2 ** Math.min(bot.retry - 1, 6));
  const wait = backoff + Math.floor(Math.random() * 2000);
  bot.reconnectAt = Date.now() + wait;

  console.log(
    `  [KNUT] Reconnexion ${bot.number} (essai ${bot.retry}, dans ${Math.round(wait / 1000)}s, code ${statusCode || '?'})`
  );
  bot.eventCallback?.('reconnecting', {
    number: bot.number,
    attempt: bot.retry,
    inSeconds: Math.round(wait / 1000)
  });

  bot.reconnectTimer = setTimeout(async () => {
    bot.reconnectTimer = null;
    if (bot.stopped || shuttingDown) return;

    const { userId, number, eventCallback } = bot;

    // L'utilisateur a pu demander la deconnexion pendant l'attente :
    // dans ce cas la ligne a ete supprimee, on annule la reconnexion
    // (et on ne flush pas, sinon on recreerait la session).
    const stillLinked = await dbLoadSession(userId).catch(() => null);
    if (!stillLinked) {
      log(`${number} : session supprimee, reconnexion annulee`);
      return;
    }

    await teardownBot(bot, { endSocket: true });

    try {
      await startPairingSession(userId, number, eventCallback, {
        reconnect: true,
        retry: bot.retry // on conserve le compteur pour que le backoff grandisse
      });
    } catch (err) {
      logError(`Reconnexion ${number} impossible : ${err?.message || err}`);
    }
  }, wait);

  bot.reconnectTimer.unref?.();
}

// ============================================================
//  DEMARRER / RESTAURER UNE SESSION
// ============================================================
export async function startPairingSession(userId, number, eventCallback = null, options = {}) {
  userId = Number(userId);
  number = formatNumber(number);

  if (!userId) return { success: false, error: 'INVALID_USER', message: 'Utilisateur invalide.' };
  if (!number || number.length < 8) {
    return { success: false, error: 'INVALID_NUMBER', message: 'Numéro de téléphone invalide.' };
  }
  if (locks.has(userId)) {
    return {
      success: false,
      error: 'PAIRING_IN_PROGRESS',
      message: 'Une connexion est déjà en cours pour ce compte.'
    };
  }

  const existing = bots.get(userId);
  if (existing?.connected) {
    return { success: true, alreadyConnected: true, connected: true, message: 'Bot déjà connecté.' };
  }
  if (existing) await teardownBot(existing, { endSocket: true });

  const isReconnect = !!options.reconnect;
  if (!isReconnect && bots.size >= CONFIG.MAX_BOTS) {
    return {
      success: false,
      error: 'BOT_LIMIT_REACHED',
      message: `Limite de ${CONFIG.MAX_BOTS} bots simultanés atteinte.`
    };
  }

  // Un numero ne peut appartenir qu'a un seul compte
  const takenBy = await dbNumberTakenByOther(number, userId);
  if (takenBy) {
    return {
      success: false,
      error: 'NUMBER_ALREADY_USED',
      message: 'Ce numéro est déjà lié à un autre compte.'
    };
  }

  locks.add(userId);

  // Tout ce qui suit peut echouer (base, reseau, version WA...) :
  // on libere le verrou quoi qu'il arrive, sinon le compte reste bloque
  // jusqu'au prochain redemarrage.
  let auth;
  let commands;
  let sock;

  try {
    await dbUpsertSession(userId, number);
    auth = await usePostgresAuthState(userId, number);
    commands = await loadCommands();

    const version = await resolveVersion();
    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger)
      },
      logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
  } catch (err) {
    locks.delete(userId);
    logError(`Demarrage ${number} impossible : ${err?.message || err}`);
    return {
      success: false,
      error: 'START_FAILED',
      message: `Impossible de démarrer le bot : ${err?.message || 'erreur inconnue'}`
    };
  }

  const bot = {
    userId,
    number,
    sock,
    auth,
    commands,
    eventCallback,
    connected: false,
    connecting: true,
    retry: Number(options.retry) || 0,
    reconnectAt: 0,
    stopped: false,
    reconnectTimer: null,
    pairingTimer: null,
    startedAt: Date.now()
  };
  bots.set(userId, bot);

  sock.ev.on('creds.update', auth.saveCreds);

  // ---------- CODE DE PAIRING (1ere connexion uniquement) ----------
  let pairingCode = null;
  if (!auth.state.creds.registered) {
    try {
      await waitForSocketReady(sock);

      const raw = await sock.requestPairingCode(number);
      pairingCode = raw?.match(/.{1,4}/g)?.join('-') || raw;
      log(`Code de pairing généré pour ${number} : ${pairingCode}`);
      eventCallback?.('pairing', { number, code: pairingCode });

      // Le code n'est valable que quelques minutes
      bot.pairingTimer = setTimeout(() => {
        if (bots.get(userId)?.connected) return;
        log(`Timeout du code de pairing (${number})`);
        eventCallback?.('timeout', { number });
        const current = bots.get(userId);
        if (current && !current.connected) {
          teardownBot(current, { endSocket: true }).catch(() => {});
        }
      }, CONFIG.PAIRING_TIMEOUT_MS);
      bot.pairingTimer.unref?.();
    } catch (err) {
      logError(`Erreur code de pairing ${number} : ${err?.message || err}`);
      await teardownBot(bot, { endSocket: true });
      return {
        success: false,
        error: 'PAIRING_CODE_FAILED',
        message: `Impossible de générer le code : ${err?.message || 'WhatsApp injoignable'}`
      };
    }
  }

  // ---------- CONNEXION ----------
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    const current = bots.get(userId);
    if (!current || current !== bot) return; // evenement d'une ancienne socket

    if (connection === 'connecting') {
      current.connecting = true;
      return;
    }

    if (connection === 'open') {
      clearTimers(current);
      locks.delete(userId);
      current.connecting = false;
      current.retry = 0;

      const wasConnected = current.connected;
      current.connected = true;
      dbSetConnected(userId, true);

      if (!wasConnected) {
        log(`${number} connecte`);
        current.eventCallback?.('ready', {
          number,
          connected: true,
          user: { name: sock.user?.name, jid: sock.user?.id }
        });
      }
      return;
    }

    if (connection === 'close') {
      clearTimers(current);
      current.connecting = false;
      current.connected = false;
      dbSetConnected(userId, false);

      if (current.stopped || shuttingDown) return;

      const statusCode =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode ??
        lastDisconnect?.error?.output?.payload?.statusCode;

      // 401 = deconnecte depuis le telephone => identifiants morts, il faut un nouveau code
      if (statusCode === DisconnectReason.loggedOut) {
        log(`${number} deconnecte depuis le telephone (loggedOut)`);
        await teardownBot(current, { endSocket: false });
        await dbDeleteSession(userId);
        current.eventCallback?.('disconnected', { number, permanent: true, reason: 'loggedOut' });
        return;
      }

      current.eventCallback?.('disconnected', { number, permanent: false, reason: statusCode });
      scheduleReconnect(current, statusCode);
    }
  });

  // ---------- MESSAGES ----------
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const current = bots.get(userId);
    if (!current || current !== bot) return;

    const msg = messages?.[0];
    if (!msg?.message || msg.key?.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    const participant = msg.key.participant || remoteJid;
    const isGroup = remoteJid?.endsWith('@g.us');
    const sender = msg.key.participantAlt || participant;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    if (!text.startsWith('.')) return;

    const args = text.slice(1).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const cmd = current.commands.get(commandName);
    if (!cmd) return;

    try {
      const context = {
        sock,
        from: remoteJid,
        sender: sender || participant,
        isGroup,
        groupId: isGroup ? remoteJid : null,
        targetJid: !isGroup ? remoteJid : null,
        userId,
        msg,
        reply: t => sock.sendMessage(remoteJid, { text: t }, { quoted: msg }),
        replyMention: (t, m) => sock.sendMessage(remoteJid, { text: t, mentions: m }, { quoted: msg }),
        args
      };

      const result = await cmd.execute(context, args);
      if (result?.reply) {
        await sock.sendMessage(remoteJid, { text: result.reply }, { quoted: msg });
      }
      current.eventCallback?.('command', { number, command: commandName, from: remoteJid });
    } catch (err) {
      logError(`Commande ${commandName}: ${err?.message || err}`);
      try {
        await sock.sendMessage(remoteJid, { text: '[X] Erreur commande' }, { quoted: msg });
      } catch {
        /* ignore */
      }
    }
  });

  return {
    success: true,
    code: pairingCode,
    connected: false,
    restoring: !pairingCode,
    message: pairingCode ? 'Code généré avec succès' : 'Reconnexion en cours...'
  };
}

function waitForSocketReady(sock) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 8000);
    if (sock.ws?.isOpen) {
      clearTimeout(timeout);
      return resolve();
    }
    const onUpdate = ({ qr, connection }) => {
      if (qr || connection === 'connecting' || connection === 'open' || sock.ws?.isOpen) {
        clearTimeout(timeout);
        sock.ev.off('connection.update', onUpdate);
        resolve();
      }
    };
    sock.ev.on('connection.update', onUpdate);
    timeout.unref?.();
  }).then(() => delay(2000));
}

// ============================================================
//  RESTAURATION AU DEMARRAGE
// ============================================================
export async function restoreAllBots() {
  if (!CONFIG.AUTO_RESTORE_BOTS) {
    console.log('  [KNUT] Restauration automatique desactivee (AUTO_RESTORE_BOTS=false)');
    return { restored: 0 };
  }

  try {
    const rows = await dbListRestorable(CONFIG.MAX_BOTS);
    if (!rows.length) {
      console.log('  [KNUT] Aucune session WhatsApp a restaurer');
      return { restored: 0 };
    }

    console.log(`  [KNUT] Restauration de ${rows.length} session(s) WhatsApp...`);

    for (let i = 0; i < rows.length; i++) {
      const { user_id: userId, wa_number: number } = rows[i];
      if (i > 0) await delay(CONFIG.RESTORE_DELAY_MS);
      if (shuttingDown) break;

      startPairingSession(userId, number, (event, data) => emitToUser(userId, event, data), {
        reconnect: false
      }).catch(err => logError(`Restauration ${number}: ${err?.message || err}`));
    }

    return { restored: rows.length };
  } catch (err) {
    logError(`Restauration impossible : ${err?.message || err}`);
    return { restored: 0, error: err?.message };
  }
}

// ============================================================
//  ARRET
// ============================================================
/** Deconnecte le bot et SUPPRIME la session (il faudra un nouveau code). */
export async function stopBot(userId, { wipe = true } = {}) {
  userId = Number(userId);
  const bot = bots.get(userId);
  if (!bot) {
    if (wipe) await dbDeleteSession(userId);
    return { success: true, alreadyStopped: true };
  }

  bot.stopped = true;
  clearTimers(bot);
  bots.delete(userId);
  locks.delete(userId);

  try {
    await bot.sock?.logout?.();
  } catch {
    /* ignore */
  }
  try {
    bot.sock?.end(undefined);
  } catch {
    /* ignore */
  }
  try {
    await bot.auth?.close?.();
  } catch {
    /* ignore */
  }

  if (wipe) await dbDeleteSession(userId);
  log(`${bot.number} arrete`);
  return { success: true, wiped: wipe };
}

/** Sauvegarde tout (appele avant l'arret du serveur). */
export async function flushAllBots() {
  const promises = [];
  for (const bot of bots.values()) {
    promises.push(
      (async () => {
        try {
          await bot.auth?.close?.();
        } catch {
          /* ignore */
        }
      })()
    );
  }
  await Promise.allSettled(promises);
}

export function setShuttingDown(value = true) {
  shuttingDown = value;
}

// ============================================================
//  STATUT (par utilisateur)
// ============================================================
export async function getBotStatus(userId) {
  userId = Number(userId);
  const bot = bots.get(userId);

  if (bot) {
    return {
      connected: !!bot.connected,
      connecting: !!bot.connecting && !bot.connected,
      reconnecting: !!bot.reconnectTimer,
      retryInSeconds: bot.reconnectAt
        ? Math.max(0, Math.round((bot.reconnectAt - Date.now()) / 1000))
        : 0,
      hasSession: true,
      number: bot.number,
      userId,
      attempts: bot.retry || 0,
      since: bot.startedAt
    };
  }

  // Pas de socket en cours : a-t-on deja une session enregistree ?
  try {
    const row = await dbLoadSession(userId);
    if (row) {
      return {
        connected: false,
        connecting: false,
        hasSession: true,
        registered: row.creds?.registered === true,
        number: row.wa_number,
        userId,
        lastSeen: row.last_seen,
        attempts: 0
      };
    }
  } catch {
    /* ignore */
  }

  return {
    connected: false,
    connecting: false,
    reconnecting: false,
    hasSession: false,
    number: null,
    userId,
    attempts: 0
  };
}

export function countBots() {
  return { total: bots.size, connected: [...bots.values()].filter(b => b.connected).length };
}

// ============================================================
//  GROUPES
// ============================================================
export async function getBotGroups(userId) {
  userId = Number(userId);
  const bot = bots.get(userId);
  if (!bot?.connected) throw new Error('Bot non connecté');

  try {
    const groups = await bot.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants.length,
      owner: g.owner
    }));
  } catch {
    throw new Error('Impossible de récupérer les groupes');
  }
}

// ============================================================
//  EXECUTION D'UNE COMMANDE DEPUIS LE WEB
// ============================================================
export async function executeWebCommand(userId, command, targetOrGroup, args = []) {
  userId = Number(userId);
  const bot = bots.get(userId);
  if (!bot?.connected) throw new Error('Bot non connecté');

  const cmd = bot.commands.get(String(command).toLowerCase());
  if (!cmd) throw new Error(`Commande "${command}" introuvable`);

  let from;
  let isGroup;
  const target = String(targetOrGroup || '');

  if (target.includes('@g.us')) {
    from = target;
    isGroup = true;
    try {
      await bot.sock.groupMetadata(from);
    } catch {
      throw new Error('Groupe introuvable');
    }
  } else if (target.includes('@s.whatsapp.net') || target.includes('@lid')) {
    from = target;
    isGroup = false;
  } else if (target.includes('chat.whatsapp.com')) {
    try {
      const code = target.split('/').pop().split('?')[0];
      const info = await bot.sock.groupGetInviteInfo(code);
      from = info.id;
      isGroup = true;
      try {
        await bot.sock.groupMetadata(from);
      } catch {
        await bot.sock.groupAcceptInvite(code);
        await delay(2000);
      }
    } catch {
      throw new Error('Lien de groupe invalide');
    }
  } else {
    from = jidOf(target);
    isGroup = false;
  }

  const context = {
    sock: bot.sock,
    from,
    sender: bot.sock.user?.id || from,
    isGroup,
    groupId: isGroup ? from : null,
    targetJid: !isGroup ? from : null,
    userId,
    isWeb: true,
    reply: t => bot.sock.sendMessage(from, { text: t }),
    replyMention: (t, m) => bot.sock.sendMessage(from, { text: t, mentions: m }),
    args
  };

  return await cmd.execute(context, args);
}

// ============================================================
//  INITIALISATION
// ============================================================
export async function initBotManager({ emit } = {}) {
  if (typeof emit === 'function') emitToUser = emit;
  await loadCommands();
  console.log(`  [KNUT] Gestionnaire pret (max ${CONFIG.MAX_BOTS} bots)`);
}

export { emitToUser };

