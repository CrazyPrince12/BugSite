import fs from "fs-extra";
import path from "path";
import pino from "pino";
import { fileURLToPath } from "url";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
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
  if (!num) return "";
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

  if (!number || number.length < 8) {
    return { success: false, error: "INVALID_NUMBER", message: "Numéro de téléphone invalide." };
  }

  if (pairingLocks.has(number)) {
    return { success: false, error: "PAIRING_IN_PROGRESS", message: "Génération du code déjà en cours pour ce numéro." };
  }

  const existingBot = bots.get(number);
  if (existingBot?.connected) {
    return { success: true, alreadyConnected: true, connected: true, message: "Bot déjà connecté." };
  }

  if (ACTIVE_BOTS >= MAX_BOTS) {
    return { success: false, error: "BOT_LIMIT_REACHED", message: "Limite maximale de bots atteinte." };
  }

  pairingLocks.add(number);
  retryCount.set(number, retryCount.get(number) || 0);

  const SESSION_DIR = path.join(SESSIONS_DIR, number);
  await fs.ensureDir(SESSION_DIR);

  // Si une session précédente non terminée existe, nettoyer pour éviter les conflits de clés
  try {
    const credsPath = path.join(SESSION_DIR, "creds.json");
    if (await fs.pathExists(credsPath)) {
      const creds = await fs.readJson(credsPath);
      if (!creds?.registered) {
        await fs.remove(SESSION_DIR);
        await fs.ensureDir(SESSION_DIR);
      }
    }
  } catch {
    // Continuer si erreur lecture
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  
  // Obtenir la version WhatsApp Web la plus récente avec fallback
  let version = [2, 3000, 1043857760];
  try {
    const waVer = await fetchLatestWaWebVersion().catch(() => null);
    if (waVer?.version) {
      version = waVer.version;
    } else {
      const bVer = await fetchLatestBaileysVersion().catch(() => null);
      if (bVer?.version) version = bVer.version;
    }
  } catch {}

  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
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
    try {
      // Attendre que la socket soit prête pour envoyer la requête de pairing
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 8000);

        if (sock.ws?.isOpen) {
          clearTimeout(timeout);
          return resolve();
        }

        const onUpdate = ({ qr, connection }) => {
          if (qr || connection === "connecting" || connection === "open" || sock.ws?.isOpen) {
            clearTimeout(timeout);
            sock.ev.off("connection.update", onUpdate);
            resolve();
          }
        };

        sock.ev.on("connection.update", onUpdate);
      });

      // Laisser le temps à la négociation Noise de s'établir
      await delay(2000);

      // Générer le code standard Crockford Base32 conforme WhatsApp (déclenche la push notification sur le téléphone)
      const raw = await sock.requestPairingCode(number);
      pairingCode = raw?.match(/.{1,4}/g)?.join("-") || raw;
      console.log(`  [KNUT] 🔑 Code de pairing généré pour ${number}: ${pairingCode}`);
      eventCallback?.("pairing", { number, code: pairingCode });
    } catch (err) {
      console.error(`  [KNUT] ❌ Erreur pairing code pour ${number}:`, err?.message || err);
      pairingLocks.delete(number);
      try { sock.end(); } catch {}
      bots.delete(number);
      return { 
        success: false, 
        error: "PAIRING_CODE_FAILED", 
        message: `Erreur lors de la génération du code: ${err?.message || "Impossible de contacter WhatsApp"}` 
      };
    }
  }

  // =======================
  // TIMEOUT DE PAIRING
  // =======================
  const autoClose = setTimeout(() => {
    if (!bots.get(number)?.connected) {
      try { sock.end(); } catch {}
      bots.delete(number);
      pairingLocks.delete(number);
      console.log(`  [KNUT] ⏱️ Timeout ${number}`);
      eventCallback?.("timeout", { number });
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
        console.log(`  [KNUT] ✅ ${number} connecté avec succès`);
        eventCallback?.("ready", {
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
        console.log(`  [KNUT] ❌ ${number} déconnecté définitivement`);
        eventCallback?.("disconnected", { number, permanent: true });
      } else {
        retryCount.set(number, retries + 1);
        console.log(`  [KNUT] 🔁 Reconnexion ${number} (${retries + 1}/${MAX_RETRIES})`);
        eventCallback?.("reconnecting", { number, attempt: retries + 1 });
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
    const msg = messages?.[0];
    if (!msg?.message) return;
    if (msg.key?.fromMe) return;

    const remoteJid   = msg.key.remoteJid;
    const participant = msg.key.participant || remoteJid;
    const isGroup     = remoteJid?.endsWith("@g.us");
    const sender      = msg.key.participantAlt || participant;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption || "";

    if (!text) return;

    const bot = bots.get(number);
    if (!bot) return;

    // Vérifier si c'est une commande (préfixe ".")
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
        sender: sender || participant,
        isGroup,
        groupId: isGroup ? remoteJid : null,
        targetJid: !isGroup ? remoteJid : null,
        userId: krinyxUserId,
        msg,
        reply: (t) => sock.sendMessage(remoteJid, { text: t }, { quoted: msg }),
        replyMention: (t, m) => sock.sendMessage(remoteJid, { text: t, mentions: m }, { quoted: msg }),
        args
      };

      const result = await cmd.execute(context, args);

      if (result?.reply) {
        await sock.sendMessage(remoteJid, { text: result.reply }, { quoted: msg });
      }

      eventCallback?.("command", { number, command: commandName, from: remoteJid });

    } catch (err) {
      console.error(`  [CMD] Erreur ${commandName}:`, err?.message || err);
      await sock.sendMessage(remoteJid, { text: "[X] Erreur commande" }, { quoted: msg });
    }
  });

  return {
    success: true,
    code: pairingCode,
    connected: false,
    message: pairingCode ? "Code généré avec succès" : "Déjà enregistré"
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
    console.log(`  [KNUT] 🛑 ${number} arrêté`);
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

  if (!bot?.connected) throw new Error("Bot non connecté");

  try {
    const groups = await bot.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants.length,
      owner: g.owner
    }));
  } catch (error) {
    throw new Error("Impossible de récupérer les groupes");
  }
}

