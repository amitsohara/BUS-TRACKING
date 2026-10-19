import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { db } from './db.ts';

/**
 * Executes an atomic online SQLite backup using VACUUM INTO.
 * Safe to execute while the application is running and processing writes.
 */
export function createDatabaseBackup(customDestinationDir?: string): {
  success: boolean;
  backupPath: string;
  sizeBytes: number;
  timestamp: string;
} {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = customDestinationDir || path.resolve(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilename = `surakshavahan_backup_${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  // Execute atomic online backup
  db.exec(`VACUUM INTO '${backupPath}';`);

  const stats = fs.statSync(backupPath);
  console.log(`[Backup] Successfully created atomic backup at: ${backupPath} (${stats.size} bytes)`);

  return {
    success: true,
    backupPath,
    sizeBytes: stats.size,
    timestamp,
  };
}

/**
 * Verifies the integrity of a backup database file.
 */
export function verifyBackupIntegrity(backupPath: string): {
  isValid: boolean;
  integrityMessage: string;
  schoolCount: number;
} {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file does not exist at: ${backupPath}`);
  }

  const backupDb = new DatabaseSync(backupPath);
  try {
    const integrityCheck = backupDb.prepare('PRAGMA integrity_check;').get() as any;
    const checkResult = integrityCheck ? Object.values(integrityCheck)[0] : 'unknown';

    if (checkResult !== 'ok') {
      return {
        isValid: false,
        integrityMessage: String(checkResult),
        schoolCount: 0,
      };
    }

    const countRow = backupDb.prepare('SELECT COUNT(*) as count FROM schools;').get() as { count: number };

    return {
      isValid: true,
      integrityMessage: 'ok',
      schoolCount: countRow?.count ?? 0,
    };
  } finally {
    backupDb.close();
  }
}

// CLI execution helper
if (process.argv[1] && process.argv[1].endsWith('backup.ts')) {
  try {
    console.log('[Backup CLI] Initiating backup...');
    const result = createDatabaseBackup();
    const verification = verifyBackupIntegrity(result.backupPath);
    console.log(`[Backup CLI] Verification: integrity=${verification.integrityMessage}, schools=${verification.schoolCount}`);
  } catch (err) {
    console.error('[Backup CLI] Backup failed:', err);
    process.exit(1);
  }
}
