/**
 * ============================================================
 *  JOBS EN ARRIERE-PLAN — KNUT-BUG
 * ============================================================
 *  AVANT :
 *    POST /api/bot/command  ->  await executeWebCommand()  ->  await cmd.execute()
 *    Or cmd.execute() contient une boucle `while (Date.now() - START < 24h)`.
 *    La reponse HTTP n'arrivait donc qu'au bout de 24 HEURES :
 *      - le navigateur restait fige sur "Execution en cours... Veuillez patienter"
 *      - le proxy (Render / nginx / Cloudflare) coupait la connexion au bout de
 *        ~30-100s  =>  message rouge "Erreur de connexion au serveur"
 *      - la boucle Node, elle, continuait de tourner sans plus aucun retour.
 *
 *  MAINTENANT :
 *    La commande devient un JOB : il est enregistre en base (table bot_jobs),
 *    lance SANS etre attendu, et l'API repond immediatement (HTTP 202 + jobId).
 *      - l'utilisateur voit tout de suite "✔ lance en arriere-plan"
 *      - il peut fermer l'onglet, quitter le site, eteindre son telephone :
 *        le job tourne dans le process Node, pas dans le navigateur
 *      - la progression est poussee en Socket.IO + persistee en base
 *      - apres un redemarrage / redeploy, resumeAllJobs() reprend la boucle
 *        sur le TEMPS RESTANT (pas 24h reparties de zero)
 *
 *  Ce module n'importe PAS pair.js (injection de dependances via initJobs)
 *  pour eviter tout import circulaire.
 */

import { randomUUID } from 'crypto';

import { CONFIG, isWhitelisted, findWhitelistMatch, WHITELIST_BLOCKED_MESSAGE } from './config.js';
import {
  createJobRow,
  updateJobProgress,
  setJobStatus,
  bumpJobResume,
  getJobRow,
  listJobRows,
  findActiveJobRow,
  countActiveJobs,
  getResumableJobRows,
  expireStaleJobRows
} from './database.js';

/** jobId -> runtime (uniquement les jobs qui tournent dans CE process) */
const running = new Map();

/** Injecte par server.js au demarrage. */
let emitToUser = () => {};
let getBot = () => null; //       (userId) -> { sock, connected, commands, number } | null
let getCommand = async () => null; // (name) -> module de commande | null

let shuttingDown = false;
let initialized = false;

const log = (...args) => console.log('  [JOB]', ...args);
const logError = (...args) => console.error('  [JOB]', ...args);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Erreur renvoyee quand la cible est protegee par la liste blanche. */
export class BlockedTargetError extends Error {
  constructor(message = WHITELIST_BLOCKED_MESSAGE, number = null) {
    super(message);
    this.name = 'BlockedTargetError';
    this.code = 'WHITELISTED';
    this.status = 403;
    this.blocked = true;
    this.number = number;
  }
}

// ============================================================
//  INITIALISATION
// ============================================================
export function initJobs({ emit, getBot: botProvider, getCommand: commandProvider } = {}) {
  if (typeof emit === 'function') emitToUser = emit;
  if (typeof botProvider === 'function') getBot = botProvider;
  if (typeof commandProvider === 'function') getCommand = commandProvider;
  initialized = true;
  log(`Moteur de jobs pret (duree ${Math.round(CONFIG.JOB_DURATION_MS / 3600000)}h, max ${CONFIG.MAX_ACTIVE_JOBS_PER_USER}/utilisateur)`);
}

export function setJobsShuttingDown(value = true) {
  shuttingDown = value;
}

function assertReady() {
  if (!initialized) throw new Error('Moteur de jobs non initialise (initJobs)');
}

function emitJob(userId, event, payload) {
  try {
    emitToUser(Number(userId), event, payload);
  } catch {
    /* Socket.IO ne doit jamais casser un job */
  }
}

// ============================================================
//  VUE PUBLIQUE (ce que le site affiche)
// ============================================================
/** Champs "chauds" d'un job en cours : la RAM est plus a jour que la base. */
function liveRuntime(job) {
  return {
    sentCount: job.sentCount,
    hourCount: job.hourCount,
    hourStart: job.hourStart,
    status: job.status,
    lastError: job.lastError,
    lastStatus: job.lastStatus,
    finishedAt: job.finishedAt,
    resumed: job.resumed
  };
}

