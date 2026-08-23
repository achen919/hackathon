# Production deployment hook

`deploy-hackathon-chat` is the fixed server-side half of the GitHub Actions
deployment hook. It accepts only a full commit SHA and an archive SHA-256:

```text
sudo -n /usr/local/sbin/deploy-hackathon-chat <40-hex-sha> <64-hex-sha256>
```

The corresponding archive path is always constructed by the script:

```text
/home/hackdeploy/incoming/<40-hex-sha>/release.tar.gz
```

The gzip tar archive has exactly two top-level trees:

- `app/`: repository source needed by `npm ci` and `npm run verify`, plus an
  `app/RELEASE_SHA` file containing the full SHA. It must not contain `.git`,
  `.github`, `.env*`, `data`, `dist`, `node_modules`, links, or special files.
- `static/`: the contents of CI's `dist/`, including `static/index.html`.

The server rebuilds the static bundle as the separate `hackbuild` user, which
has no login shell, incoming-directory access, or sudo rule. It uses an empty
inherited environment, a temporary HOME, `NPM_CONFIG_USERCONFIG=/dev/null`, and
a distinct root-owned empty `NPM_CONFIG_GLOBALCONFIG` (npm rejects loading
`/dev/null` twice), then compares the result byte-for-byte with `static/`. Root
only validates, copies, changes ownership, performs fixed-path swaps, and
controls systemd.

## One-time server installation

After reviewing the tracked files, install them from a trusted checkout rather
than from the writable upload directory:

```bash
install -o root -g root -m 0755 \
  deploy/deploy-hackathon-chat \
  /usr/local/sbin/deploy-hackathon-chat

install -o root -g root -m 0440 \
  deploy/hackathon-chat.sudoers.example \
  /etc/sudoers.d/hackathon-chat-deploy

visudo -cf /etc/sudoers.d/hackathon-chat-deploy
```

Create the isolated build identity once; do not add it to any privileged or
application group:

```bash
groupadd --system hackbuild
useradd --system --gid hackbuild --no-create-home --home-dir /nonexistent \
  --shell /usr/sbin/nologin hackbuild
```

The host must provide `node`, `npm`, Python 3, curl, GNU coreutils/tar tooling,
systemd, and util-linux (`flock`, `runuser`). The dedicated `hackdeploy` user
must not own application, static, state, systemd, nginx, environment, or script
paths. Its writable deployment surface is limited to its `incoming/` tree.
Prefix its `authorized_keys` entry with `restrict` to disable PTY, port, agent,
and X11 forwarding and user rc execution. Keep `.ssh/` and `authorized_keys`
root-owned (modes `0755` and `0644`) so `hackdeploy` cannot remove those key
restrictions. Keep `/home/hackdeploy/incoming` owned by `hackdeploy` at mode
`0700`. The `hackbuild` identity must have no sudo rule and no access to that
incoming tree.

## Activation and rollback

Before activation, the script gracefully stops `hackathon-chat.service` and
creates one coherent automatic rollback triple using the same strict identifier
under:

```text
/opt/hackathon-rollbacks/auto-<nanoseconds>-<sha12>
/var/www/hackathon-rollbacks/auto-<nanoseconds>-<sha12>
/var/lib/hackathon-rollbacks/auto-<nanoseconds>-<sha12>
```

Application and static paths are swapped on their respective filesystems. A
failed restart, changed configuration-readiness signature, persisted carnival
state incompatibility, public HTTPS check, public index comparison, or public
hashed-asset comparison restores application, static, and state together.
Transient public requests are retried before rollback. After a successful health
check, only the newest five complete automatic triples are retained. Existing
manual `rollback-pre-*` and `backup-pre-*` paths are outside the strict removal
pattern and remain untouched. Re-running the same already-healthy SHA exits
without creating another rollback triple.

Production secrets remain in `/etc/hackathon-chat.env`; mutable state remains in
`/var/lib/hackathon-chat`. Neither is copied into the app release or printed.
