/**
 * ============================================================
 *  UTILISATEURS — stockes dans Postgres (Neon)
 * ============================================================
 *  Avant : users.json sur le disque ephemere de Render
 *          => tous les comptes disparaisssaient a chaque redemarrage / redeploy.
 *  Maintenant : table `users`, les comptes sont persistants.
 */

import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { CONFIG } from './config.js';

/** Contrainte d'unicite Postgres (username ou wa_number deja pris) */
export const UNIQUE_VIOLATION = '23505';
export const isUniqueViolation = err => err?.code === UNIQUE_VIOLATION;

const USER_COLUMNS = 'id, username, password_hash, is_admin, status, wa_number, created_at';

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    password: row.password_hash, // reste compatible avec l'ancien code (bcrypt)
    password_hash: row.password_hash,
    isadmin: !!row.is_admin,
    isAdmin: !!row.is_admin,
    status: row.status,
    wa_number: row.wa_number,
    createdAt: row.created_at
  };
}

export async function getUserById(id) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return mapUser(rows[0]);
}

export async function getUserByUsername(username) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(username) = lower($1)`,
    [username]
  );
  return mapUser(rows[0]);
}

export async function getUserByWaNumber(waNumber) {
  if (!waNumber) return null;
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE wa_number = $1`, [
    waNumber
  ]);
  return mapUser(rows[0]);
}

export async function listUsers() {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY id ASC`);
  return rows.map(mapUser);
}

/** Compatibilite avec l'ancien code : findUser(u => u.username === x) */
export async function findUser(predicate) {
  const users = await listUsers();
  return users.find(predicate) || null;
}

export async function createUser({ username, password, isAdmin = false, waNumber = null }) {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, is_admin, status, wa_number)
     VALUES ($1, $2, $3, 'active', $4)
     RETURNING ${USER_COLUMNS}`,
    [username, hash, !!isAdmin, waNumber || null]
  );
  return mapUser(rows[0]);
}

const FIELD_MAP = {
  username: 'username',
  password: 'password_hash',
  password_hash: 'password_hash',
  isadmin: 'is_admin',
  isAdmin: 'is_admin',
  status: 'status',
  wa_number: 'wa_number',
  waNumber: 'wa_number'
};