export function toPublic(job) {
  const now = Date.now();
  const live = running.get(job.id);
  if (live) {
    // La RAM est plus fraiche que la base : on expose les compteurs en direct.
    job = { ...job, ...liveRuntime(live), fromJid: live.fromJid, durationMs: live.durationMs };
  }
  const startedAt = job.startedAt || now;
  const endsAt = job.endsAt || now;
  const total = Math.max(1, endsAt - startedAt);
  const remainingMs = Math.max(0, endsAt - now);

  return {
    id: job.id,
    command: job.command,
    target: job.target,
    label: job.label || job.target,
    isGroup: !!job.isGroup,
    status: job.status,
    startedAt,
    endsAt,
    durationMs: Math.max(1, endsAt - startedAt),
    finishedAt: job.finishedAt || null,
    sentCount: job.sentCount || 0,
    hourCount: job.hourCount || 0,
    elapsedMs: Math.min(total, now - startedAt),
    remainingMs,
    progress: job.status === 'done' ? 1 : Math.min(0.999, (total - remainingMs) / total),
    resumed: job.resumed || 0,
    lastError: job.lastError || null,
    lastStatus: job.lastStatus || null,
    updatedAt: job.updatedAt || Date.now(),
    live: running.has(job.id)
  };
}

// ============================================================
//  SOMMEIL ANNULABLE
// ============================================================
/**
 * Les commandes dorment 5 minutes entre deux actions. Ce sommeil doit pouvoir
 * etre interrompu INSTANTANEMENT quand l'utilisateur clique sur "Stop"
 * (sinon il attendrait jusqu'a 5 minutes).
 */
function jobSleep(job, ms) {
  return new Promise(resolve => {
    let timer = null;
    const wake = () => {
      if (timer) clearTimeout(timer);
      job.waiters.delete(wake);
      resolve();
    };
    timer = setTimeout(wake, Math.max(0, ms));
    timer.unref?.();
    job.waiters.add(wake);
  });
}

function wakeUp(job) {
  for (const wake of [...job.waiters]) {
    try {
      wake();
    } catch {
      /* ignore */
    }
  }
  job.waiters.clear();
}

// ============================================================
//  SOCKET "VIVANTE"
// ============================================================
/**
 * Un job dure 24h : le bot VA se deconnecter / se reconnecter plusieurs fois
 * (redeploy, reseau, code 440...). Une reference `sock` capturee au lancement
 * deviendrait morte et le job tournerait dans le vide.
 * On passe donc par un getter qui renvoie TOUJOURS la socket courante.
 */
function liveSocket(userId) {
  const bot = getBot(Number(userId));
  return bot?.connected ? bot.sock || null : null;
}

/**
 * Attend que le bot soit (re)connecte. Renvoie la socket, ou null si le job a
 * ete annule / si le serveur s'arrete. Le job ne MEURT JAMAIS parce que le bot
 * est temporairement deconnecte : il patiente, indefiniment, jusqu'a la fin des 24h.
 */
async function waitForSocket(job) {
  let notifiedAt = 0;

  while (!job.cancel && !shuttingDown) {
    const sock = liveSocket(job.userId);
    if (sock) return sock;

    if (Date.now() - notifiedAt > 60_000) {
      notifiedAt = Date.now();
      emitStatus(job, 'Bot déconnecté — le job patiente et reprendra tout seul');
    }
    await jobSleep(job, 15_000);
  }
  return null;
}

// ============================================================
//  PROGRESSION
// ============================================================
function onProgress(job, info = {}) {
  if (typeof info.sent === 'number') job.sentCount = info.sent;
  if (typeof info.hourCount === 'number') job.hourCount = info.hourCount;
  if (typeof info.hourStart === 'number') job.hourStart = info.hourStart;

  const payload = toPublic(job);
  emitJob(job.userId, 'job:progress', payload);

  if (shuttingDown) return;
  updateJobProgress(job.id, {
    sentCount: job.sentCount,
    hourCount: job.hourCount,
    hourStart: job.hourStart
  }).catch(err => logError(`progression ${job.id}: ${err?.message || err}`));
}

const lastStatusAt = new WeakMap();
function emitStatus(job, message) {
  const now = Date.now();
  if ((lastStatusAt.get(job) || 0) + 20_000 > now) return; // anti-spam
  lastStatusAt.set(job, now);
  job.lastStatus = message;
  emitJob(job.userId, 'job:status', { id: job.id, message, ...toPublic(job) });
}

