# Hosting Harvest Hollow in the cloud (multi-farm mode)

One container, one persistent volume, one public URL. Everyone who opens the URL can start their own farm in one
tap (no account), invite one friend with a one-time link, and come back later with their personal link. A farm
nobody visits for 7 days is deleted. This is `HH_MODE=multi`; the default single-farm mode (the LAN game, the
systemd unit in `deploy/harvest-hollow.service`) is unchanged.

## The image

```sh
docker build -t harvest-hollow .
docker run -p 3000:3000 -v hh-data:/data harvest-hollow      # http://localhost:3000
```

- `node:24-slim`, production dependencies only (`npm ci --omit=dev`), only `server/`, `shared/`, `public/` and the
  package files are copied (`.dockerignore` is an allow-list: saves, art sources, tests and docs never enter it).
- Every farm lives on the volume at `/data/farms/<id>/` (snapshot, journal, a few backups, `farm-meta.json`).
- The game runs as the unprivileged `node` user (uid 1000). The entrypoint starts as root only to hand a fresh
  root-owned cloud volume to that user (`chown` when `/data` is not already owned by uid 1000), then drops to it.
- Health check: `GET /api/status` (global counts only, never a farm id). It is `ok: false` (HTTP 200 with a body)
  when a farm is degraded or a save fails; the Docker `HEALTHCHECK` only checks that it answers.
- `SIGTERM` (a redeploy, a restart): every loaded farm closes its sockets and writes its final snapshot. Give the
  platform at least 10 seconds of stop timeout (measured: 0.3 s with 100 loaded farms on an SSD).
- **Run exactly one instance.** Farms live in this process's memory and on one volume; two instances would serve
  two different copies of a farm. Scale up (more memory), never out.

## Environment

| Variable | Default (image) | What it does |
|---|---|---|
| `PORT` | `3000` | The HTTP port. Railway and Render set it; Fly uses `internal_port`. |
| `HH_MODE` | `multi` | `multi` = this hosted mode. `single` = one farm, the LAN game. |
| `HH_DATA_DIR` | `/data` | Where the farms live. Mount the volume here. |
| `HH_MAX_FARMS` | `500` | Farms stored at once. Above it, "Start a new farm" shows "we are full". |
| `HH_FARM_TTL_DAYS` | `7` | A farm with no player connected for this many days is deleted (the sweep runs hourly; days the host itself was down do not count). |
| `HH_MAX_LOADED` | `64` | Farms kept in memory at once (least recently used idle farms are unloaded first). |
| `HH_FARM_IDLE_MS` | `600000` | A farm with no open socket for this long (10 min) is saved and unloaded. |
| `HH_CREATE_PER_HOUR` / `HH_CREATE_PER_DAY` | `5` / `20` | New farms per client address. |
| `HH_WS_PER_IP` | `16` | Open game sockets per client address, all farms together. |
| `HH_TRUST_PROXY` | `1` | Reverse proxies in front of the server. Railway, Fly and Render have exactly one: keep `1`. Set `0` only when the container is reached directly (then X-Forwarded-For is ignored). |
| `HH_BACKUP_HOURS` / `HH_BACKUP_DAYS` | `3` / `3` | Backups kept per farm (the newest of each of the last N hours / days). |
| `HH_TZ` | container zone (UTC) | The calendar zone of a farm whose creator's browser did not send one (`POST /api/farms { tz }`). |
| `HH_LOG` | `json` | One JSON object per log line. No request logging; keys, farm ids and full client addresses are never logged (an abuse warning names the /24 or /48 network only). |
| `HH_ADMIN_TOKEN` | unset | Turns on the ideas admin routes (`/api/admin/ideas`, see "Ideas from players"). At least 24 characters, e.g. `openssl rand -hex 32`; a shorter one leaves them off. Unset: those routes answer 404. |
| `HH_IDEAS_PER_DAY` | `200` | Ideas accepted in any 24 hours, from everyone together (on top of 5 an hour and 20 a day per address). |
| `HH_DELETE_PER_HOUR` | `10` | "Delete this farm now" requests per client address an hour. |
| `HH_STARS_URL` | GitHub API | Where the server asks for the landing page's GitHub star count (at most once an hour; visitors' browsers never call GitHub). `off` = no count. |

