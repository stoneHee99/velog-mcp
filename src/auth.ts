import { execSync, exec } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const TOKEN_DIR = path.join(os.homedir(), ".velog-mcp");
const TOKEN_FILE = path.join(TOKEN_DIR, "tokens.json");

export interface VelogTokens {
  accessToken: string;
  refreshToken: string;
  savedAt: string;
}

export function loadTokens(): VelogTokens | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
      return data as VelogTokens;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveTokens(tokens: VelogTokens): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ── Chrome encryption key extraction (per platform) ──

function getChromeEncryptionKey(): { key: Buffer; isAesGcm: boolean } {
  if (process.platform === "darwin") {
    return { key: getMacOSKey(), isAesGcm: false };
  } else if (process.platform === "win32") {
    return { key: getWindowsKey(), isAesGcm: true };
  } else {
    return { key: getLinuxKey(), isAesGcm: false };
  }
}

function getMacOSKey(): Buffer {
  const password = execSync(
    'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
    { encoding: "utf-8" },
  ).trim();
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

function getWindowsKey(): Buffer {
  const chromeBase = path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    "Google", "Chrome", "User Data",
  );
  const localStatePath = path.join(chromeBase, "Local State");

  if (!fs.existsSync(localStatePath)) {
    throw new Error("Chrome Local State file not found. Is Chrome installed?");
  }

  const localState = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
  const encryptedKeyB64 = localState?.os_crypt?.encrypted_key;

  if (!encryptedKeyB64) {
    throw new Error("Could not find encrypted_key in Chrome Local State");
  }

  // Base64 decode, strip "DPAPI" prefix (5 bytes)
  const encryptedKey = Buffer.from(encryptedKeyB64, "base64").subarray(5);

  // Decrypt using DPAPI via PowerShell
  const hexKey = encryptedKey.toString("hex");
  const psScript = `
    Add-Type -AssemblyName System.Security
    $encrypted = [byte[]]::new(${encryptedKey.length})
    $hex = '${hexKey}'
    for ($i = 0; $i -lt $encrypted.Length; $i++) {
      $encrypted[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
    }
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, 'CurrentUser')
    [Convert]::ToBase64String($decrypted)
  `.replace(/\n/g, " ");

  const result = execSync(`powershell -Command "${psScript}"`, { encoding: "utf-8" }).trim();
  return Buffer.from(result, "base64");
}

function getLinuxKey(): Buffer {
  // Linux Chrome uses "peanuts" as default password with 1 iteration
  // (or from gnome-keyring/kwallet, but "peanuts" is the fallback)
  return crypto.pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
}

// ── Cookie decryption ──

function decryptCookieValue(encryptedValue: Buffer, key: Buffer, isAesGcm: boolean): string {
  if (encryptedValue.length === 0) return "";

  const prefix = encryptedValue.subarray(0, 3).toString("utf-8");

  let decrypted: string;

  if (prefix === "v10" && !isAesGcm) {
    // macOS / Linux: AES-128-CBC
    const encrypted = encryptedValue.subarray(3);
    const iv = Buffer.alloc(16, " "); // 16 bytes of 0x20
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(true);
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
  } else if ((prefix === "v10" || prefix === "v11") && isAesGcm) {
    // Windows: AES-256-GCM
    const nonce = encryptedValue.subarray(3, 3 + 12); // 12-byte nonce
    const ciphertext = encryptedValue.subarray(3 + 12, encryptedValue.length - 16); // everything except last 16 bytes
    const authTag = encryptedValue.subarray(encryptedValue.length - 16); // last 16 bytes = auth tag
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  } else {
    // Unencrypted
    decrypted = encryptedValue.toString("utf-8");
  }

  // Chrome CBC decryption with mismatched IV can produce garbage bytes
  // before the actual value. For JWT tokens, extract from "eyJ" prefix.
  const jwtStart = decrypted.indexOf("eyJ");
  if (jwtStart > 0) {
    decrypted = decrypted.substring(jwtStart);
  }

  return decrypted;
}

// ── Chrome profile discovery ──

function getChromeBaseDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  } else if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Google", "Chrome", "User Data",
    );
  }
  return path.join(os.homedir(), ".config", "google-chrome");
}

function findChromeProfileDir(): string {
  const chromeBase = getChromeBaseDir();
  const candidates = ["Default", "Profile 1", "Profile 2", "Profile 3"];
  for (const profile of candidates) {
    const cookieFile = path.join(chromeBase, profile, "Cookies");
    if (fs.existsSync(cookieFile)) {
      return path.join(chromeBase, profile);
    }
  }
  return path.join(chromeBase, "Default");
}

