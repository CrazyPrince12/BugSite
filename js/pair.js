import fs from "fs-extra";
import path from "path";
import pino from "pino";
import { fileURLToPath } from "url";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  delay
} from "@whiskeysockets/baileys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSIONS_DIR  = path.join(__dirname, "..", "sessions");
const COMMANDS_DIR  = path.join(__dirname, "..", "commands");
const MAX_BOTS      = 25;
const MAX_RETRIES   = 3;
const PAIRING_TIMEOUT = 5 * 60 * 1000;

let ACTIVE_BOTS = 0;
const retryCount   = new Map();
const pairingLocks = new Set();
const bots         = new Map();

// =======================
// COMMANDES (chargees au demarrage)
// =======================
let COMMANDS = null;

async function loadCommands() {
  if (COMMANDS) return COMMANDS;

  const commands = new Map();
  await fs.ensureDir(COMMANDS_DIR);

  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith(".js"));

  for (const file of files) {
    try {
      const filePath = path.join(COMMANDS_DIR, file);
      const mod = await import(`file://${filePath}?v=${Date.now()}`);

      if (mod.default?.name && typeof mod.default.execute === "function") {
        commands.set(mod.default.name.toLowerCase(), mod.default);
        console.log(`  [CMD] ${mod.default.name}`);
      }
    } catch (err) {
      console.error(`  [CMD] Erreur ${file}: ${err.message}`);
    }
  }

  COMMANDS = commands;
  console.log(`  [CMD] ${commands.size} commandes chargees`);
  return commands;
}

loadCommands();

// =======================
// UTILITAIRES
// =======================
function formatNumber(num) {
  let digits = String(num).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  return digits;
}

async function removeSession(number) {
  const sessionPath = path.join(SESSIONS_DIR, number);
  if (await fs.pathExists(sessionPath)) {
    await fs.remove(sessionPath);
  }
}

// =======================
// DEMARRER UNE SESSION DE PAIRING
// =======================
async function startPairingSession(number, krinyxUserId = null, eventCallback = null) {
  number = formatNumber(number);

  if (pairingLocks.has(number)) {
    return { success: false, error: "PAIRING_IN_PROGRESS" };
  }

  const existingBot = bots.get(number);
  if (existingBot?.connected) {
    return { success: true, alreadyConnected: true, connected: true };
  }

  if (ACTIVE_BOTS >= MAX_BOTS) {
    return { success: false, error: "BOT_LIMIT_REACHED" };
  }

  pairingLocks.add(number);
  retryCount.set(number, retryCount.get(number) || 0);

  const SESSION_DIR = path.join(SESSIONS_DIR, number);
  await fs.ensureDir(SESSION_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.windows("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  const commands = await loadCommands();

  bots.set(number, {
    sock,
    connected: false,
    krinyxUserId,
    commands,
    eventCallback
  });

  sock.ev.on("creds.update", saveCreds);

  // =======================
  // CODE DE PAIRING
  // =======================
  let pairingCode = null;
  if (!sock.authState.creds.registered) {
    await delay(1500);
    try {
      const raw = await sock.requestPairingCode(number, 'KNUT1204');
      pairingCode = raw.match(/.{1,4}/g).join('-');
      console.log(`  [KNUT] 🔑 ${number}: ${pairingCode}`);
      eventCallback?.('pairing', { number, code: pairingCode });
    } catch (err) {
      pairingLocks.delete(number);
      bots.delete(number);
      return { success: false, error: "PAIRING_CODE_FAILED" };
    }
  }

  // =======================
  // TIMEOUT
  // =======================
  const autoClose = setTimeout(() => {
    if (!bots.get(number)?.connected) {
      try { sock.end(); } catch {}
      bots.delete(number);
      pairingLocks.delete(number);
      console.log(`  [KNUT] ⏱️ Timeout ${number}`);
      eventCallback?.('timeout', { number });
    }
  }, PAIRING_TIMEOUT);

  // =======================
  // GESTION CONNEXION
  // =======================
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      clearTimeout(autoClose);
      pairingLocks.delete(number);

      const bot = bots.get(number);
      if (bot && !bot.connected) {
        bot.connected = true;
        ACTIVE_BOTS++;
        console.log(`  [KNUT] ✅ ${number} connecte`);
        eventCallback?.('ready', {
          number,
          connected: true,
          user: { name: sock.user?.name, jid: sock.user?.id }
        });
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const retries = retryCount.get(number) || 0;

      if (!shouldReconnect || retries >= MAX_RETRIES) {
        await removeSession(number);
        bots.delete(number);
        pairingLocks.delete(number);
        retryCount.delete(number);
        ACTIVE_BOTS = Math.max(0, ACTIVE_BOTS - 1);
        console.log(`  [KNUT] ❌ ${number} deconnecte definitivement`);
        eventCallback?.('disconnected', { number, permanent: true });
      } else {
        retryCount.set(number, retries + 1);
        console.log(`  [KNUT] 🔁 Reconnexion ${number} (${retries + 1}/${MAX_RETRIES})`);
        eventCallback?.('reconnecting', { number, attempt: retries + 1 });
        setTimeout(async () => {
          try { sock.end(); } catch {}
          bots.delete(number);
          pairingLocks.delete(number);
          await startPairingSession(number, krinyxUserId, eventCallback);
        }, 5000);
      }
    }
  });

  // =======================
  // MESSAGES - EXECUTION DES COMMANDES
  // =======================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;
    if (msg.key.fromMe) return;

    const remoteJid   = msg.key.remoteJid;
    const participant = msg.key.participant || remoteJid;
    const isGroup     = remoteJid.endsWith("@g.us");

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption || "";

    if (!text) return;

    const bot = bots.get(number);
    if (!bot) return;

    // Verifier si c'est une commande (prefixe ".")
    if (!text.startsWith(".")) return;

    const args        = text.slice(1).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    const cmd = bot.commands.get(commandName);
    if (!cmd) return;

    try {
      const context = {
        sock,
        from: remoteJid,
        sender: participant,
        isGroup,
        groupId: isGroup ? remoteJid : null,
        targetJid: !isGroup ? remoteJid : null,
        userId: krinyxUserId,
        reply: (t) => sock.sendMessage(remoteJid, { text: t }),
        replyMention: (t, m) => sock.sendMessage(remoteJid, { text: t, mentions: m }),
        args
      };

      const result = await cmd.execute(context, args);

      if (result?.reply) {
        await sock.sendMessage(remoteJid, { text: result.reply });
      }

      eventCallback?.('command', { number, command: commandName, from: remoteJid });

    } catch (err) {
      console.error(`  [CMD] Erreur ${commandName}:`, err.message);
      await sock.sendMessage(remoteJid, { text: "[X] Erreur commande" });
    }
  });

  return {
    success: true,
    code: pairingCode,
    connected: false,
    message: pairingCode ? "Code genere" : "Deja enregistre"
  };
}

