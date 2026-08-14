/**
 * Reading from Postgres, for the beats whose subject lives in a database.
 *
 * Until now every beat was a `fetch` away from its data, and that was worth
 * keeping — one dependency, no drivers, no pools. Two subjects broke it:
 * CommaFeed's unread backlog and authentik's events, neither of which is
 * exposed by an API this cluster runs. The alternative was a service in front
 * of the database, which is more moving parts than a driver.
 *
 * Everything here is read-only by construction: the roles these beats connect
 * as have SELECT and nothing else, and that is enforced in the cluster rather
 * than by this file's good intentions.
 */

import postgres from "postgres";

import { withRetry } from "./retry.js";

/** One connection, used once, closed. A beat runs for seconds and exits. */
export async function reading<T>(
  url: string,
  work: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    // A beat that hangs on a query is worse than one that fails: the CronJob
    // would sit until its deadline with nothing to show.
    connection: { statement_timeout: 20_000 },
    onnotice: () => {},
  });
  try {
    // The pod's first outbound connection is refused — see `retry.ts`, which
    // measured it — and this is where every database beat made its first one.
    // All three of them posted "could not read", every scheduled run, with
    // `connect ECONNREFUSED` as the only evidence; the room got the apology
    // and never the digest.
    //
    // A `select 1` rather than a warm-up against some other address: it costs
    // one round trip, it proves the credential as well as the route, and by
    // the time `work` runs the connection it needs is already open.
    await withRetry(() => sql`SELECT 1`, { what: "postgres" });
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * A connection string built from the parts a Kubernetes Secret carries.
 *
 * CloudNativePG writes `username` and `password` into the role's Secret and
 * nothing else, so the host and database come from the workload's own
 * environment — which is also what keeps a password out of a URL in a manifest.
 */
export function urlFrom(environment: NodeJS.ProcessEnv, database: string): string {
  const host = environment.PGHOST?.trim() || "postgres-cluster-rw.database.svc.cluster.local";
  const port = environment.PGPORT?.trim() || "5432";
  const user = environment.PGUSER?.trim();
  const password = environment.PGPASSWORD?.trim();
  if (!user || !password) throw new Error("PGUSER or PGPASSWORD is unset");
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}
