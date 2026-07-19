import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db.server";

const DEV_FALLBACK_SECRET = "lio23-local-secret-key-please-change-in-prod";

export interface FullUser {
  id: number;
  email: string;
  username: string;
  email_verified: number;
  status: string;
  is_admin: number;
  chat_enabled: number;
  created_at: number;
}

/** Cryptographically-random URL-safe token for email verification / password reset. */
export function generateAuthToken(): string {
  return randomBytes(32).toString("hex");
}

/** Load the full user row (incl. verification/status/admin flags) for an authenticated request. */
export async function getFullUserFromRequest(request: Request): Promise<FullUser | null> {
  const auth = await getUserFromRequest(request);
  if (!auth) return null;
  const db = getDb();
  return (
    (db
      .prepare(
        "SELECT id, email, username, email_verified, status, is_admin, chat_enabled, created_at FROM users WHERE id = ?",
      )
      .get(auth.userId) as FullUser | undefined) ?? null
  );
}

/** Returns the admin user for the request, or null if not authenticated as an approved admin. */
export async function requireAdmin(request: Request): Promise<FullUser | null> {
  const user = await getFullUserFromRequest(request);
  if (!user || !user.is_admin) return null;
  return user;
}

// Read the secret per-call so env vars bound at request time are picked up,
// and so a missing secret in production fails loudly instead of silently
// using a guessable default (which would let anyone forge login tokens).
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret === DEV_FALLBACK_SECRET)) {
    throw new Error(
      "JWT_SECRET manquant ou non sécurisé en production. Définis une valeur forte dans les variables d'environnement.",
    );
  }
  return new TextEncoder().encode(secret ?? DEV_FALLBACK_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(userId: number, email: string): Promise<string> {
  return new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getJwtSecret());
}

export async function verifyToken(
  token: string,
): Promise<{ userId: number; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return { userId: payload.userId as number, email: payload.email as string };
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function getUserFromRequest(
  request: Request,
): Promise<{ userId: number; email: string } | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}
