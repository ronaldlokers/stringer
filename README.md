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
stringer <beat>
```

| Variable | Meaning |
|---|---|
| `ROOM_URL` | where the copy goes: `campfire+https://…`, `ntfy+https://…`, or `stdout:` |
| `CAMPFIRE_FLUX_URL` | second destination for the `alerts` beat's `/flux` route |
| `CAMPFIRE_BRIEFING_URL` | where a cluster with no room of its own files, via `/briefing` and `/check` |
| `CAMPFIRE_CHECK_URL` | a room for `/check` alone, when findings should not sit with the briefing |
| `GRAFANA_BASE` | where a silence link points |
| `LISTEN_PORT` | for `alerts`, default 8080 |
| `CAMPFIRE_URL` | the old name, still read, so rooms can migrate one beat at a time |
| `DIGEST_TIMEZONE` | which day "yesterday" means; default `Europe/Amsterdam` |
| `DIGEST_DATE` | report this day (`YYYY-MM-DD`) instead of yesterday |
| `GITHUB_TOKEN` | read access to pull requests, for the `renovate` beat |
| `GITHUB_REPO` | `owner/name`, default `ronaldlokers/homelab` |
| `PROMETHEUS_URL` | for `speedtest`, default the 400-day speedtest instance |
| `PLAN_DOWN_MBPS` | what the line is sold as, default 1000; `PLAN_UP_MBPS` likewise |

With no room configured it prints to stdout, which is what a dry run is.

```
docker run --rm -e DIGEST_DATE=2026-03-29 ghcr.io/ronaldlokers/stringer:latest hello
```

## Beats

| Beat | Covers | State |
|---|---|---|
| `hello` | nothing; proves the wire and the zone database | shipped |
| `glucose` | Nightscout — the daily and fortnight sheets | statistics and renderer ported; the beat itself is next |
| `renovate` | dependency updates left open, and which are not routine | shipped |
| `alerts` | Alertmanager and Flux webhooks; long-running | shipped |
| `briefing` | the cluster at 07:00, or silence | shipped |
| `speedtest` | the week's connection against what it is sold as; Sundays | shipped |
| `status` | answers `@Kubernetes status` and its siblings; long-running | shipped |

## Working on it

```
npm install
npm test        # builds, then runs the suite
npm run typecheck
docker build -t stringer:dev .
```

Tests are `node:test` and types are `tsc` — nothing else, matching the code
they cover.

## How it is laid out

A reporter works a **beat** and files **copy**; the copy goes out on a **round**.

```
src/beats/      one entry point per beat; what the CronJob runs
src/copy/       what gets written about a beat, and the sums behind it
src/desks/      inbound: a question arrives and is answered
src/press/      the house style, an SVG builder, and font metrics
src/press/<beat>/  what that beat's sheets look like
src/rounds.ts   delivery: campfire, ntfy, stdout
src/numbers.ts  arithmetic and formatting every beat shares
src/time.ts     local days, and the two a year that are not 24 hours long
```

A **round** carries copy out; a **desk** takes a question in. Campfire's desk is
the sharper of the two: it delivers a mention by POSTing to a callback URL and
treats the *response body* as the reply, so the bot holds no key at all and has
seven seconds before Campfire posts its own failure notice. A desk without that
contract receives, then posts.

A round is `say`, `show` and `amend`. Amending is optional in effect: where a
transport cannot change what it already delivered, it posts anew and hands back
the new handle, so a beat never has to ask which happened. It matters where it
exists — Campfire's update does not notify, which is exactly what a resolved
alert should do — and degrades honestly where it does not.

[DESIGN.md](DESIGN.md) records the visual system the press draws to — palette,
type, composition, and what it refuses. It moved here with the renderer; a
specification belongs in the repository that holds an implementation of it.

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