Never set `HH_DEV=1` in production (time-warp and other test routes, loopback only). With `NODE_ENV=production`
(the image sets it) the server refuses to start in multi mode when `HH_DEV=1` is set: behind a reverse proxy on the
same machine every visitor would look like loopback to those routes.

## Security notes

- Keys: farm ids are 12 base32 characters (60 bits), member secrets 256 bits and invite tokens 128 bits, all from the
  OS random source. Only their SHA-256 hashes are stored, and they are compared in constant time. No key, invite or
  farm id is written to any log line: a farm appears as `farm=<8 hex>`, a hash of its id, and every host log line is
  redacted, an uncaught error's stack included.
- URLs: the personal link's key is a `#k=` fragment, which browsers never send. The landing page keeps the creator's
  secret in the device's storage, not in the address. The invite's `?join=` is in the query by design (it is the
  link). Pages answer `Referrer-Policy: same-origin`, so that query never leaves in a Referer header.
- No enumeration: no route lists farms. `/f/<any well-formed id>` serves the same page whether the farm exists or not.
  `GET /api/f/:id/*` and the socket handshake share one budget of 120 lookups a minute per address, so guessing a
  60-bit id is hopeless.
- Limits per address: 5 new farms an hour and 20 a day, 30 invites an hour, 16 open sockets. There is also the global
  `HH_MAX_FARMS` cap. State-changing requests from another site's page are refused (`Origin` check).
- `HH_TRUST_PROXY=1` takes the client address from the entry the platform's proxy appends to `X-Forwarded-For`.
  When the container is reached **directly** (no proxy, e.g. a plain `docker run -p` on a public machine), a client
  could put any address there and dodge the per-address limits, so set `HH_TRUST_PROXY=0` in that case.

## Railway

1. New project -> Deploy from the GitHub repo. Railway finds the `Dockerfile`.
2. Add a **Volume** to the service, mount path `/data` (1 GB is plenty for 500 farms, see the budget below).
3. Variables: nothing is required. Optional: `HH_MAX_FARMS`, `HH_TZ`.
4. Settings -> Networking -> Generate Domain. Settings -> Deploy -> Healthcheck Path: `/api/status`.
5. Keep **Replicas = 1** (a volume can be attached to one replica only anyway).

## Fly.io

```toml
# fly.toml
app = "harvest-hollow"
primary_region = "fra"
kill_timeout = 30

[build]
  dockerfile = "Dockerfile"

[mounts]
  source = "hh_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"     # sockets stay open; a stopped machine drops every player
  min_machines_running = 1

  [[http_service.checks]]
    method = "GET"
    path = "/api/status"
    interval = "30s"
    timeout = "5s"
    grace_period = "30s"

[[vm]]
  memory = "512mb"
```

```sh
fly launch --no-deploy        # keep the fly.toml above
fly volumes create hh_data --size 1 --region fra
fly deploy
fly scale count 1
```

## Render

1. New -> Web Service -> the repo; Runtime **Docker**.
2. Add a **Disk**: mount path `/data`, 1 GB (disks need a paid instance type).
3. Health Check Path: `/api/status`. Instances: 1.
4. Render sets `PORT`; nothing else is required.

## Memory and disk budget (measured 2026-10-05, Node 24, `.scratch` scripts of the server lane)

