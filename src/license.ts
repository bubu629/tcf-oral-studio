// src/license.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LicensePayload {
  license_id: string;
  tier: 'COMMUNITY' | 'PERSONAL' | 'PRO';
  max_sessions_per_day: number;
  unlock_all_topics: boolean;
  unlock_audio_export: boolean;
  issued_at: string;
  expires_at: string | null;
}

export const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQtBpUcXTGtNdDhJFXXwJWS2UWYkVi+T8JIwnXJSXeCY=
-----END PUBLIC KEY-----`;
const LICENSE_FILE = path.join(os.homedir(), '.tcf-oral-studio', 'license.key');

export function verifyOfflineLicense(licenseKey: string): {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
} {
  try {
    const parts = licenseKey.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'TCF1') {
      return { valid: false, reason: 'Invalid format (Expected TCF1.<payload>.<sig>)' };
    }
    const [, payloadB64, sigB64] = parts;
    const ok = crypto.verify(
      null,
      Buffer.from(payloadB64, 'utf8'),
      EMBEDDED_PUBLIC_KEY,
      Buffer.from(sigB64, 'base64url')
    );
    if (!ok) return { valid: false, reason: 'Ed25519 signature verification failed' };
    const payload: LicensePayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Malformed license key' };
  }
}

export function saveAndActivateLicense(licenseKey: string) {
  const res = verifyOfflineLicense(licenseKey);
  if (!res.valid || !res.payload) return res;
  fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
  fs.writeFileSync(LICENSE_FILE, licenseKey.trim(), 'utf8');
  return res;
}

export function loadSavedLicense(): LicensePayload | null {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const raw = fs.readFileSync(LICENSE_FILE, 'utf8');
    const res = verifyOfflineLicense(raw);
    return res.valid && res.payload ? res.payload : null;
  } catch {
    return null;
  }
}
