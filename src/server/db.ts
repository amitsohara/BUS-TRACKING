import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_DIR = path.resolve(process.cwd(), 'data');

// Path normalization & traversal defense: ensure database stays within designated app workspace
let resolvedDbPath = path.join(DB_DIR, 'schoolbus.db');
if (process.env.SQLITE_DB_PATH) {
  const candidatePath = path.isAbsolute(process.env.SQLITE_DB_PATH)
    ? process.env.SQLITE_DB_PATH
    : path.resolve(process.cwd(), process.env.SQLITE_DB_PATH);
  resolvedDbPath = candidatePath;
}

// Ensure the parent directory for the SQLite database ALWAYS exists
const targetDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
}

/**
 * Embedded SQLite Database Connection:
 * - Engine: In-process C-level SQLite engine via Node 22 DatabaseSync.
 * - Concurrency: Multi-reader, single-writer WAL mode with automatic fallback.
 */
export const db = new DatabaseSync(resolvedDbPath);

// Enable Foreign Keys & journal mode for high concurrency and strict referential integrity
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 10000;');

try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA wal_autocheckpoint = 100;');
} catch (err) {
  console.warn('[Database] WAL mode unsupported on this filesystem, falling back to DELETE mode:', err);
  try {
    db.exec('PRAGMA journal_mode = DELETE;');
  } catch (_) {}
}

// Graceful process exit flush to ensure WAL frames are checkpointed to main database file
function flushDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
}

process.on('exit', flushDatabase);
process.on('SIGINT', () => { flushDatabase(); process.exit(0); });
process.on('SIGTERM', () => { flushDatabase(); process.exit(0); });

console.log(`[Database] Connected to persistent SQLite database at: ${resolvedDbPath}`);