// ============================================================
//  CONTEXTE FOURNI A LA COMMANDE
// ============================================================
function buildContext(job, args) {
  const from = job.fromJid || job.target;

  const context = {
    userId: job.userId,
    from,
    isGroup: !!job.isGroup,
    groupId: job.isGroup ? job.target : null,
    targetJid: job.isGroup ? null : job.target,
    isWeb: true,
    isJob: true,
    msg: null,
    args,

    // --- pilotage du job ---
    jobId: job.id,
    startedAt: job.startedAt,
    deadline: job.endsAt, // <-- echeance ABSOLUE (survit a un redemarrage)
    durationMs: job.durationMs,
    state: {
      sent: job.sentCount,
      hourCount: job.hourCount,
      hourStart: job.hourStart,
      resumed: job.resumed
    },

    reply: text => {
      const sock = liveSocket(job.userId);
      return sock ? sock.sendMessage(from, { text }) : Promise.resolve(null);
    },
    replyMention: (text, mentions) => {
      const sock = liveSocket(job.userId);
      return sock ? sock.sendMessage(from, { text, mentions }) : Promise.resolve(null);
    },

    onProgress: info => onProgress(job, info),
    onStatus: message => emitStatus(job, String(message || '')),
    isCancelled: () => job.cancel || shuttingDown,
    sleep: ms => jobSleep(job, ms),
    waitForSocket: () => waitForSocket(job)
  };

  // `context.sock` est un GETTER : toujours la socket vivante du bot.
  Object.defineProperty(context, 'sock', {
    enumerable: true,
    get: () => liveSocket(job.userId)
  });
  Object.defineProperty(context, 'sender', {
    enumerable: true,
    get: () => liveSocket(job.userId)?.user?.id || from
  });

  return context;
}

// ============================================================
//  EXECUTION
// ============================================================
async function runJob(job, cmd, args) {
  const context = buildContext(job, args);

  emitJob(job.userId, 'job:started', toPublic(job));

  try {
    const result = await cmd.execute(context, args);

    if (job.cancel) return await finalize(job, 'cancelled');
    if (shuttingDown) return job; // sera repris au prochain demarrage

    if (result && result.success === false) {
      return await finalize(job, 'failed', result.message || 'Échec de la commande');
    }
    return await finalize(job, 'done', result?.message || null);
  } catch (err) {
    if (job.cancel) return await finalize(job, 'cancelled');
    if (shuttingDown) return job;

    logError(`${job.command} (${job.id}) : ${err?.message || err}`);
    return await finalize(job, 'failed', err?.message || 'Erreur inconnue');
  }
}

async function finalize(job, status, detail = null) {
  job.status = status;
  job.finishedAt = Date.now();
  if (detail && status !== 'done') job.lastError = detail;

  wakeUp(job);
  running.delete(job.id);

  if (!shuttingDown) {
    try {
      await updateJobProgress(job.id, {
        sentCount: job.sentCount,
        hourCount: job.hourCount,
        hourStart: job.hourStart
      });
      await setJobStatus(job.id, status, { lastError: job.lastError });
    } catch (err) {
      logError(`finalisation ${job.id}: ${err?.message || err}`);
    }
  }

  const event =
    status === 'done'
      ? 'job:done'
      : status === 'cancelled'
        ? 'job:cancelled'
        : status === 'failed'
          ? 'job:error'
          : 'job:progress';

  const payload = { ...toPublic(job), message: detail || undefined };
  emitJob(job.userId, event, payload);

  log(
    `${job.command} -> ${job.target} [${status}] ${job.sentCount} action(s) envoyee(s)` +
      (detail && status !== 'done' ? ` (${detail})` : '')
  );
  return job;
}

// ============================================================
//  API PUBLIQUE
// ============================================================

/** Controle liste blanche commun a toutes les cibles (numero, JID, args). */
export function assertNotWhitelisted(...values) {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      assertNotWhitelisted(...value);
      continue;
    }
    if (isWhitelisted(value)) {
      throw new BlockedTargetError(WHITELIST_BLOCKED_MESSAGE, findWhitelistMatch(value));
    }
  }
}

/**
 * Cree un job, le lance en arriere-plan et RENVOIE IMMEDIATEMENT.
 * C'est le coeur du correctif : plus aucun `await` sur les 24h de boucle.
 */
