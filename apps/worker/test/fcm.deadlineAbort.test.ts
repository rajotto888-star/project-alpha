import { describe, it, expect } from "vitest";
import { raceWithDeadline } from "../src/adapters/errors";

describe("FCM deadline abort (LOCKED F3)", () => {
  it("resolves 'deadline' and aborts the dedicated controller when work exceeds ms", async () => {
    const controller = new AbortController();
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 60));
    const outcome = await raceWithDeadline(slow, 10, controller);
    expect(outcome.outcome).toBe("deadline");
    expect(controller.signal.aborted).toBe(true);
  });

  it("resolves 'ok' and does NOT abort when work finishes inside budget", async () => {
    const controller = new AbortController();
    const fast = new Promise<void>((resolve) => setTimeout(resolve, 5));
    const outcome = await raceWithDeadline(fast, 50, controller);
    expect(outcome.outcome).toBe("ok");
    expect(controller.signal.aborted).toBe(false);
  });

  it("propagates a REAL failure distinctly (not mislabeled as deadline)", async () => {
    const controller = new AbortController();
    const failing = Promise.reject(new Error("upstream 500"));
    await expect(raceWithDeadline(failing, 50, controller)).rejects.toThrow("upstream 500");
  });
});
