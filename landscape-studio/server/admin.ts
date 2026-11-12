// Usage: node server/admin.ts add <name> <owner|estimator|crew|reviewer> <password>
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const DATA = resolve(process.env.LIS_DATA_DIR ?? 'data');
mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(join(DATA, 'studio.db'));
db.exec(readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8'));
const [cmd, name, role, pw] = process.argv.slice(2);
if (cmd !== 'add' || !name || !role || !pw) { console.error('Usage: node server/admin.ts add <name> <owner|estimator|crew|reviewer> <password>'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
db.prepare('INSERT INTO users(name, role, password) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET role=excluded.role, password=excluded.password').run(name, role, `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`);
console.log(`User ${name} (${role}) saved.`);