export async function startJob({
  userId,
  command,
  target,
  from = null,
  label = null,
  isGroup = false,
  args = [],
  durationMs = CONFIG.JOB_DURATION_MS
}) {
  assertReady();
  userId = Number(userId);

  const commandName = String(command || '').toLowerCase();
  if (!commandName) throw new Error('Commande requise.');
  if (!target) throw new Error('Cible requise.');

  // ---- LISTE BLANCHE (couche "moteur de jobs") ----
  // target, args ET from sont controles : aucune porte d'entree ne doit echapper.
  assertNotWhitelisted(target, from, ...args);

  // ---- La commande existe-t-elle ? (reponse immediate, pas dans 24h) ----
  const cmd = await getCommand(commandName);
  if (!cmd) throw new Error(`Commande "${command}" introuvable`);

  // ---- Anti double-lancement : meme commande, meme cible, deja en cours ----
  const existing = await findActiveJobRow(userId, target).catch(() => null);
  if (existing && existing.command === commandName) {
    const live = running.get(existing.id);
    const view = toPublic(live ? { ...existing, ...liveRuntime(live) } : existing);
    return { job: view, alreadyRunning: true };
  }

  // ---- Quota par utilisateur ----
  const activeCount = running.size
    ? [...running.values()].filter(j => j.userId === userId && j.status === 'running').length
    : 0;
  const dbCount = await countActiveJobs(userId).catch(() => 0);
  if (Math.max(activeCount, dbCount) >= CONFIG.MAX_ACTIVE_JOBS_PER_USER) {
    throw new Error(
      `Trop de jobs actifs (max ${CONFIG.MAX_ACTIVE_JOBS_PER_USER}). Arrête un job en cours avant d'en lancer un autre.`
    );
  }

  const startedAt = Date.now();
  const job = {
    id: randomUUID(),
    userId,
    command: commandName,
    target,
    fromJid: from || target,
    label: label || target,
    isGroup: !!isGroup,
    args: Array.isArray(args) ? args : [args],
    status: 'running',
    startedAt,
    endsAt: startedAt + Math.max(60_000, Number(durationMs) || CONFIG.JOB_DURATION_MS),
    durationMs: Math.max(60_000, Number(durationMs) || CONFIG.JOB_DURATION_MS),
    sentCount: 0,
    hourCount: 0,
    hourStart: startedAt,
    resumed: 0,
    lastError: null,
    finishedAt: null,
    cancel: false,
    waiters: new Set(),
    promise: null
  };

  try {
    await createJobRow(job);
  } catch (err) {
    logError(`creation du job impossible: ${err?.message || err}`);
    throw new Error('Job impossible à enregistrer (base de données injoignable)');
  }

  running.set(job.id, job);

  // >>> LANCEMENT SANS `await` : la reponse HTTP part tout de suite <<<
  job.promise = runJob(job, cmd, job.args);
  job.promise.catch(err => logError(`${job.id}: ${err?.message || err}`));

  log(`${job.command} -> ${job.target} lance (${Math.round(job.durationMs / 3600000)}h) id=${job.id}`);
  return { job: toPublic(job), alreadyRunning: false };
}

/** Bouton "Stop" : la boucle sort a sa prochaine iteration (ou tout de suite si elle dort). */
export async function cancelJob(jobId, userId) {
  assertReady();
  const job = running.get(String(jobId));

  if (job) {
    if (Number(job.userId) !== Number(userId)) {
      const err = new Error('Ce job ne t’appartient pas');
      err.status = 403;
      throw err;
    }
    job.cancel = true;
    wakeUp(job); // reveille immediatement le sleep de 5 minutes
    return { success: true, job: toPublic(job), cancelling: true };
  }

  // Job pas dans ce process (autre instance / deja termine) : on regarde la base.
  const row = await getJobRow(String(jobId));
  if (!row) return { success: false, message: 'Job introuvable' };
  if (Number(row.userId) !== Number(userId)) {
    const err = new Error('Ce job ne t’appartient pas');
    err.status = 403;
    throw err;
  }
  if (row.status !== 'running') return { success: true, job: toPublic(row), alreadyFinished: true };

  await setJobStatus(row.id, 'cancelled', { lastError: 'Annulé depuis le site' });
  return { success: true, job: toPublic({ ...row, status: 'cancelled' }) };
}

/** Liste des jobs d'un utilisateur : base + compteurs live (la RAM est plus fraiche). */
export async function getJobsForUser(userId, limit = 15) {
  assertReady();
  const rows = await listJobRows(Number(userId), limit);
  return rows.map(row => {
    const live = running.get(row.id);
    return toPublic(live ? { ...row, ...liveRuntime(live) } : row);
  });
}

export async function getJobView(jobId, userId) {
  assertReady();
  const live = running.get(String(jobId));
  if (live && Number(live.userId) === Number(userId)) return toPublic(live);

  const row = await getJobRow(String(jobId));
  if (!row) return null;
  if (Number(row.userId) !== Number(userId)) return null;
  return toPublic(live ? { ...row, ...liveRuntime(live) } : row);
}