// ── Cookie reading ──

function findSqlite3(): string {
  if (process.platform === "win32") {
    // sqlite3 is not bundled on Windows; check common paths
    const candidates = [
      "sqlite3",
      path.join(process.env.ProgramFiles ?? "", "sqlite3", "sqlite3.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "sqlite3", "sqlite3.exe"),
    ];
    for (const cmd of candidates) {
      try {
        execSync(`"${cmd}" --version`, { stdio: "ignore" });
        return cmd;
      } catch { /* not found */ }
    }
    throw new Error(
      "sqlite3 is required but not found. " +
      "Install it from https://www.sqlite.org/download.html and add to PATH.",
    );
  }
  return "sqlite3"; // Available by default on macOS and most Linux
}

function readCookiesFromChrome(): { accessToken: string; refreshToken: string } | null {
  const profileDir = findChromeProfileDir();
  const cookieDbPath = path.join(profileDir, "Cookies");

  if (!fs.existsSync(cookieDbPath)) {
    return null;
  }

  // Copy DB to temp file to avoid locking issues
  const tempDb = path.join(TOKEN_DIR, "cookies_tmp.db");
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  fs.copyFileSync(cookieDbPath, tempDb);

  for (const ext of ["-wal", "-shm"]) {
    const src = cookieDbPath + ext;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, tempDb + ext);
    }
  }

  try {
    const { key, isAesGcm } = getChromeEncryptionKey();
    const sqlite3 = findSqlite3();

    const query = `SELECT name, hex(encrypted_value) FROM cookies WHERE host_key = '.velog.io' AND (name = 'access_token' OR name = 'refresh_token');`;
    const result = execSync(`"${sqlite3}" "${tempDb}" "${query}"`, { encoding: "utf-8" }).trim();

    if (!result) return null;

    let accessToken = "";
    let refreshToken = "";

    for (const line of result.split("\n")) {
      const [name, hexValue] = line.split("|");
      if (!hexValue) continue;
      const encryptedBuffer = Buffer.from(hexValue, "hex");
      const value = decryptCookieValue(encryptedBuffer, key, isAesGcm);

      if (name === "access_token") accessToken = value;
      if (name === "refresh_token") refreshToken = value;
    }

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }
    return null;
  } finally {
    try { fs.unlinkSync(tempDb); } catch { /* ignore */ }
    try { fs.unlinkSync(tempDb + "-wal"); } catch { /* ignore */ }
    try { fs.unlinkSync(tempDb + "-shm"); } catch { /* ignore */ }
  }
}

// ── Browser launch ──

function openVelogInChrome(): void {
  if (process.platform === "darwin") {
    exec('open -a "Google Chrome" "https://velog.io"');
  } else if (process.platform === "win32") {
    exec('start "" "https://velog.io"');
  } else {
    exec('xdg-open "https://velog.io"');
  }
}

// ── Main login flow ──

export async function loginAndExtractTokens(): Promise<VelogTokens> {
  // First, check if cookies already exist in Chrome
  const existing = readCookiesFromChrome();
  if (existing) {
    const tokens: VelogTokens = { ...existing, savedAt: new Date().toISOString() };
    saveTokens(tokens);
    console.error("Found existing Velog tokens in Chrome.");
    return tokens;
  }

  // Open velog.io as a new tab in existing Chrome
  openVelogInChrome();
  console.error("Opened velog.io in Chrome. Please log in...");

  // Poll Chrome's cookie DB until tokens appear
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    const result = readCookiesFromChrome();
    if (result) {
      const tokens: VelogTokens = { ...result, savedAt: new Date().toISOString() };
      saveTokens(tokens);
      console.error(`Tokens saved to ${TOKEN_FILE}`);
      return tokens;
    }
  }

  throw new Error("Login timed out after 5 minutes");
}

// Run directly: node dist/auth.js
const isDirectRun = process.argv[1]?.endsWith("/auth.js") || process.argv[1]?.endsWith("\\auth.js");
if (isDirectRun) {
  loginAndExtractTokens()
    .then(() => {
      console.log("Login successful!");
      console.log(`Tokens saved to ${TOKEN_FILE}`);
    })
    .catch((err) => {
      console.error("Login failed:", err.message);
      process.exit(1);
    });
}