// =======================
// EXECUTER UNE COMMANDE DEPUIS LE WEB
// =======================
async function executeWebCommand(number, command, targetOrGroup, args = []) {
  number = formatNumber(number);
  const bot = bots.get(number);

  if (!bot?.connected) throw new Error("Bot non connecté");

  const cmd = bot.commands.get(command.toLowerCase());
  if (!cmd) throw new Error(`Commande "${command}" introuvable`);

  let from, isGroup;

  if (targetOrGroup.includes("@g.us")) {
    from = targetOrGroup;
    isGroup = true;
    try { await bot.sock.groupMetadata(from); }
    catch { throw new Error("Groupe introuvable"); }
  } else if (targetOrGroup.includes("@s.whatsapp.net") || targetOrGroup.includes("@lid")) {
    from = targetOrGroup;
    isGroup = false;
  } else if (targetOrGroup.includes("chat.whatsapp.com")) {
    try {
      const code = targetOrGroup.split("/").pop().split("?")[0];
      const info = await bot.sock.groupGetInviteInfo(code);
      from = info.id;
      isGroup = true;
      try { await bot.sock.groupMetadata(from); }
      catch { await bot.sock.groupAcceptInvite(code); await delay(2000); }
    } catch { throw new Error("Lien de groupe invalide"); }
  } else {
    const cleanNum = formatNumber(targetOrGroup);
    from = `${cleanNum}@s.whatsapp.net`;
    isGroup = false;
  }

  const context = {
    sock: bot.sock,
    from,
    sender: bot.sock.user?.id || from,
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
