---
title: "Dramble: the complete rebuild"
date: 2026-11-23T00:00:00+00:00
author: Devin Flake
layout: post
permalink: /dramble_full_rebuild/
tags: [kubernetes, k3s, homelab, longhorn, argocd, gitops, backups, resilience]
---

Dramble began as a four-Pi Kubernetes cluster running a frozen 2021 stack. By
2026-11-14 it was still serving the sites, but k3s 1.22.5 had been EOL since
2022, Longhorn was 1.2.3, Traefik was 2.5.6, two nodes had died, and `kube2` had
a stray server unit that had restarted **~1.58 million times** against an
abandoned kube-vip address. The honest options were roughly 25 supervised
upgrade hops, or a wipe and rebuild.

We rebuilt. Between 2026-11-14 and 2026-11-23 the cluster moved to a supported
stack, survived a control-plane migration, gained GitOps, sealed secrets,
network policy, pod disruption budgets, working alerting, and a bidirectional
backup arrangement. This is the whole story in one place; the individual posts
and runbooks remain the detailed record.

## 1. Why rebuild instead of upgrade

The pre-reimage state is preserved verbatim in
[cluster-status.md](https://github.com/flakeman2/raspberry-pi-dramble/blob/dev/docs/cluster-status.md).

| Component | Then | Now |
|---|---|---|
| k3s | `v1.22.5+k3s1` (EOL 2022-05) | `v1.36.6+k3s1` |
| Longhorn | `1.2.3` | `1.13.0` |
| MetalLB | `0.11.0` | `0.16.2` (CRD pool) |
| Traefik | `2.5.6`, chart `10.9.1` | `v3.7.19`, chart `42.4.1` |
| Prometheus | `2.31.1`, chart `15.1.3` | `3.16.0`, chart `29.47.2` |
| Grafana | `8.3.5`, chart `6.21.4` | `13.3.1`, chart `14.5.0` |

An in-place path meant 14 Kubernetes minor hops plus about 11 Longhorn hops,
each with a drain, replica rebuild and verification gate. A rebuild meant one
day of work and exercising the redeploy procedure end to end. The only
irreplaceable data was the static site content, and that was already
byte-identical to git. The decision was **rebuild, no rollback**.

## 2. A0 and A1 — preserve, then retarget

Before touching a disk, the preservation gate captured:

- the `mysite-content` document root as a tarball, byte-identical to
  `cluster/workloads/mysite/content/`;
- Traefik's `acme.json`;
- freshly rotated `authsecret` and `grafana` values, written only to an
  off-repo directory at mode `0600`;
- host state: `/etc/hosts`, netplan, firmware settings, node addresses and the
  router's reserved MetalLB range.

The repository was then retargeted to current versions (PRs #8, #9 and #12),
validated with `pluto` and `kubeconform` before any install script ran. The
plan, gates and in-place alternative are in
[upgrade.md](https://github.com/flakeman2/raspberry-pi-dramble/blob/dev/docs/upgrade.md).

## 3. A2 and A3 — wipe, install, restore

On 2026-11-15 all four disks were wiped and reinstalled with Ubuntu Server
26.04.1 LTS, kernel `7.0.0-1023-raspi`, cgroup v2 and netplan. k3s
`v1.36.6+k3s1` came up as one server plus three agents, all `Ready` within
minutes. The old kube2 double-unit bug disappeared by construction: the agent
installer disables any stray `k3s` unit.

Public traffic was parked behind an operator-run Caddy maintenance page on
`192.168.0.44` during the cutover. Let's Encrypt TLS-ALPN challenges could not
complete while that page fronted port 443, so certificate issuance waited until
the router was pointed back at MetalLB's `192.168.0.201` at about 03:20Z on
2026-11-16. Site content was restored byte-identically; all eleven hostnames
then in service received valid certificates (fourteen today).

### Five defects the rebuild surfaced

| # | Defect | Symptom | Fixed in |
|---|---|---|---|
| 1 | Chart 42 sets pod-level `runAsNonRoot`; the volume-permissions init container inherited uid 65532 and could not chown a root-owned volume | Traefik stuck `Init:Error` | #18 |
| 2 | Traefik v3 accepts one hostname per `Host()`; the v2 multi-host expression failed to parse | every multi-host route 404'd | #19 |
| 3 | `nfs-common` is required to mount RWX; I had wrongly removed it from the prerequisites | `mysite-content` stuck `ContainerCreating` | #20 |
| 4 | MetalLB v0.16 moved metrics to HTTPS `9120` with bearer-token RBAC | 5 Prometheus targets permanently down | #21 |
| 5 | Traefik's RWO `acme.json` deadlocks `RollingUpdate` (`maxUnavailable: 0` waits for a detach that never comes) | upgrades hung until a manual pod delete | #22 |

Two lessons from that table are worth keeping. Validating *field names* in a
migrated CR is not the same as validating *rule expressions*, and a documentation
"optimization" should be tested against the workload that actually needs the
package — `mysite-content` is RWX.

A4 exit criteria were met on 2026-11-16: all nodes `Ready`, five PVCs `Bound`,
volumes healthy with three replicas each, certificates valid, CronJobs
completing and docs updated. Host tuning followed on the same day: Wi-Fi and
Bluetooth disabled at firmware level and `arm_freq=2000` restored. The
dynamic-DNS provider enforces one password per domain, so the single shared
credential was replaced with a two-key `dyn-dns-credentials` Secret; both jobs
then returned `<ErrCount>0</ErrCount>` on all three records.

## 4. The cluster misbehaved anyway

Five days later the API was disappearing every ten to twenty minutes. On
2026-11-18, `kube1` had restarted k3s **17 times**. Pods kept serving, but
`kubectl` would stop answering for a minute at a time.

The obvious suspect was Argo CD, which had just put twelve Applications on
automatic sync with self-heal. Disabling automation was the right *first* move,
but the logs told the real story:

```
Slow SQL: DELETE ... name=Compact   duration=39.27s
level=fatal  msg="Transaction commit failed: sql: transaction has already been committed or rolled back"
```

k3s uses **kine** — SQLite translated into an etcd-shaped API — in process on
the server node. `kube1` is a 4 GB Pi with no swap, running the datastore,
Longhorn engine and monitoring stack on one disk. Measured at the time: **79%
iowait**, load 20–27 sustained, and both `longhorn-manager` and
`argocd-application-controller` stuck in D state. Argo's controller used about
1.6% of a core. It was a bystander.

The fix was to move the datastore, not to tune SQLite and definitely not to
delete Argo.

## 5. Control-plane migration

On 2026-11-21 the control plane moved from `kube1` (`192.168.0.61`) to
`dflake-nettop` (`192.168.0.44`), an always-on x86_64 machine with a fast disk.
It was installed as a **tainted** server so ordinary workloads stay on the Pis.
The embedded SQLite/kine datastore was restored from a consistent `state.db`
snapshot; a single-node etcd was evaluated and rejected because raft and fsync
work would sit on top of the same failed writes without addressing the cause.

Three details made the cutover safe:

1. only the API endpoint changed — `.61:6443` to `.44:6443`;
2. the public ingress address stayed `192.168.0.201`, because that is a MetalLB
   address and never moved;
3. the cluster CA and client certificates survived, so only the kubeconfig
   server URL needed editing.

A second, unrelated problem appeared immediately after the move: nettop's CPU
pegged at 99% while iowait was zero. `/metrics` showed **1,518 `PUT
longhorn.io/nodes` in 30 seconds, 1,430 of them `409 Conflict`** — a stale
informer retry loop after the datastore moved. Rolling-restarting
`longhorn-manager` and `longhorn-global-manager` one pod at a time cleared it:
zero conflicts, CPU back to 15–23%, all five volumes untouched. The Argo sync
holds were then lifted; all Applications returned to Synced/Healthy.

The full runbook is
[control-plane-migration-nettop.md](https://github.com/flakeman2/raspberry-pi-dramble/blob/dev/docs/control-plane-migration-nettop.md).

## 6. GitOps becomes the deployment path

Argo CD `v3.6.1` (chart `10.18.0`) was adopted in phases:

- **Phase 1** — pilot with `whoami` and manual sync; `argocd app diff` clean.
- **Phase 2** — workloads, dashboards and DNS as Applications, with sealed
  secrets. Four workloads were pinned to explicit tags in the same period
  (`nginx:1.31.8`, `traefik/whoami:v1.12.0`, `flakeman2/jekyll:sha-732b174`,
  `curlimages/curl:8.23.0`).
- **Phase 3** — add-ons as Helm Applications, then the root app-of-apps.
- **Phase 4** — kustomize/kubeconform/gitleaks CI gates and the Ephesus image
  pipeline.

Today the root Application owns a `dramble` AppProject and **fifteen child
Applications** — sixteen total — declared explicitly in
`gitops/kustomization.yaml`. There is no ApplicationSet at this scale. The root
uses the `default` project because it creates `dramble` itself, the AppProject
uses wave `-10`, and bootstrap files stay out of the build so Argo cannot manage
its own installer. Longhorn keeps `prune: false` and does not use
`ServerSideApply`; its CRDs own the volume records and there is no off-cluster
backup.

`master` was deleted on 2026-11-17. `dev` is both the default branch and what
Argo tracks, so a merge into `dev` *is* deployment. The one operational caveat:
Argo has on occasion been slow to notice a merge on its own. A hard refresh of
the root Application, followed where necessary by the relevant child,
reconciles it promptly.

### Sealed Secrets and CI

The repository is public, so plain `Secret` manifests cannot be committed.
Sealed Secrets won over SOPS: one controller in `kube-system`, four sealed
manifests in `cluster/secrets/sealed/`, no Argo plugin. The controller's private
key is backed up outside git at mode `0600`; losing it would make every sealed
secret unrecoverable.

CI deliberately holds no cluster credentials. It runs kustomize, kubeconform,
gitleaks and link checks. PR-Agent adds an advisory review using Google Gemini
on its free tier. The other half of "docs match reality" is
`scripts/verify-docs.sh`, which needs a kubeconfig and is therefore run locally;
it currently passes 18/18.

## 7. Network policy and disruption budgets

Flannel provides VXLAN transport; embedded kube-router enforces policy. Without
a NetworkPolicy the pod network is flat, so a compromised public-facing
container could reach Prometheus, Argo CD or the Longhorn API directly.

The first-party approach is one policy per namespace with `podSelector: {}`,
which gives default-deny plus an explicit allow-list in a single object:

- node IPs (`192.168.0.44`, `.61`–`.64`) for kubelet probes, iSCSI, NFS and
  webhook callbacks;
- the `traefik` namespace for proxied public traffic;
- the `monitoring` namespace for cross-namespace scrapes;
- DynDNS CronJobs get an egress-only policy allowing DNS (53) and HTTPS (443).

An independent audit later found that Longhorn's seven component policies left
the UI, CSI sidecars/plugin, `share-manager`, `global-manager` and
`engine-image-*` pods open to ingress from anywhere. A namespace-wide policy in
`longhorn-system` now allows same-namespace pods, the five node IPs, `traefik`
and `monitoring`. NetworkPolicy rules are additive, so Longhorn's existing rules
still apply to the pods they select. The manifest records one future caveat: a
host connecting directly to a *remote* pod IP would source from that node's
`flannel.1` address and would need adding if such a flow ever appears.

PodDisruptionBudgets came in the same hardening pass: fourteen total, eight
first-party. Jekyll uses `minAvailable: 2`, whoami `minAvailable: 1`, and six
single-replica workloads `maxUnavailable: 1`. Using `minAvailable: 1` on a
single replica would wedge every drain, which is the mistake this avoids.

Around the same time, Argo's controller CPU limit was raised from 500m to 1000m
after a ~457m spike made `/healthz` time out. Requests stayed at 100m.

## 8. Backups, honestly scoped

There are two backup directions, both using explicit file lists rather than
globs, SHA-256 verification printed only as PASS/FAIL, `0600` sources and a
`0700` remote directory:

| Direction | Mechanism | Payload |
|---|---|---|
| nettop → workstation | root stages with `stage-k3s-snapshot.sh`; dflake transfers with `backup-nettop.sh` | consistent `state.db` snapshot, node token, kubeconfig, `tls/`, `manifests/`, `SHA256SUMS` |
| workstation → nettop | `backup-secrets.sh` | sealed-secrets private key, ntfy topic, unified admin password, kubeconfig |

Splitting the first direction avoided granting dflake passwordless sudo: root
writes a dflake-owned staging tree with a `READY` marker written last, and
dflake's transfer script only ships trees that carry it. The first live run hit
the workstation's `ufw limit ssh` rule — the sixth new connection in 30 seconds
was rejected — so all remote calls now share one multiplexed SSH connection.

This is **not** off-site. Both machines are in the same house, on the same LAN
and power. It protects against losing one machine, not site loss. Longhorn's
`BackupTarget` remains unconfigured on purpose: three replicas cover node loss,
and every PVC holds either regenerable data or content already in git. GitHub
is the backup source for the Ephesus blog, so the blog source is covered by the
separate repository.

## 9. Where it stands on 2026-11-23

| Measure | Live value |
|---|---|
| Nodes | 5 Ready (`dflake-nettop` tainted server + kube1–kube4) |
| k3s | `v1.36.6+k3s1` |
| Namespaces | 12 |
| Workload pods | 66 (68 including two completed Job pods) |
| PVCs | 5 Bound |
| Argo Applications | 16, all Synced/Healthy |
| SealedSecrets | 4 |
| NetworkPolicies | 17 (7 Longhorn, 4 Argo CD, 6 first-party) |
| PDBs | 14 |
| ACME | 7 certificates covering 14 hostnames |
| Prometheus | 29 targets, 29 up, 0 down |

Prometheus needed one last nudge. Its pod predated the control-plane move, and
its in-process service discovery still pointed at the old `192.168.0.61`
endpoint even though the EndpointSlice and configuration were correct.
Restarting the pod refreshed discovery to `192.168.0.44`; all 29 targets came
up. No manifest change was needed.

Accepted risks remain accepted: one control-plane node, Longhorn volumes with
no off-cluster copy, no off-site backup, and no certificate-expiry alerts
because Traefik's ACME certificate is a file on a PVC rather than a Kubernetes
Secret.

## 10. What I would keep

The recurring lesson is that "it looks right" is not a verification strategy.

- Read the logs before blaming the new component; Argo was a bystander during
  the kine failure.
- Test migrated rule expressions, not just schema field names.
- Check the provider response body, not the Job status; Namecheap returns HTTP
  200 even when the password is wrong.
- Audit all real traffic sources before tightening policy; the NFS mount was
  sourced from a node IP, not the pod.
- Keep the docs executable. `verify-docs.sh` has caught drift between prose,
  manifests and the live cluster more than once.

The cluster is now boring in the best possible way. Merges deploy it, secrets
are sealed, alerts reach ntfy, drains are safe, backups are verified, and the
current-state docs agree with what is actually running.

## How this was written

A large part of the work described here was produced with AI assistance.
**MiMo-V2.6-Flash** (model ID `mimo-v2.6-flash`), running in OpenCode, did the
bulk of the implementation across the rebuild: writing manifests and workflows,
running validation suites, diagnosing failures, and drafting the earlier posts
in this series.

This consolidated write-up was drafted by **Big Pickle** (model ID
`opencode/big-pickle`) from the repository documentation, git history, verified
live checks and the existing Ephesus posts.

PR-Agent's advisory reviews used **Google Gemini 3.8 Flash**
(`gemini/gemini-3.8-flash`) with **Gemini 3.5 Flash Lite**
(`gemini/gemini-3.5-flash-lite`) as a free-tier fallback. PR-Agent's shipped
default, OpenAI's **GPT-6.1 Sol** (`gpt-6.1-sol`), was deliberately replaced
because it requires a paid key. Other model options evaluated but not used were
Groq-hosted models, OpenRouter `:free`, local Ollama open models and GitHub
Models, which retired on 2026-07-30.

**Devin Flake read and verified every claim against the cluster and the
repository before publishing.** The decisions to rebuild rather than upgrade,
to keep embedded SQLite rather than move to etcd, and to accept no off-cluster
Longhorn backup were mine; the measurements behind them were checked rather
than assumed.
