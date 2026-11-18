---
title: "Dramble: GitOps goes live"
date: 2026-11-17T00:00:00+00:00
author: Devin Flake
layout: post
permalink: /dramble_gitops_live/
tags: [kubernetes, k3s, homelab, raspberry pi, gitops]
---

My last post ended with a promise: bootstrap Sealed Secrets, install Argo CD,
point it at `master`, and stop running `kubectl apply` by hand. All of that
happened — plus one thing I said I'd do that I ended up deleting instead.

![Argo logo](/assets/images/simpleicons-argo.svg "Argo CD")

## Argo CD, phase 1

Argo CD **3.6.1** (chart `10.18.0`) now runs in its own namespace, installed
from `gitops/bootstrap/` — the one step that has to stay imperative, because
Argo CD cannot install itself.

- Exposed at [argocd.devinflake.com](https://argocd.devinflake.com/) behind the
  same TLS-ALPN resolver as everything else.
- Single replicas everywhere, Dex off, notifications off, bundled Redis — four
  4 GB nodes do not have the headroom for an HA control plane, so every
  component got an explicit budget instead.
- The pilot: **`whoami`**, adopted with *manual* sync so the first
  `argocd app diff` could be read line by line. It came back empty, which is
  the whole point — no surprise mutations.

Phase 2 followed the same day: **`mysite-nginx`, `jekyll-website`,
`dashboards` and `dns`** are now Applications too, all five with automated
sync, self-heal and prune.

## One password, five surfaces

I got tired of five different credentials, so everything now shares one:

| Surface | Gate |
|---|---|
| Grafana | its own login |
| Prometheus | shared basic-auth |
| Longhorn | shared basic-auth |
| Traefik dashboard | shared basic-auth |
| Argo CD | bcrypt in the chart values |

Verified end to end rather than assumed: all five answer `200` with the one
credential, and a wrong password still gets `401`.

The Grafana part was the annoying one — it's a distroless image with no shell,
and its admin password lives in SQLite, so changing the environment variable
does nothing. It needed `grafana cli admin reset-admin-password`. Then its
`ReadWriteOnce` PVC deadlocked the rollout: the surge pod could not attach a
volume the old pod still held, and the old pod would not die until the new one
was ready. Same bug Traefik's `acme.json` had. Fixed with `Recreate`.

## Sealed Secrets

Three credentials — `authsecret`, `grafana`, `dyn-dns-credentials` — are now
committed to a **public repository** as SealedSecrets. The controller runs in
`kube-system` from a vendored `v0.41.2` release manifest (the Helm chart's
repository URL returns 404 now).

Two things worth recording, because both would have bitten me later:

1. **A rebuild mints a new key, which cannot unseal anything already in git.**
   The install script now restores the key backup *before* starting the
   controller, while there is still no competing key.
2. **The controller refuses to take over a Secret it does not own.** It fails,
   retries for about fifteen seconds, then gives up — and deleting the Secret
   afterwards does not wake it up. The working sequence is: delete the
   SealedSecret, delete the Secret, re-apply the SealedSecret.

And the gap during migration matters more than it looks. Deleting `authsecret`
did not merely disable basic-auth — Traefik could not resolve the middleware's
Secret, so it **dropped the router entirely**. Longhorn, Prometheus and the
Traefik dashboard returned `404`, not `401`, while Grafana and the blog kept
working, which made it look like an isolated problem when it wasn't.

## CI: a bad manifest cannot merge

![GitHub Actions logo](/assets/images/simpleicons-githubactions.svg "GitHub Actions")

Four independent jobs on every pull request:

- **Manifests** — `kubeconform -strict` over the raw manifests, all four Helm
  charts rendered at their pinned versions, and every Kustomize build.
- **Secrets** — `gitleaks` across the *whole history*, not just the diff.
- **Docs** — links, in-page and cross-file anchors, reference links.
- **Workflows** — `actionlint`.

Chart versions are read out of the files that install them, so CI cannot drift
from the install path.

It earned its keep immediately. The first run found **three leaks** — MySQL
passwords from Jeff Geerling's 2018 Drupal demo in the inherited upstream
history, in a file deleted years ago. Allowlisted by commit rather than by
path, so a future file with that name carrying a real credential is still
caught.

And it failed on my own PR: `actionlint` reported a shellcheck warning I could
not reproduce locally, because **actionlint only runs shellcheck when
shellcheck is installed** — my machine did not have it, so my "clean" result
had been skipping an entire class of findings.

## Fewer moving parts

Three things got *removed* rather than added:

- **The Longhorn manifest is vendored.** The rebuild path used to fetch
  238 KB of cluster-admin YAML over the network while installing *storage*.
  Now it is in the repo — and `kubectl diff` against the live cluster exited
  zero with no output before I committed it, so applying it is provably a
  no-op.
- **The `master` branch is gone.** Argo CD tracks `dev`, the default branch,
  so a merged pull request *is* the deployment target. No promotion step. That
  also removed the second merge every blog post needed before going live.
- **Floating image tags are pinned.** `nginx:latest` → `nginx:1.31.8`,
  `traefik/whoami` → `v1.12.0`, chosen by matching the *running* container's
  index digest against the registry so pinning changed nothing content-wise.

## Verification as a habit

The docs kept claiming things I had stopped checking, so I wrote
`scripts/verify-docs.sh`: seventeen assertions against the live cluster —
object counts, hostnames versus routes, a certificate probe for every
hostname, chart pins versus live releases, sealed-secret sync state, image
tags, and that Argo CD tracks the default branch.

It found real drift on its first run: adding Sealed Secrets had pushed pods
`65 → 66` and the documented totals still said 65.

![Kubernetes logo](/assets/images/simpleicons-kubernetes.svg "The cluster the docs are checked against")

The static half — links and anchors — runs in CI. The live half needs a
kubeconfig, so it stays local on purpose: CI should not hold cluster
credentials.

## How this was written

A large part of this work was produced with AI assistance. The agent used was
**MiMo-V2.6-Flash** (model ID `mimo-v2.6-flash`), running in OpenCode, and it
did the bulk of the implementation: writing the manifests and workflows,
running the validation suites, diagnosing failures, and drafting this post.

**I read and verified all of it myself before publishing.** Every claim here —
the versions, the counts, the failure modes, the exit codes — was checked
against the cluster and the repository rather than taken on trust. Where the
agent was wrong, I made it fix the work: the shellcheck gap above, a slugifier
that disagreed with GitHub, and a `cut` that silently produced an empty tag
are all examples of errors that were caught by running the checks rather than
by reading the code.

That last point is the real lesson. The tooling in this post exists because
"it looks right" is not a verification strategy — for either of us.

## Next

Sealed Secrets closed the phase-2 blocker, so the remaining work is phase 3
(addons as Argo Applications, Argo CD managing itself) and the resilience gaps:
Longhorn has no off-cluster backup target, Grafana still has zero dashboards,
and Alertmanager has nowhere to send alerts.

The full state lives in
[the repo's cluster status](https://github.com/flakeman2/raspberry-pi-dramble/blob/dev/docs/cluster-status.md).

---
*Logos in this post are from [Simple Icons](https://simpleicons.org), released
under [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md);
they remain trademarks of their respective owners and are used here to refer to
the projects discussed. See [`assets/images/CREDITS.md`](https://github.com/flakeman2/Ephesus/blob/master/assets/images/CREDITS.md).*
