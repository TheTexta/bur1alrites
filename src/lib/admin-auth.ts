import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export { ADMIN_SESSION_COOKIE } from "./admin-session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function isAdminConfigured() {
  return Boolean(isValidPasswordHash(process.env.ADMIN_PASSWORD_HASH) && sessionSecret());
}

function isValidPasswordHash(value: string | undefined) {
  if (!value) return false;

  const [algorithm, salt, hash, extra] = value.split(":");
  return (
    algorithm === "scrypt" &&
    /^[a-f\d]{32}$/i.test(salt ?? "") &&
    /^[a-f\d]{128}$/i.test(hash ?? "") &&
    extra === undefined
  );
}

export function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function isValidAdminSession(value: string | undefined) {
  if (!value || !sessionSecret()) return false;

  const [expiresAt, signature] = value.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = sign(expiresAt);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function passwordsMatch(password: string) {
  const configured = process.env.ADMIN_PASSWORD_HASH;
  if (!configured || !isValidPasswordHash(configured)) return false;

  const [, salt, expectedHash] = configured.split(":");
  if (!salt || !expectedHash) return false;

  const actualBuffer = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}