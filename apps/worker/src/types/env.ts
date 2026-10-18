export interface PublicEnv {
  Bindings: {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
    APP_URL: string;
    APP_ORIGIN: string;
    COOKIE_SECURE: string;
    SESSION_SECRET: string;
    GOOGLE_OAUTH_CLIENT_ID: string;
    GOOGLE_OAUTH_CLIENT_SECRET: string;
  };
}

export interface AuthedEnv extends PublicEnv {
  Variables: {
    userId: string;
  };
}

export type Env = AuthedEnv;