export async function updateUser(id, updates = {}) {
  const sets = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    const column = FIELD_MAP[key] || key;
    // "password" arrive en clair -> on le hash ; "password_hash" est deja hashe
    values.push(key === 'password' ? await bcrypt.hash(String(value), 10) : value);
    sets.push(`${column} = $${values.length}`);
  }

  if (!sets.length) return getUserById(id);

  values.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLUMNS}`,
    values
  );
  return mapUser(rows[0]);
}

/**
 * Cree / met a jour les comptes admin definis par les variables d'environnement
 * ADMIN_USERS  ("Pseudo:Motdepasse,Pseudo2:Motdepasse2")
 * ADMIN_USERNAMES ("Pseudo1,Pseudo2" -> droits admin sur un compte existant)
 */
async function seedAdmins() {
  for (const admin of CONFIG.ADMIN_USERS) {
    try {
      const existing = await getUserByUsername(admin.username);

      if (existing) {
        const updates = { isadmin: true };
        if (admin.password) updates.password = admin.password; // l'env reste la source de verite
        await updateUser(existing.id, updates);
        console.log(`  [DB] Admin synchronise : ${admin.username}`);
      } else if (admin.password) {
        await createUser({ username: admin.username, password: admin.password, isAdmin: true });
        console.log(`  [DB] Admin cree : ${admin.username}`);
      } else {
        console.warn(
          `  [DB] Admin "${admin.username}" : aucun mot de passe fourni et compte inexistant, ignore.`
        );
      }
    } catch (err) {
      console.error(`  [DB] Erreur admin ${admin.username} :`, err?.message || err);
    }
  }

  for (const username of CONFIG.ADMIN_USERNAMES) {
    const existing = await getUserByUsername(username);
    if (existing) {
      await updateUser(existing.id, { isadmin: true });
      console.log(`  [DB] Droits admin accordes : ${username}`);
    }
  }
}

export async function initDB() {
  const { initSchema } = await import('./db.js');
  await initSchema();
  await seedAdmins();
  console.log('  [DB] Utilisateurs initialises');
}

// ============================================================
//  JOBS D'ARRIERE-PLAN (table bot_jobs)
// ============================================================
/**
 * Une commande "24h" n'est plus attendue par la requete HTTP : elle devient un
 * job persiste ici. Le navigateur peut etre ferme, le serveur peut redemarrer :
 * la ligne `status='running'` + `ends_at` permet de reprendre exactement ou
 * l'execution s'etait arretee.
 */

const JOB_COLUMNS = `id, user_id, command, target, from_jid, label, is_group, args, status,
                     started_at, ends_at, sent_count, hour_count, hour_start,
                     resumed, last_error, finished_at, updated_at`;

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    command: row.command,
    target: row.target,
    fromJid: row.from_jid || row.target,
    label: row.label,
    isGroup: !!row.is_group,
    args: Array.isArray(row.args) ? row.args : [],
    status: row.status,
    startedAt: new Date(row.started_at).getTime(),
    endsAt: new Date(row.ends_at).getTime(),
    sentCount: row.sent_count || 0,
    hourCount: row.hour_count || 0,
    hourStart: new Date(row.hour_start).getTime(),
    resumed: row.resumed || 0,
    lastError: row.last_error || null,
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
    updatedAt: new Date(row.updated_at).getTime()
  };
}

export async function createJobRow(job) {
  const { rows } = await query(
    `INSERT INTO bot_jobs
       (id, user_id, command, target, from_jid, label, is_group, args, status,
        started_at, ends_at, sent_count, hour_count, hour_start, resumed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'running',
             to_timestamp($9/1000.0), to_timestamp($10/1000.0), $11, $12, to_timestamp($13/1000.0), $14)
     RETURNING ${JOB_COLUMNS}`,
    [
      job.id,
      Number(job.userId),
      job.command,
      job.target,
      job.fromJid || job.target,
      job.label || null,
      !!job.isGroup,
      JSON.stringify(job.args || []),
      job.startedAt,
      job.endsAt,
      job.sentCount || 0,
      job.hourCount || 0,
      job.hourStart || job.startedAt,
      job.resumed || 0
    ]
  );
  return mapJob(rows[0]);
}

/** Mise a jour legere (1 UPDATE toutes les ~5 min : maintient aussi Neon eveille). */
export async function updateJobProgress(id, { sentCount, hourCount, hourStart } = {}) {
  const { rows } = await query(
    `UPDATE bot_jobs
        SET sent_count = $2,
            hour_count = $3,
            hour_start = to_timestamp($4/1000.0),
            updated_at = now()
      WHERE id = $1
     RETURNING ${JOB_COLUMNS}`,
    [id, sentCount || 0, hourCount || 0, hourStart || Date.now()]
  );
  return mapJob(rows[0]);
}

export async function setJobStatus(id, status, { lastError = null, finished = true } = {}) {
  const { rows } = await query(
    `UPDATE bot_jobs
        SET status = $2,
            last_error = $3,
            finished_at = CASE WHEN $4 THEN now() ELSE finished_at END,
            updated_at = now()
      WHERE id = $1
     RETURNING ${JOB_COLUMNS}`,
    [id, status, lastError, finished]
  );
  return mapJob(rows[0]);
}

export async function bumpJobResume(id) {
  const { rows } = await query(
    `UPDATE bot_jobs SET resumed = resumed + 1, updated_at = now() WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
    [id]
  );
  return mapJob(rows[0]);
}

export async function getJobRow(id) {
  const { rows } = await query(`SELECT ${JOB_COLUMNS} FROM bot_jobs WHERE id = $1`, [id]);
  return mapJob(rows[0]);
}

export async function listJobRows(userId, limit = 15) {
  const { rows } = await query(
    `SELECT ${JOB_COLUMNS} FROM bot_jobs
      WHERE user_id = $1
      ORDER BY (status = 'running') DESC, started_at DESC
      LIMIT $2`,
    [Number(userId), limit]
  );
  return rows.map(mapJob);
}

export async function findActiveJobRow(userId, target) {
  const { rows } = await query(
    `SELECT ${JOB_COLUMNS} FROM bot_jobs
      WHERE user_id = $1 AND target = $2 AND status = 'running' AND ends_at > now()
      ORDER BY started_at DESC
      LIMIT 1`,
    [Number(userId), target]
  );
  return mapJob(rows[0]);
}

export async function countActiveJobs(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM bot_jobs
      WHERE user_id = $1 AND status = 'running' AND ends_at > now()`,
    [Number(userId)]
  );
  return rows[0]?.n || 0;
}

/** Jobs a reprendre au demarrage : encore 'running' et pas arrives a terme. */
export async function getResumableJobRows(limit = 50) {
  const { rows } = await query(
    `SELECT ${JOB_COLUMNS} FROM bot_jobs
      WHERE status = 'running' AND ends_at > now()
      ORDER BY started_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows.map(mapJob);
}

/** Jobs 'running' dont la duree est ecoulee mais jamais termines (process tue). */
export async function expireStaleJobRows() {
  const { rows } = await query(
    `UPDATE bot_jobs
        SET status = 'interrupted',
            last_error = COALESCE(last_error, 'Duree ecoulee pendant un arret du serveur'),
            finished_at = now(),
            updated_at = now()
      WHERE status = 'running' AND ends_at <= now()
     RETURNING id`
  );
  return rows.length;
}

