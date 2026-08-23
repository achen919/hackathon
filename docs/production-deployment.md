# Production deployment

`.github/workflows/deploy-production.yml` deploys every commit pushed to `main`, including pull requests merged into `main`. It can also be started manually from `main`. Deployments are serialized and an in-progress production deployment is never cancelled by a newer push.

The workflow uses two separate GitHub-hosted runners. The `build` job has no environment or deployment secrets; it runs the locked install, type checks, server tests, frontend build, and full dependency audit. It rejects tracked or generated links and packages one archive with this contract:

```text
release.tar.gz
├── app/       # allowlisted runtime source from GITHUB_SHA plus RELEASE_SHA
└── static/    # dist/ produced from that checkout
```

The runtime-source allowlist is `README.md`, `deploy/`, `docs/`, `index.html`, `package-lock.json`, `package.json`, `public/`, `server/`, `src/`, `tsconfig.json`, and `vite.config.mjs`. Git metadata, Actions configuration, local environment files, dependencies, state, and an existing `dist/` can never enter `app/`.

The archive is uploaded atomically to `/home/hackdeploy/incoming/<SHA>/release.tar.gz`. The workflow then invokes only the fixed privileged entry point:

```text
sudo -n /usr/local/sbin/deploy-hackathon-chat <40-character-SHA> <64-character-SHA256>
```

The build archive and its validated public-asset manifest are transferred to the fresh `deploy` runner with immutable-SHA-pinned official artifact actions and one-day retention. The `deploy` job does not check out the repository or execute project code. Only its SSH step receives the private key, writes it into a temporary mode-0600 directory, and removes it on exit.

The tracked [`deploy/deploy-hackathon-chat`](../deploy/deploy-hackathon-chat) command validates both arguments, the archive digest, the embedded `app/RELEASE_SHA`, and safe archive paths before it performs an atomic release switch. It rejects absolute paths, `..` traversal, links and device nodes; serializes releases with a lock; and runs its server-side rebuild as the separate no-login/no-sudo `hackbuild` identity. A repeated healthy deployment of the same SHA is a no-op. The transaction preserves `/etc/hackathon-chat.env`, snapshots `/var/lib/hackathon-chat`, requires configuration readiness to match the pre-stop baseline, probes persisted carnival-state compatibility, and rolls application, static files, and state back together if loopback or public validation fails. It cleans successful uploads and retains only the newest five complete `auto-*` rollback triples without touching manual backups. Installation, SSH restrictions, and sudoers instructions are in [`deploy/README.md`](../deploy/README.md).

## GitHub configuration

Configure these repository or `production` environment values:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | Production SSH host |
| Variable | `DEPLOY_USER` | `hackdeploy` |
| Secret | `DEPLOY_SSH_KEY` | Dedicated private deployment key |
| Secret | `DEPLOY_KNOWN_HOSTS` | Pinned OpenSSH `known_hosts` line for the production host |

Generate `DEPLOY_KNOWN_HOSTS` only after verifying the server host-key fingerprint through a trusted channel. The workflow deliberately does not call `ssh-keyscan`, accept a changed host key, use the application password, or store any production environment value in its release archive.

The deployment key should belong only to the unprivileged `hackdeploy` account. Its sudo policy should allow the exact deployment program and no general-purpose privileged shell.

The required environment boundary is a `production` deployment policy that allows only `main`. As additional repository hardening, enable `main` branch protection and require the repository's CODEOWNERS review for deployment-workflow changes. If a separate pull-request CI workflow is added, make its check mandatory in the same branch rule.

After the server command succeeds, the workflow checks the public HTTPS health endpoint, confirms `/` references the current build's hashed assets, byte-compares those public assets with the local build, verifies `/carnival`, and confirms HTTP redirects to HTTPS.
