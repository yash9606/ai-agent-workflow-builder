"use client";

import { createClient, type NhostClient } from "@nhost/nhost-js";

let client: NhostClient | null = null;

export function isNhostConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN?.trim() &&
      process.env.NEXT_PUBLIC_NHOST_REGION?.trim()
  );
}

/** Nhost JS SDK v4 client — used when effective auth mode is nhost. */
export function getNhostClient(): NhostClient {
  if (!isNhostConfigured()) {
    throw new Error("Nhost is not configured");
  }
  if (!client) {
    client = createClient({
      subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN!,
      region: process.env.NEXT_PUBLIC_NHOST_REGION!,
    });
  }
  return client;
}

export async function signOutNhost(): Promise<void> {
  if (!isNhostConfigured()) return;
  try {
    const nhost = getNhostClient();
    const refreshToken = nhost.getUserSession()?.refreshToken;
    await nhost.auth.signOut(refreshToken ? { refreshToken } : { all: false });
  } catch {
    // best-effort
  }
}
