import crypto from 'node:crypto';

/**
 * Validates security configuration on application startup.
 * Enforces production invariants:
 * 1. In production, JWT_SECRET must be explicitly provided and exhibit true cryptographic randomness:
 *    - At least 32 characters in length.
 *    - At least 10 unique characters.
 *    - Shannon entropy >= 3.0 bits per character (preventing repeated sequences like "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").
 * 2. In production, SEED_SAMPLE_DATA must never be enabled (refuse to boot if set to 'true').
 * 3. Supports controlled key rotation via optional JWT_SECRET_PREVIOUS.
 * 4. Never prints or logs secrets to standard output or log streams.
 */

export interface SecurityConfig {
  jwtSecret: string;
  jwtSecretPrevious: string | null;
  jwtExpiresIn: string;
  isProduction: boolean;
  seedSampleData: boolean;
  nodeEnv: string;
}

let cachedConfig: SecurityConfig | null = null;
let devEphemeralSecret: string | null = null;

/**
 * Computes Shannon entropy (in bits per character) for an input string.
 * Random base64/hex typically scores 3.8 to 5.5+ bits/char.
 * Low entropy strings (e.g. repeated characters or simple sequences) score < 2.5.
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function validateSecurityConfig(): SecurityConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const seedSampleDataEnv = (process.env.SEED_SAMPLE_DATA || '').trim().toLowerCase();
  const seedSampleData = seedSampleDataEnv === 'true' || seedSampleDataEnv === '1';

  // In production, refuse sample seeding to prevent demo accounts from polluting clean databases
  if (isProduction && seedSampleData) {
    const errorMsg =
      'FATAL CONFIGURATION ERROR: SEED_SAMPLE_DATA cannot be enabled when NODE_ENV is "production". ' +
      'Sample data and demo personas must only be seeded in development or test environments.';
    console.error(`[Security] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const rawJwtSecret = process.env.JWT_SECRET;
  const rawJwtSecretPrevious = process.env.JWT_SECRET_PREVIOUS ? process.env.JWT_SECRET_PREVIOUS.trim() : null;

  if (isProduction) {
    if (!rawJwtSecret) {
      const errorMsg =
        'FATAL SECURITY ERROR: JWT_SECRET environment variable is missing in production. ' +
        'A securely generated secret of at least 32 random characters (or 256 bits of entropy) is required to start the server.';
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    if (rawJwtSecret.length < 32) {
      const errorMsg =
        `FATAL SECURITY ERROR: JWT_SECRET is too short (${rawJwtSecret.length} characters). ` +
        'Production mandates a minimum of 32 characters (e.g., generated via "openssl rand -base64 32").';
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Cryptographic randomness verification: enforce minimum unique characters, Shannon entropy, and character diversity
    const uniqueChars = new Set(rawJwtSecret).size;
    const entropy = calculateShannonEntropy(rawJwtSecret);
    const hasMultipleClasses =
      (/[a-zA-Z]/.test(rawJwtSecret) && /[^a-zA-Z]/.test(rawJwtSecret)) ||
      (/[0-9]/.test(rawJwtSecret) && /[^0-9]/.test(rawJwtSecret));

    if (uniqueChars < 12 || entropy < 3.4 || !hasMultipleClasses) {
      const errorMsg =
        `FATAL SECURITY ERROR: JWT_SECRET lacks sufficient cryptographic randomness ` +
        `(uniqueChars=${uniqueChars}, entropy=${entropy.toFixed(2)} bits/char). ` +
        'Predictable, repetitive, or single-character-class strings are prohibited in production. Generate a strong key via "openssl rand -base64 32".';
      console.error(`[Security] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  // Development/Test fallback: generate an ephemeral cryptographic secret for this runtime session if not supplied
  const effectiveJwtSecret =
    rawJwtSecret && rawJwtSecret.trim().length >= 16
      ? rawJwtSecret.trim()
      : isProduction
      ? ''
      : getDevFallbackSecret();

  // Production session lifetime: default to 2 hours (configurable via JWT_EXPIRES_IN)
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || (isProduction ? '2h' : '12h');

  cachedConfig = {
    jwtSecret: effectiveJwtSecret,
    jwtSecretPrevious: rawJwtSecretPrevious,
    jwtExpiresIn,
    isProduction,
    seedSampleData,
    nodeEnv,
  };

  console.log(
    `[Security] Configuration validated: NODE_ENV=${nodeEnv}, ` +
      `JWT_SECRET_LENGTH=${effectiveJwtSecret.length} chars (HS256 enforced), ` +
      `KEY_ROTATION_OVERLAP=${rawJwtSecretPrevious ? 'ENABLED' : 'DISABLED'}, ` +
      `JWT_EXPIRES_IN=${jwtExpiresIn}, ` +
      `SEED_SAMPLE_DATA=${seedSampleData ? 'ENABLED' : 'DISABLED'}`
  );

  return cachedConfig;
}

function getDevFallbackSecret(): string {
  if (!devEphemeralSecret) {
    // Generate a strong ephemeral 32-byte hex secret for local development
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[Security Warning] JWT_SECRET not provided in environment. ' +
        'Generated a runtime ephemeral 256-bit secret for this session. (Never use in production!)'
    );
  }
  return devEphemeralSecret;
}

/**
 * Returns the currently active primary JWT signing/verification secret.
 */
export function getJwtSecret(): string {
  if (!cachedConfig) {
    return validateSecurityConfig().jwtSecret;
  }
  return cachedConfig.jwtSecret;
}

/**
 * Returns the previous JWT secret for controlled key overlap rotation, if configured.
 */
export function getPreviousJwtSecret(): string | null {
  if (!cachedConfig) {
    return validateSecurityConfig().jwtSecretPrevious;
  }
  return cachedConfig.jwtSecretPrevious;
}

/**
 * Reset config cache (primarily for unit tests).
 */
export function _resetSecurityConfigForTesting(): void {
  cachedConfig = null;
  devEphemeralSecret = null;
}
