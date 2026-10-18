/**
 * KeysPanel tests — the D2 acceptance gate: "a key can actually be entered".
 *
 * Zero new dependencies: jsdom (already configured) + react-dom/client + React
 * 18.3's top-level `act`. The Vault is the REAL implementation against
 * fake-indexeddb + Node webcrypto (see test/setup.ts), so persist() runs for
 * real — including the LOCKED PBKDF2 parameter — instead of being mocked away.
 *
 * Timing note: Save/Remove await a real 600k-iteration deriveKey, so the state
 * updates land after act()'s first flush. `clickAndWait` therefore completes the
 * click in one act scope and then pumps act-wrapped macrotask ticks (never
 * polling inside act, which would deadlock) until the status line appears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KeysPanel } from "../src/components/KeysPanel";
import { Vault } from "../src/lib/vault";

const PW = "keys panel passphrase";
const SECRET = "sk-live-test-abcdefghijklmnopqrstuvwxyz";

const CATALOG = {
  providers: [
    { id: "openai", models: ["gpt-4o", "gpt-4o-mini"], implemented: true, selectable: true },
    { id: "groq", models: ["llama-3.3-70b-versatile"], implemented: true, selectable: true },
    { id: "gemini", models: [], implemented: false, selectable: false },
    { id: "anthropic", models: [], implemented: false, selectable: false },
    { id: "deepseek", models: [], implemented: false, selectable: false },
    { id: "mistral", models: [], implemented: false, selectable: false },
  ],
};

function mockCatalog() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => CATALOG }) as unknown as Response),
  );
}

/** React tracks values internally, so write through the native prototype setter. */
function setValue(el: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (!el) throw new Error("setValue: KeysPanel did not render the field");
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

interface Rendered {
  container: HTMLElement;
  root: Root;
  input: HTMLInputElement;
  select: HTMLSelectElement;
  button: (label: string) => HTMLButtonElement;
}

async function render(vault: Vault, ref: MutableRefObject<string>): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<KeysPanel vault={vault} passphraseRef={ref} />);
  });
  const field = (label: string) => container.querySelector(`[aria-label="${label}"]`);
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;
  const input = field("API key") as HTMLInputElement | null;
  const select = field("Provider") as HTMLSelectElement | null;
  if (!input || !select) throw new Error("KeysPanel did not render its fields");
  return { container, root, input, select, button };
}

/** One act-wrapped macrotask tick: lets a pending deriveKey progress without
 *  leaving React's act scope (no "not wrapped in act" warnings). */
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function settle(container: HTMLElement, marker: string) {
  for (let i = 0; i < 200; i += 1) {
    if (container.textContent?.includes(marker)) return;
    await tick();
  }
  throw new Error(`KeysPanel never showed: ${marker}`);
}

async function clickAndWait(btn: HTMLButtonElement, container: HTMLElement, marker: string) {
  await act(async () => {
    btn.click();
  });
  await settle(container, marker);
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  mockCatalog();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KeysPanel", () => {
  it("lists only selectable providers from the public catalog", async () => {
    const { container, select, root } = await render(new Vault(), { current: PW });
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["openai", "groq"]);
    expect(container.textContent).not.toContain("gemini");
    await act(async () => root.unmount());
  });

  it("saves a key into the vault, clears the input, and never renders the key", async () => {
    const vault = new Vault();
    vault.createNew(PW);
    const { container, input, button, root } = await render(vault, { current: PW });
    await act(async () => setValue(input, SECRET));
    expect(input.type).toBe("password");
    await clickAndWait(button("Save"), container, "saved: openai");
    expect(vault.getKey("openai")).toBe(SECRET);
    expect(input.value).toBe("");
    expect(container.textContent).not.toContain(SECRET);
    await act(async () => root.unmount());
  });

  it("persists through the passphrase ref: a fresh Vault unlocks and reads it back", async () => {
    const vault = new Vault();
    vault.createNew(PW);
    const { container, input, button, root } = await render(vault, { current: PW });
    await act(async () => setValue(input, SECRET));
    await clickAndWait(button("Save"), container, "saved: openai");
    const reloaded = new Vault();
    expect(await reloaded.unlock(PW)).toBe(true);
    expect(reloaded.getKey("openai")).toBe(SECRET);
    await act(async () => root.unmount());
  });

  it("keeps the key session-only (and says so) when no passphrase is in memory", async () => {
    const vault = new Vault();
    vault.createNew(PW);
    const { container, input, button, root } = await render(vault, { current: "" });
    await act(async () => setValue(input, SECRET));
    await clickAndWait(button("Save"), container, "session only");
    expect(vault.getKey("openai")).toBe(SECRET);
    const reloaded = new Vault();
    expect(await reloaded.hasVault()).toBe(false);
    await act(async () => root.unmount());
  });

  it("removes a key and flips the header-ready indicator back to no", async () => {
    const vault = new Vault();
    vault.createNew(PW);
    const { container, input, button, root } = await render(vault, { current: PW });
    expect(container.textContent).toContain("ephemeral header ready: no");
    await act(async () => setValue(input, SECRET));
    await clickAndWait(button("Save"), container, "header ready: yes");
    await clickAndWait(button("Remove"), container, "removed: openai");
    expect(vault.getKey("openai")).toBeUndefined();
    expect(container.textContent).toContain("header ready: no");
    await act(async () => root.unmount());
  });

  it("surfaces a catalog failure instead of crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const { container, select, root } = await render(new Vault(), { current: PW });
    expect(select.options.length).toBe(0);
    expect(container.textContent).toContain("Could not load the provider catalog.");
    await act(async () => root.unmount());
  });
});
