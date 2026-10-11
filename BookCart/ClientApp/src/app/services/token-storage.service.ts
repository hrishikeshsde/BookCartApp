import { Injectable } from "@angular/core";
import { User } from "../models/user";
import { UserType } from "../models/usertype";

const TOKEN_KEY = "authToken";
const ROLE_CLAIM =
  "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

export interface JwtPayload {
  /** Expiry, in seconds since 1970. */
  exp?: number;
  userId?: string | number;
  sub?: string;
  name?: string;
  role?: string;
  [claim: string]: unknown;
}

/** Reads the payload of a JWT (base64url, UTF-8). Returns null for anything that is not a well-formed token. */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) {
      return null;
    }
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload !== null && typeof payload === "object"
      ? (payload as JwtPayload)
      : null;
  } catch {
    return null;
  }
}

/**
 * The one place that knows where the login token is kept. Switching to another storage (an HttpOnly cookie, in
 * memory) means changing this file only.
 */
@Injectable({
  providedIn: "root",
})
export class TokenStorage {
  /** The stored token, or null when there is none, it is malformed or it has expired (such a token is removed). */
  get(): string | null {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      return null;
    }
    const payload = decodeJwtPayload(token);
    const expired =
      payload?.exp !== undefined && payload.exp * 1000 <= Date.now();
    if (!payload || expired) {
      this.clear();
      return null;
    }
    return token;
  }

  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  clear() {
    localStorage.removeItem(TOKEN_KEY);
  }

  /** The signed-in user described by the stored token, or null. */
  user(): User | null {
    const token = this.get();
    const payload = token ? decodeJwtPayload(token) : null;
    if (!payload) {
      return null;
    }
    const user = new User();
    user.userId = Number(payload.userId ?? payload.sub);
    user.username = String(payload.name ?? "");
    // "sub" is the user id; the role is in the role claim (older tokens carried it in "role" too).
    user.userTypeName = (payload[ROLE_CLAIM] ??
      payload.role ??
      "Unk") as UserType;
    return user;
  }
}