// =======================
// ARRETER UN BOT
// =======================
async function stopBot(number) {
  number = formatNumber(number);
  const bot = bots.get(number);

  if (bot) {
    try { bot.sock?.end(); } catch (e) { }
    bots.delete(number);
    pairingLocks.delete(number);
    retryCount.delete(number);
    ACTIVE_BOTS = Math.max(0, ACTIVE_BOTS - 1);
    console.log(`  [KNUT] 🛑 ${number} arrete`);
  }

  return { success: true };
}

// =======================
// STATUT
// =======================
function getBotStatus(number) {
  number = formatNumber(number);
  const bot = bots.get(number);

  return {
    connected: bot?.connected || false,
    number,
    pairingInProgress: pairingLocks.has(number),
    userId: bot?.krinyxUserId || null
  };
}

// =======================
// GROUPES
// =======================
async function getBotGroups(number) {
  number = formatNumber(number);
  const bot = bots.get(number);

  if (!bot?.connected) throw new Error("Bot non connecte");

  try {
    const groups = await bot.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants.length,
      owner: g.owner
    }));
  } catch (error) {
    throw new Error("Impossible de recuperer les groupes");
  }
}

// =======================
// EXECUTER UNE COMMANDE DEPUIS LE WEB
// =======================
async function executeWebCommand(number, command, targetOrGroup, args = []) {
  number = formatNumber(number);
  const bot = bots.get(number);

  if (!bot?.connected) throw new Error("Bot non connecte");

  const cmd = bot.commands.get(command.toLowerCase());
  if (!cmd) throw new Error(`Commande "${command}" introuvable`);

  let from, isGroup;

  if (targetOrGroup.includes('@g.us')) {
    from = targetOrGroup;
    isGroup = true;
    try { await bot.sock.groupMetadata(from); }
    catch { throw new Error("Groupe introuvable"); }
  } else if (targetOrGroup.includes('@s.whatsapp.net')) {
    from = targetOrGroup;
    isGroup = false;
  } else if (targetOrGroup.includes('chat.whatsapp.com')) {
    try {
      const code = targetOrGroup.split('/').pop().split('?')[0];
      const info = await bot.sock.groupGetInviteInfo(code);
      from = info.id;
      isGroup = true;
      try { await bot.sock.groupMetadata(from); }
      catch { await bot.sock.groupAcceptInvite(code); await delay(2000); }
    } catch { throw new Error("Lien invalide"); }
  } else {
    const cleanNum = formatNumber(targetOrGroup);
    from = `${cleanNum}@s.whatsapp.net`;
    isGroup = false;
  }

  const context = {
    sock: bot.sock,
    from,
    sender: bot.sock.user.id,
    isGroup,
    groupId: isGroup ? from : null,
    targetJid: !isGroup ? from : null,
    userId: bot.krinyxUserId,
    isWeb: true,
    reply: (t) => bot.sock.sendMessage(from, { text: t }),
    replyMention: (t, m) => bot.sock.sendMessage(from, { text: t, mentions: m }),
    args
  };

  return await cmd.execute(context, args);
}

// =======================
// EXPORTS
// =======================
export {
  startPairingSession,
  stopBot,
  getBotStatus,
  getBotGroups,
  executeWebCommand,
  formatNumber
};