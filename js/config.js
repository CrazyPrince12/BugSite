/**
 * ============================================================
 *  CONFIGURATION CENTRALISEE — KNUT-BUG
 * ============================================================
 *  AUCUN secret n'est ecrit ici.
 *  Tout vient des variables d'environnement :
 *    - Render  > ton service > "Environment" > Add Environment Variable
 *    - local   > ton shell (export DATABASE_URL=...) — pas de fichier .env versionne
 *
 *  Variables attendues :
 *    DATABASE_URL        (obligatoire) URL Postgres/Neon, ex:
 *                        postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
 *    SESSION_SECRET      (fortement conseille) chaine aleatoire longue
 *                        -> sans elle, un secret temporaire est genere au demarrage
 *                           et tout le monde est deconnecte du site a chaque redeploy
 *    ADMIN_USERS         (conseille) "Pseudo:Motdepasse,Pseudo2:Motdepasse2"
 *    ADMIN_USERNAMES     (optionnel) "Pseudo1,Pseudo2" -> donne les droits admin
 *                        a des comptes deja existants, sans definir leur mot de passe
 *    MAX_BOTS            (optionnel, defaut 5) nombre max de sockets WhatsApp simultanees
 *    SESSION_TTL_DAYS    (optionnel, defaut 30) duree de vie du cookie de connexion au site
 *    SAVE_DEBOUNCE_MS    (optionnel, defaut 2000) delai avant ecriture des cles WhatsApp en base
 *    RESTORE_DELAY_MS    (optionnel, defaut 3000) delai entre deux reconnexions au demarrage
 *    AUTO_RESTORE_BOTS   (optionnel, defaut true) reconnecter les bots au demarrage
 *    PAIRING_TIMEOUT_MS  (optionnel, defaut 300000) duree de validite d'une demande de code
 *    PGSSL_REJECT_UNAUTHORIZED (optionnel, defaut false) verifier le certificat TLS de Postgres
 *    JOB_DURATION_MS     (optionnel, defaut 86400000) duree totale d'un job d'arriere-plan (24h)
 *    MAX_ACTIVE_JOBS_PER_USER (optionnel, defaut 3) jobs simultanes par compte
 *    AUTO_RESUME_JOBS    (optionnel, defaut true) reprendre les jobs apres un redemarrage
 *    KEEP_ALIVE_MS       (optionnel, defaut 300000) auto-ping de /health (0 = desactive)
 *    PUBLIC_URL          (optionnel) URL publique ; sinon RENDER_EXTERNAL_URL est utilise
 *
 *  La LISTE BLANCHE (numeros proteges) n'est PAS une variable d'environnement :
 *  c'est un tableau ecrit en dur dans ce fichier, voir WHITELIST_NUMBERS plus bas.
 */

import { randomBytes } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const toInt = (value, def) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : def;
};

const toBool = (value, def = false) => {
  if (value === undefined || value === null || value === '') return def;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const splitList = value =>
  String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

/** "Pseudo:Motdepasse,Pseudo2:Motdepasse2" -> [{ username, password }, ...] */
function parseAdminUsers(raw) {
  return splitList(raw)
    .map(entry => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { username: entry, password: null };
      return {
        username: entry.slice(0, idx).trim(),
        password: entry.slice(idx + 1).trim() || null
      };
    })
    .filter(a => a.username);
}

// ============================================================
//  LISTE BLANCHE — NUMEROS PROTEGES
// ============================================================
//  Les numeros listes ici ne peuvent JAMAIS etre pris pour cible.
//  Des qu'ils sont detectes (page web, API, commande WhatsApp),
//  l'execution s'arrete IMMEDIATEMENT : aucun payload n'est envoye.
//
//  FORMAT : chiffres seuls, indicatif pays compris, SANS "+" ni "00".
//    Cameroun -> 237621631200
//    France   -> 33612345678
//
//  La comparaison est normalisee : espaces, tirets, parentheses, "+"
//  et zeros de tete sont ignores. Donc "+237 621 631 200",
//  "00237621631200" et "237621631200" designent le meme numero.
//  Un numero saisi SANS indicatif pays ("621631200") est egalement
//  bloque s'il correspond a la fin d'un numero protege.
//
//  >>> REMPLACE LES EXEMPLES CI-DESSOUS PAR TES VRAIS NUMEROS <<<
const WHITELIST_NUMBERS = [
  '237600000000', // EXEMPLE — ton propre numero
  '237611111111', // EXEMPLE — numero d'un proche
  '33600000000' //   EXEMPLE — a remplacer ou supprimer
];

/** "+237 621-631 200" -> "237621631200" (chiffres seuls, zeros de tete retires) */
export function normalizeNumber(value) {
  if (value === null || value === undefined) return '';
  let digits = String(value).split('@')[0].replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  return digits;
}

const WHITELIST_SET = new Set(
  WHITELIST_NUMBERS.map(normalizeNumber).filter(n => n.length >= 6)
);

/**
 * true si le numero (ou le JID) est protege par la liste blanche.
 * Accepte "237621631200", "+237 621 631 200", "237621631200@s.whatsapp.net",
 * "237621631200@lid", etc.
 */
export function isWhitelisted(value) {
  if (!value || WHITELIST_SET.size === 0) return false;

  const digits = normalizeNumber(value);
  if (!digits || digits.length < 6) return false;

  if (WHITELIST_SET.has(digits)) return true;

  // Cible saisie sans indicatif pays : on bloque quand meme par securite.
  for (const protectedNumber of WHITELIST_SET) {
    if (protectedNumber.endsWith(digits) || digits.endsWith(protectedNumber)) return true;
  }
  return false;
}

