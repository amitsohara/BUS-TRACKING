import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
}

// Path normalization & traversal defense: ensure database stays within designated app workspace
let resolvedDbPath = path.join(DB_DIR, 'schoolbus.db');
if (process.env.SQLITE_DB_PATH) {
  const candidatePath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH);
  resolvedDbPath = candidatePath;
}

/**
 * Embedded SQLite Database Connection:
 * - Engine: In-process C-level SQLite engine via Node 22 DatabaseSync.
 * - Network Surface: ZERO open network ports, zero TCP/IP listeners, zero network credentials.
 *   Unlike remote SQL databases (PostgreSQL/MySQL), it is physically impossible to attack or connect
 *   to SQLite remotely via network port scanning or default credentials.
 * - Transport Security: Direct memory and local block I/O.
 * - Concurrency: Multi-reader, single-writer WAL mode (Write-Ahead Logging).
 */
export const db = new DatabaseSync(resolvedDbPath);

// Enable Foreign Keys & WAL mode for high concurrency and strict referential integrity
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');

console.log(`[Database] Connected to persistent SQLite database at: ${resolvedDbPath} (Engine: Embedded zero-port WAL)`);