Lead check in the image itself (2026-10-05): the image is 489 MB on disk (node:24-slim is 332 MB of that; the game's
files are 70 MB and its production dependencies 31 MB), about 130 MB compressed. The container's RSS sat at 157-163 MB
with one farm or with 60 newly created farms loaded, so a new farm stays under the noise of the garbage collector
(the server lane's heap numbers below are the precise ones).

| What | Heap | RSS |
|---|---|---|
| The process, booted, no farm loaded | 15.5 MB | ~115 MB |
| ... plus every game file served once (283 modules and asset packs, gzip cache) | | ~220 MB |
| Per loaded farm, busy level 30 (282 objects, 85 KB save) | ~270 KB | ~0.85 MB |
| Per loaded farm, new | ~31 KB | ~0.34 MB |
| Per stored (unloaded) farm: its index entry | < 10 KB | |
| 1,200 load/unload cycles of one busy farm | no growth | |
| Waking a sleeping busy farm (load, catch-up, snapshot) | ~25 ms | |

| Disk per farm | |
|---|---|
| New farm (snapshot, meta, first backup) | ~14 KB |
| Busy level 30 farm (85 KB snapshot + backups) | ~95 KB, up to ~200 KB with all 6 backups |

So a **512 MB** container holds the default 64 loaded farms with room to spare (~220 MB + 64 x 0.85 MB = ~275 MB);
on **1 GB** raise `HH_MAX_LOADED` to 200-300. 500 stored farms need at most ~100 MB of volume.

## Caching and a CDN

The game page (`/f/<id>`) and the landing page (`/`) are `no-cache` with an ETag. Every module, stylesheet and asset
pack is requested with a content hash (`?v=<hash>`) and answered `Cache-Control: public, max-age=31536000, immutable`,
so a platform CDN in front of the container can cache them safely; a new deploy changes the hashes. Nothing under
`/api/` or `/ws` is cacheable.

## Ideas from players

The landing page and the game's "Suggest an idea" (More menu, Settings) post to `POST /api/ideas`. Each idea is one
line of `<HH_DATA_DIR>/ideas/ideas.jsonl` on the volume (0600): an id, the time, the category, the text, the optional
name and contact, the farm id when it came from inside a farm, the language and the browser family ("Safari on iOS").
No address is stored: the per-address limits key on a salted hash kept in memory only. A filled honeypot field is
answered like a success and dropped. Text is plain text, never rendered as HTML.

Review them with `GET /api/admin/ideas?status=new|all` and `POST /api/admin/ideas/<id> { "status": "liked", "note": "…" }`
(statuses `new liked planned done declined`; each change is a line of `ideas/status.jsonl`, append-only), with
`Authorization: Bearer <HH_ADMIN_TOKEN>`. Ten wrong tokens from one address in 15 minutes lock that address out for
the rest of the window. `tools/ideas.mjs` does all of this from a terminal (the token from a 0600 file).

## Privacy

`/privacy` (public/privacy.html, English and Bulgarian) tells players what is kept, why and for how long; keep it true
when the code changes (test/privacy-page.test.js ties its numbers to the code). In short:

- Ideas and privacy requests older than 365 days are deleted by the hourly sweep. `DELETE /api/admin/ideas/<id>`
  removes one idea for good (both files rewritten atomically).
- The page's form posts `POST /api/privacy` (what: delete my idea, a farm I lost access to, a copy of my data,
  something else; a description; an optional contact) to `<HH_DATA_DIR>/privacy/requests.jsonl` (0600, no address, no
  browser). `node tools/ideas.mjs list` shows open requests first; `privacy`, `privacy done <id>`, `delete <idea>` and
  `delete-farm <farm id or address>` (`DELETE /api/admin/farms/<id>`) answer them. Answer within one month.
- "Delete this farm now" (Settings > Farm, any farmer): `POST /api/f/<id>/delete`; the folder, backups included, goes
  at once and every open screen is told.
- The platform keeps its own request logs (on Railway: time, path, client IP, user agent) under its own retention;
  the page says so.

## Operating it

- `GET /api/status`: `farms.stored`, `farms.loaded`, `farms.connections`, `farms.online`, `farms.created`,
  `farms.deleted`, `degraded`, the timing summary (`perf`). No farm ids.
- A farm that will not load (a corrupt journal) is logged with its tag (`farm=<8 hex>`, a hash of the id, never the
  id) and the files are kept in that farm's `incidents/` folder; the other farms are not affected.
- Backups: each farm keeps its own few backups on the volume; for disaster recovery use the platform's volume
  snapshots.
