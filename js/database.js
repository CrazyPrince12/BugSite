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
