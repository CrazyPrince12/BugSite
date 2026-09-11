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

  return warnings;
}

export default CONFIG;
