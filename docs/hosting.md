# Hosting runbook

Wardenfall is one static `index.html`, so hosting is just nginx serving a git checkout. There is no build step, no app process and no server-side state.

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

Each nginx site:
- serves files with `Cache-Control: no-cache`, so a refresh always picks up a deploy;
- returns 403 for `.git/`, `deploy/` and `docs/`, because the web root is the repo;
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
| Game loads but overlays are stacked or stuck | Usually an artifact-viewer assumption (see Things to know). Reproduce on a slot, check the browser console, and look for CSS overriding `hidden`. |
