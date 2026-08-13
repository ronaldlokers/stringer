# stringer

Bots that file reports from a beat and post them to a room.

A stringer is a freelance correspondent who covers one beat and files copy to a
desk. That is what these are: one watches glucose, one watches Renovate, one
watches Alertmanager, and none of them know or care which room the copy ends up
in.

They used to live in [ronaldlokers/homelab](https://github.com/ronaldlokers/homelab)
as Python files mounted from a ConfigMap. That was a good arrangement — edit,
merge, and Flux had it running inside a minute — right up until the renderer
grew a hand-rolled PNG encoder and a glyph table baked by hand on a workstation,
all to satisfy a constraint that only existed because a ConfigMap script cannot
install anything.

Homelab still owns every manifest: the CronJobs, the NetworkPolicies, the
Secrets, the overlays. This repo owns the code and ships one image.

## Running one

```
stringer <desk>
```

| Variable | Meaning |
|---|---|
| `ROOM_URL` | where the copy goes: `campfire+https://…`, `ntfy+https://…`, or `stdout:` |
| `CAMPFIRE_URL` | the old name, still read, so rooms can migrate one desk at a time |
| `DIGEST_TIMEZONE` | which day "yesterday" means; default `Europe/Amsterdam` |
| `DIGEST_DATE` | report this day (`YYYY-MM-DD`) instead of yesterday |

With no room configured it prints to stdout, which is what a dry run is.

```
docker run --rm -e DIGEST_DATE=2026-03-29 ghcr.io/ronaldlokers/stringer:latest hello
```

## Desks

| Desk | Beat | State |
|---|---|---|
| `hello` | nothing; proves the wire and the zone database | shipped |
| `glucose` | Nightscout — the daily and fortnight sheets | not yet moved |
| `renovate` | dependency updates | not yet moved |
| `alerts` | Alertmanager webhooks | not yet moved |

## Working on it

```
npm install
npm test        # builds, then runs the suite
npm run typecheck
docker build -t stringer:dev .
```

Tests are `node:test` and types are `tsc` — nothing else, matching the code
they cover.

## Days are the point

Every boundary here is a local midnight, and two days a year are not 24 hours
long. Getting that wrong does not crash: without a zone database every day comes
out 24 hours, and the wrong day gets reported with a completely plausible face.

So the suite asserts that Amsterdam is two hours ahead in July, that 29 March
2026 is 23 hours and 25 October 2026 is 25 hours — and CI runs those same
assertions *inside the built image*, on the architecture it will run on. That is
the one check that catches a base image which quietly stopped shipping tzdata.

## Migration

The plan, its phases and what stays behind live in
[homelab's `docs/campfire/migration-to-stringer.md`](https://github.com/ronaldlokers/homelab/blob/main/docs/campfire/migration-to-stringer.md).
