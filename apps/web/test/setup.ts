/**
 * Test environment setup for apps/web.
 *
 * jsdom provides the DOM APIs (@microsoft/fetch-event-source touches `document`) but ships
 * neither WebCrypto nor IndexedDB, both of which the vault needs — Node 20 has both, so they
 * are bridged here.
 *
 * The vault never closes its IDB connections, so `deleteDatabase()` between tests blocks
 * forever waiting for them. Replacing the whole factory per test sidesteps that cleanly.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;

if (!g.crypto || !(g.crypto as Crypto).subtle) {
  g.crypto = webcrypto as unknown as Crypto;
}

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
});