/** Renvoie le premier element de la liste qui correspond (pour les logs / messages). */
export function findWhitelistMatch(value) {
  if (!isWhitelisted(value)) return null;
  const digits = normalizeNumber(value);
  for (const protectedNumber of WHITELIST_SET) {
    if (protectedNumber === digits || protectedNumber.endsWith(digits) || digits.endsWith(protectedNumber)) {
      return protectedNumber;
    }
  }
  return digits;
}

export const WHITELIST_BLOCKED_MESSAGE =
  '⛔ Numéro protégé (liste blanche) — exécution annulée, rien n’a été envoyé.';

let temporarySecret = null;

export const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: toInt(process.env.PORT, 20395),

  DATABASE_URL: process.env.DATABASE_URL || '',

  // Pas de secret en dur : sans variable d'environnement on genere un secret
  // temporaire (sessions perdues a chaque redemarrage) plutot qu'un secret public.
  get SESSION_SECRET() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    if (!temporarySecret) temporarySecret = randomBytes(48).toString('hex');
    return temporarySecret;
  },

  SESSION_TTL_DAYS: toInt(process.env.SESSION_TTL_DAYS, 30),

  ADMIN_USERS: parseAdminUsers(process.env.ADMIN_USERS),
  ADMIN_USERNAMES: splitList(process.env.ADMIN_USERNAMES),

  MAX_BOTS: toInt(process.env.MAX_BOTS, 5),
  SAVE_DEBOUNCE_MS: toInt(process.env.SAVE_DEBOUNCE_MS, 2000),
  RESTORE_DELAY_MS: toInt(process.env.RESTORE_DELAY_MS, 3000),
  PAIRING_TIMEOUT_MS: toInt(process.env.PAIRING_TIMEOUT_MS, 5 * 60 * 1000),

  AUTO_RESTORE_BOTS: toBool(process.env.AUTO_RESTORE_BOTS, true),

  // ------------------------------------------------------------
  //  LISTE BLANCHE (numeros proteges) — voir le tableau en haut du fichier
  // ------------------------------------------------------------
  WHITELIST_NUMBERS: [...WHITELIST_SET],

  // ------------------------------------------------------------
  //  JOBS EN ARRIERE-PLAN (commandes longues de type "24h")
  // ------------------------------------------------------------
  // Duree totale d'un job : 24h par defaut (identique au DURATION des commandes)
  JOB_DURATION_MS: toInt(process.env.JOB_DURATION_MS, 24 * 60 * 60 * 1000),
  // Nombre max de jobs simultanes par utilisateur (evite de saturer la socket)
  MAX_ACTIVE_JOBS_PER_USER: toInt(process.env.MAX_ACTIVE_JOBS_PER_USER, 3),
  // Reprise automatique des jobs interrompus par un redemarrage / redeploy
  AUTO_RESUME_JOBS: toBool(process.env.AUTO_RESUME_JOBS, true),
  // Intervalle d'envoi du keep-alive interne (0 = desactive)
  KEEP_ALIVE_MS: toInt(process.env.KEEP_ALIVE_MS, 5 * 60 * 1000),
  // URL publique du service (Render fournit RENDER_EXTERNAL_URL tout seul)
  PUBLIC_URL: String(
    process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
  ).replace(/\/+$/, ''),

  // SSL Postgres : "auto" (desactive en local, active ailleurs) | "require" | "disable"
  PGSSL: String(process.env.PGSSL || 'auto').toLowerCase(),
  PGSSL_REJECT_UNAUTHORIZED: toBool(process.env.PGSSL_REJECT_UNAUTHORIZED, false),

  get IS_PRODUCTION() {
    return this.NODE_ENV === 'production';
  }
};

/**
 * Renvoie la liste des problemes de configuration (affiches au demarrage).
 */
export function checkConfig() {
  const warnings = [];

  if (!CONFIG.DATABASE_URL) {
    warnings.push(
      'DATABASE_URL non definie -> la base Postgres est indispensable ' +
        '(sessions web + sessions WhatsApp). Ajoute-la dans Render > Environment.'
    );
  }
  if (!process.env.SESSION_SECRET) {
    warnings.push(
      'SESSION_SECRET non defini -> secret temporaire genere : ' +
        'les utilisateurs seront deconnectes du site a chaque redemarrage.'
    );
  }
  if (!CONFIG.ADMIN_USERS.length && !CONFIG.ADMIN_USERNAMES.length) {
    warnings.push(
      'ADMIN_USERS / ADMIN_USERNAMES non definis -> aucun compte admin ne sera cree. ' +
        'Format : "Raizel:Motdepasse,Knut:Motdepasse"'
    );
  }

  const EXAMPLE_WHITELIST = new Set(['237600000000', '237611111111', '33600000000']);
  const stillExample = CONFIG.WHITELIST_NUMBERS.filter(n => EXAMPLE_WHITELIST.has(n));
  if (stillExample.length) {
    warnings.push(
      `WHITELIST_NUMBERS contient encore ${stillExample.length} numero(s) d'EXEMPLE ` +
        `(${stillExample.join(', ')}) -> remplace-les par tes vrais numeros dans js/config.js.`
    );
  }
  if (!CONFIG.PUBLIC_URL && CONFIG.KEEP_ALIVE_MS > 0) {
    warnings.push(
      'PUBLIC_URL / RENDER_EXTERNAL_URL introuvable -> le keep-alive interne est desactive. ' +
        'Utilise un moniteur UptimeRobot sur /health pour empecher la mise en veille.'
    );
  }

  return warnings;
}

export default CONFIG;
