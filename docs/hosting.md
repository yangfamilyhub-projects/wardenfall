# Hosting runbook

Wardenfall is one static `index.html`, so hosting is mostly nginx serving a git checkout. There is no build step and no server-side game state. The one app process is the small multiplayer relay (`server/relay.js`), which only passes messages between players' browsers.

## What runs where

| Site | URL | Checkout | Serves |
|------|-----|----------|--------|
| prod | https://wardenfall.zizzy.name | `/var/www/wardenfall` | `main` only |
| wf1 | https://wf1.zizzy.name | `/var/www/wardenfall-slots/wf1` | any branch |
| wf2 | https://wf2.zizzy.name | `/var/www/wardenfall-slots/wf2` | any branch |
| wf3 | https://wf3.zizzy.name | `/var/www/wardenfall-slots/wf3` | any branch |
| wf4 | https://wf4.zizzy.name | `/var/www/wardenfall-slots/wf4` | any branch |

- **Server:** the DigitalOcean droplet at `64.23.241.90`, shared with Otto and the other `*.zizzy.name` sites.
- **DNS:** one A record per site in the `zizzy.name` domain on DigitalOcean, managed with `doctl`.
- **nginx:** one site per deployment in `/etc/nginx/sites-available/` (`wardenfall`, `wardenfall-wf1` … `wardenfall-wf4`), symlinked into `sites-enabled/`. The template is [`deploy/nginx-site.conf`](../deploy/nginx-site.conf).
- **TLS:** Let's Encrypt via `certbot --nginx`. Prod has the cert `wardenfall.zizzy.name`; the four slots share the cert `wardenfall-slots`. certbot's systemd timer renews them.
- **Branch switching:** [`deploy/wardenfall-slot`](../deploy/wardenfall-slot), installed as `/usr/local/bin/wardenfall-slot`.
- **Multiplayer relay:** `server/relay.js`, installed in `/opt/wardenfall-relay` and run by the systemd unit `wardenfall-relay` on `127.0.0.1:3410`. Each nginx site proxies `/mp` to it. See [Multiplayer relay](#multiplayer-relay).

Each nginx site:
- serves files with `Cache-Control: no-cache`, so a refresh always picks up a deploy;
- returns 403 for `.git/`, `deploy/`, `docs/` and `server/`, because the web root is the repo;
- proxies the WebSocket path `/mp` to the multiplayer relay;
- on the test slots only, sends `X-Robots-Tag: noindex` so search engines skip them.

## Everyday tasks

All commands run as root on the droplet.

### See what's deployed

```
wardenfall-slot
```

This prints a table: each site, its URL, the branch it tracks and the commit it's on.

### Test a branch

Push the branch to GitHub, then point a free slot at it:

```
wardenfall-slot wf2 my-feature
```

To pick up later pushes to the same branch, run it without the branch name:

```
wardenfall-slot wf2
```

- The slot remembers its branch in `.git/SLOT_BRANCH`.
- Checkouts are detached at `origin/<branch>`, so force-pushes and rebases are fine.
- The branch must exist on `origin`; local-only branches fail with `no branch origin/...`.

Claim a slot by telling the team which one you're using. Run `wardenfall-slot` first to see what's in use. Point a slot back at `main` when you're done:

```
wardenfall-slot wf2 main
```

### Deploy to production

Merge to `main` on GitHub, then:

```
wardenfall-slot prod
```

Prod refuses any branch other than `main`.

### Roll back production

Preferred: revert the bad commit on `main`, push, then run `wardenfall-slot prod`. That keeps git history and the live site in agreement.

In an emergency, pin prod to a known-good commit directly:

```
git -C /var/www/wardenfall checkout -q --detach <good-sha>
```

The next `wardenfall-slot prod` moves it back to the tip of `main`, so revert on `main` before running it again.

## Multiplayer relay

Whoever starts a fight hosts it: their browser runs the boss and streams it to everyone else. The relay only keeps a list of open fights and forwards messages, so it holds no game rules. That means it rarely needs updating, and test branches can change the multiplayer protocol without touching it.

- **One relay for every site.** Fights are listed per site (by the `Host` header), so prod players never see wf1 fights and two branches on different slots never mix.
- **Limits:** 4 players per fight, 40 open fights per site, 64 KB per message, about 90 messages a second per player. Browsers from origins other than `*.zizzy.name` and localhost are refused.
- **Logs:** `journalctl -u wardenfall-relay`.
- **When the relay is down,** solo play is unaffected. "Join a fight" says it can't reach the server, and fights simply aren't listed.

### Install or update the relay

From a checkout that has the version you want (usually prod after a merge):

```
rsync -a --delete --exclude node_modules /var/www/wardenfall/server/ /opt/wardenfall-relay/
(cd /opt/wardenfall-relay && npm ci --omit=dev)
install -m 644 /var/www/wardenfall/deploy/wardenfall-relay.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now wardenfall-relay
systemctl restart wardenfall-relay   # when updating; open fights are dropped
```

### Add `/mp` to a site

Copy the `location = /mp { ... }` block and the `server` entry in the deny rule from [`deploy/nginx-site.conf`](../deploy/nginx-site.conf) into that site's file in `/etc/nginx/sites-available/`, then `nginx -t && systemctl reload nginx`. A site without it still serves the game, but multiplayer is unavailable there.

Check it end to end. This should print `101`:

```
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: https://wf1.zizzy.name' https://wf1.zizzy.name/mp
```

### Test multiplayer locally

```
(cd server && npm ci && PORT=3499 node relay.js)
```

Then serve `index.html` with any server that proxies WebSocket upgrades on `/mp` to port 3499. Open two browser windows: start a fight in one and join it from the other.

## Things to know

- **Saved progress is per browser and per site.** The Warden's memory is stored in `localStorage`, which browsers keep separately for each origin. Prod and each slot have their own memory, and nothing is shared between players or devices. Use the in-game "Wipe boss memory" button to reset it.
- **Don't use `git pull` in the checkouts.** They're detached, so `git pull` errors out. Use `wardenfall-slot`.
- **Don't edit files on the server.** `wardenfall-slot` force-checks-out the branch and discards local edits. Push changes through git.
- **The game began as a Claude artifact.** The artifact viewer supplied things a plain browser doesn't. For example, the viewer hid elements with the `hidden` attribute even though the game's CSS overrode it. That caused a "stuck on Paused" bug, fixed by the `[hidden]{display:none!important}` rule. The code also checks for `window.claude.hot`, which doesn't exist outside the viewer and falls back safely. Test changes on a slot in a real browser, not only in the artifact viewer.

## Setup from scratch

Use these steps to rebuild on a new server or add a slot. The example adds `wf5`; for prod, use the host `wardenfall.zizzy.name` and the checkout `/var/www/wardenfall`.

1. **DNS.** `doctl` must be logged in. `doctl auth init` needs a real terminal, so run it over SSH.
   ```
   doctl compute domain records create zizzy.name --record-type A \
     --record-name wf5 --record-data 64.23.241.90 --record-ttl 3600
   dig +short @1.1.1.1 wf5.zizzy.name    # wait until this prints the IP
   ```
2. **Checkout.**
   ```
   git clone https://github.com/yangfamilyhub-projects/wardenfall.git /var/www/wardenfall-slots/wf5
   ```
3. **nginx site.**
   ```
   sed -e 's|HOST|wf5.zizzy.name|' -e 's|ROOT|/var/www/wardenfall-slots/wf5|' \
     /var/www/wardenfall/deploy/nginx-site.conf > /etc/nginx/sites-available/wardenfall-wf5
   ln -s /etc/nginx/sites-available/wardenfall-wf5 /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
   For prod, delete the two `X-Robots-Tag` lines.
4. **TLS.**
   ```
   certbot --nginx -d wf5.zizzy.name --redirect --non-interactive
   ```
5. **Slot script.** Install or update it from the repo:
   ```
   install -m 755 /var/www/wardenfall/deploy/wardenfall-slot /usr/local/bin/wardenfall-slot
   ```
   For a new slot, widen the `wf[1-4]` pattern in `dir_for()` and add the slot to the `status()` loop. Commit that change to the repo too.
6. **Verify.**
   ```
   curl -sI https://wf5.zizzy.name/ | head -1                                       # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://wf5.zizzy.name/.git/config      # 403
   ```

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| 404 straight after adding a site | nginx was still reloading. Wait a few seconds and retry. |
| Old version still showing | The slot isn't on the commit you expect. Check `wardenfall-slot`, then re-run it for that slot. Hard-refresh the browser if needed. |
| `no branch origin/x` | The branch isn't pushed, or the name has a typo. |
| `git pull` says "not currently on a branch" | Expected: the checkouts are detached. Use `wardenfall-slot`. |
| Certificate expired or warning | Run `certbot renew --dry-run` and check `systemctl list-timers \| grep certbot`. |
| New subdomain doesn't resolve | Check `doctl compute domain records list zizzy.name` and query DigitalOcean directly with `dig @ns1.digitalocean.com <host>`. |
| "Couldn't reach the multiplayer server" | Check `systemctl status wardenfall-relay`, and that the site's nginx file has the `/mp` block. |
| Teammates freeze, or the boss stops for everyone | The host's tab was hidden or their device slept; browsers pause hidden tabs. The fight resumes when the host comes back. |
| Game loads but overlays are stacked or stuck | Usually an artifact-viewer assumption (see Things to know). Reproduce on a slot, check the browser console, and look for CSS overriding `hidden`. |
