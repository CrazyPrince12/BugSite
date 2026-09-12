/**
 * ============================================================
 *  COUCHE POSTGRES (Neon)
 * ============================================================
 *  - un seul pool partage (Render Free = peu de RAM, Neon Free = peu de connexions)
 *  - reconnexion automatique : Neon "scale to zero" apres quelques minutes
 *    d'inactivite, la premiere requete apres un reveil peut etre refusee
 *  - creation du schema au premier demarrage
 */

import pg from 'pg';
import { CONFIG } from './config.js';

const { Pool } = pg;

let pool = null;

/**
 * Neon ajoute parfois "channel_binding=require" dans l'URL copiee depuis la console.
 * node-postgres ne comprend pas ce parametre : on le retire, on force le SSL a la main.
 */
function cleanConnectionString(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('channel_binding');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Neon exige TLS. En local (PGlite, postgres sans SSL) on le desactive
 * automatiquement pour pouvoir tester.
 */
function resolveSsl(connectionString) {
  if (CONFIG.PGSSL === 'disable') return false;
  if (CONFIG.PGSSL === 'require') {
    return { rejectUnauthorized: CONFIG.PGSSL_REJECT_UNAUTHORIZED };
  }
  const isLocal = /@(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/.test(connectionString);
  return isLocal ? false : { rejectUnauthorized: CONFIG.PGSSL_REJECT_UNAUTHORIZED };
}

export function getPool() {
  if (pool) return pool;

  if (!CONFIG.DATABASE_URL) {
    throw new Error('DATABASE_URL non definie (variables d\'environnement Render).');
  }

  const connectionString = cleanConnectionString(CONFIG.DATABASE_URL);

  pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    max: 5,                    // pool petit : Neon Free limite les connexions
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: false
  });

  pool.on('error', err => {
    console.error('  [DB] Erreur de connexion inattendue :', err?.message || err);
  });

  return pool;
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  '57P01', // admin_shutdown  -> Neon a recycle le serveur
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006'  // connection_failure
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Requete avec 2 tentatives en cas d'erreur reseau (Neon qui se reveille / recycle).
 */
export async function query(sql, params = [], { retries = 2 } = {}) {
  const p = getPool();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await p.query(sql, params);
    } catch (err) {
      lastError = err;
      const code = err?.code;
      const isConnError =
        CONNECTION_ERROR_CODES.has(code) ||
        /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|terminat|Connection terminated/i.test(
          String(err?.message || '')
        );

      if (!isConnError || attempt === retries) break;

      console.warn(
        `  [DB] Requete echouee (${code || err?.message}), tentative ${attempt + 1}/${retries}...`
      );
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'active',
  wa_number     TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

-- Une session WhatsApp par utilisateur, CREDS ET CLES stockees en base
-- (avant : dossier sessions/ sur le disque ephemere de Render => tout etait perdu)
CREATE TABLE IF NOT EXISTS bot_sessions (
  user_id    INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wa_number  TEXT NOT NULL,
  creds      JSONB,
  keys       JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected  BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen  TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_last_seen ON bot_sessions (last_seen DESC);

-- Jobs de longue duree (commandes "24h") lances en ARRIERE-PLAN.
-- Persistes pour : (1) survivre a la fermeture du navigateur, (2) etre repris
-- automatiquement apres un redemarrage / redeploy Render, (3) alimenter l'UI.
CREATE TABLE IF NOT EXISTS bot_jobs (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command      TEXT NOT NULL,
  target       TEXT NOT NULL,              -- JID resolu (…@s.whatsapp.net / …@g.us)
  from_jid     TEXT,                       -- chat d'origine (null => identique a target)
  label        TEXT,                       -- ce que l'utilisateur a saisi (numero / lien)
  is_group     BOOLEAN NOT NULL DEFAULT FALSE,
  args         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status       TEXT NOT NULL DEFAULT 'running',
                                             -- running | done | cancelled | failed | interrupted
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ NOT NULL,
  sent_count   INTEGER NOT NULL DEFAULT 0,  -- actions reellement envoyees
  hour_count   INTEGER NOT NULL DEFAULT 0,  -- quota consomme sur l'heure courante
  hour_start   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed      INTEGER NOT NULL DEFAULT 0,  -- nb de reprises apres redemarrage
  last_error   TEXT,
  finished_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_jobs_user ON bot_jobs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_jobs_resumable ON bot_jobs (status, ends_at);
`;

export async function initSchema() {
  await query(SCHEMA);
  console.log('  [DB] Schema pret (users / session / bot_sessions / bot_jobs)');
}

export async function closePool() {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  pool = null;
}

export { pg };
