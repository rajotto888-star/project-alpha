import { Hono } from "hono";
import { PROVIDER_CATALOG } from "../providers/catalog";
import type { PublicEnv } from "../types/env";

const catalog = new Hono<PublicEnv>();

// Public route — no session middleware, never mounted behind the auth guard.
catalog.get("/catalog", (c) => {
  const publicSafe = PROVIDER_CATALOG.map((p) => ({
    id: p.id,
    models: p.models,
    implemented: p.implemented,
    selectable: p.selectable,
  }));
  return c.json({ providers: publicSafe });
});

export default catalog;
