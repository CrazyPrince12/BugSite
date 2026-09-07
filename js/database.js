import fs from 'fs-extra';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, '..', 'users.json');

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: [], nextId: 1 };
  }
}

function writeUsers(db) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

function findUser(predicate) {
  return readUsers().users.find(predicate) || null;
}

function updateUser(id, updates) {
  const db = readUsers();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...updates };
  writeUsers(db);
  return db.users[idx];
}

async function initDB(adminCredentials) {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [], nextId: 1 }, null, 2));
    console.log('  [DB] users.json cree');
  }

  for (const admin of adminCredentials) {
    const exists = findUser(u => u.username === admin.username);
    if (!exists) {
      const db = readUsers();
      const hash = await bcrypt.hash(admin.password, 10);
      db.users.push({
        id: db.nextId++,
        username: admin.username,
        password: hash,
        isadmin: true,
        status: 'active',
        wa_number: null,
        createdAt: new Date().toISOString()
      });
      writeUsers(db);
      console.log(`  [DB] Admin cree : ${admin.username}`);
    }
  }
  console.log('  [DB] Initialise');
}

export { readUsers, writeUsers, findUser, updateUser, initDB };