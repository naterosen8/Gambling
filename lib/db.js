import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS bets (
  id text PRIMARY KEY,
  creator_id integer NOT NULL REFERENCES users(id),
  taker_id integer REFERENCES users(id),
  visibility text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  result text,
  sport_key text NOT NULL,
  sport_title text NOT NULL,
  event_id text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  commence_time timestamptz NOT NULL,
  market text NOT NULL,
  selection text NOT NULL,
  point double precision,
  player text,
  price integer NOT NULL,
  creator_stake integer NOT NULL CHECK (creator_stake > 0),
  taker_stake integer NOT NULL CHECK (taker_stake > 0),
  note text,
  creator_report text,
  taker_report text,
  offer_by integer REFERENCES users(id),
  offer_creator_amount integer,
  creator_payout integer,
  taker_payout integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  matched_at timestamptz,
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bets_creator_idx ON bets (creator_id);
CREATE INDEX IF NOT EXISTS bets_taker_idx ON bets (taker_id);
CREATE INDEX IF NOT EXISTS bets_status_idx ON bets (status);

CREATE TABLE IF NOT EXISTS ledger (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  bet_id text REFERENCES bets(id),
  amount integer NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS odds_cache (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
`;

let pool;
let schemaReady;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString, max: 3 });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

// Runs fn inside a transaction; fn gets a client whose queries all belong to it.
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function ensureSchema() {
  schemaReady ??= tx(async (c) => {
    // Serialize table creation so two cold starts don't race each other.
    await c.query('SELECT pg_advisory_xact_lock(724001)');
    await c.query(SCHEMA);
  }).catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return schemaReady;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
  schemaReady = undefined;
}