/** Y a-t-il deja un job actif sur cette cible ? (anti double-lancement cote UI) */
export async function getActiveJobForTarget(userId, target) {
  assertReady();
  for (const job of running.values()) {
    if (job.userId === Number(userId) && job.target === target && job.status === 'running') {
      return toPublic(job);
    }
  }
  const row = await findActiveJobRow(Number(userId), target).catch(() => null);
  return row ? toPublic(row) : null;
}

// ============================================================
//  REPRISE APRES UN REDEMARRAGE / REDEPLOY
// ============================================================
/**
 * Appelé au boot, APRES restoreAllBots(). Relance les jobs 'running' dont
 * l'echeance n'est pas passee, sur le TEMPS RESTANT, avec leurs compteurs.
 * C'est ce qui garantit reellement "la commande tourne pendant 24h",
 * meme si le navigateur est ferme ET meme si Render redemarre.
 */
export async function resumeAllJobs() {
  assertReady();

  if (!CONFIG.AUTO_RESUME_JOBS) {
    const expired = await expireStaleJobRows().catch(() => 0);
    log(`Reprise desactivee (AUTO_RESUME_JOBS=false) — ${expired} job(s) marque(s) interrompu(s)`);
    return { resumed: 0 };
  }

  try {
    const expired = await expireStaleJobRows();
    if (expired) log(`${expired} job(s) arrive(s) a terme pendant l'arret -> marques interrompus`);

    const rows = await getResumableJobRows();
    if (!rows.length) {
      log('Aucun job a reprendre');
      return { resumed: 0 };
    }

    let resumed = 0;
    for (const row of rows) {
      if (running.has(row.id)) continue;

      const remainingMs = row.endsAt - Date.now();
      if (remainingMs <= 0) {
        await setJobStatus(row.id, 'interrupted', { lastError: 'Durée écoulée' }).catch(() => {});
        continue;
      }

      const cmd = await getCommand(row.command).catch(() => null);
      if (!cmd) {
        await setJobStatus(row.id, 'failed', {
          lastError: `Commande "${row.command}" introuvable au redémarrage`
        }).catch(() => {});
        continue;
      }

      const job = {
        id: row.id,
        userId: Number(row.userId),
        command: row.command,
        target: row.target,
        fromJid: row.fromJid || row.target,
        label: row.label || row.target,
        isGroup: !!row.isGroup,
        args: row.args || [],
        status: 'running',
        startedAt: row.startedAt,
        endsAt: row.endsAt, // <-- echeance ABSOLUE : on ne repart pas de zero
        durationMs: Math.max(1, row.endsAt - row.startedAt),
        sentCount: row.sentCount || 0,
        hourCount: row.hourCount || 0,
        hourStart: row.hourStart || Date.now(),
        resumed: (row.resumed || 0) + 1,
        lastError: null,
        finishedAt: null,
        cancel: false,
        waiters: new Set(),
        promise: null
      };

      running.set(job.id, job);
      await bumpJobResume(job.id).catch(() => {});

      job.promise = runJob(job, cmd, job.args);
      job.promise.catch(err => logError(`reprise ${job.id}: ${err?.message || err}`));

      resumed++;
      log(
        `reprise ${job.command} -> ${job.target} : ${Math.round(remainingMs / 60000)} min restantes, ` +
          `${job.sentCount} action(s) deja envoyee(s)`
      );
    }

    return { resumed };
  } catch (err) {
    logError(`reprise impossible : ${err?.message || err}`);
    return { resumed: 0, error: err?.message };
  }
}

// ============================================================
//  ARRET PROPRE DU SERVEUR
// ============================================================
/**
 * Sauvegarde les compteurs avant que le process ne meure. Le statut reste
 * 'running' : c'est volontaire, resumeAllJobs() reprendra le job au boot.
 */
export async function flushJobs() {
  const promises = [];
  for (const job of running.values()) {
    promises.push(
      updateJobProgress(job.id, {
        sentCount: job.sentCount,
        hourCount: job.hourCount,
        hourStart: job.hourStart
      }).catch(() => {})
    );
  }
  await Promise.allSettled(promises);
  if (running.size) log(`${running.size} job(s) sauvegarde(s) — reprise au prochain demarrage`);
}

export function countRunningJobs() {
  return running.size;
}

export function listRunningJobIds() {
  return [...running.keys()];
}
