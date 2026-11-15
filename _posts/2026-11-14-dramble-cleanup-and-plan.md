---
title: "Dramble: cleanup and a plan"
date: 2026-11-14T00:00:00+00:00
author: Devin Flake
layout: post
permalink: /dramble_cleanup_and_plan/
tags: [kubernetes, gitops, homelab, raspberry pi]
---

It's been a while.  My last post here was February 2022, and the
[Raspberry Pi cluster](https://www.pidramble.com/) that runs this blog has been quietly humming along ever since.
I spent today giving it a proper audit, and since the results were better *and* worse than I expected, I figured it was worth writing down.

## Cleaning house

Two nodes had gone dark over the years — `rpi-argon` and `rpi-retropie`.  Neither had been reachable for a while, so I removed them from the cluster.
We're down to four Pis — `kube1` through `kube4` — and everything on them checks out: 64 pods, all 15 Longhorn replicas running, and 23 Prometheus targets with nothing down.

A few leftovers were less charming:

- `kube2` was running **both** `k3s.service` and `k3s-agent.service`.  The server unit has been restarting for years against a kube-vip virtual IP I had abandoned — roughly 1.58 million restarts ago.
- The dynamic DNS CronJobs still carry the DNS provider's password inline in the manifest.  The repo has a proper Secret for it; the live cluster never got the message.
- The `pi-hole` Service is an `ExternalName` pointing at a host that doesn't answer anymore.

## Can we still rebuild it?

That was the question I really wanted answered, for both sites.

**The landing page** turned out to be easy.  Its 1 GiB PVC holds 88,877 bytes of HTML and favicons, and every file is md5-identical to the copy checked into the repository.  Nothing is at risk and there is nothing to rebuild — except that nothing seeds the PVC either, so a fresh cluster needs a one-line restore.

**The blog** was more interesting.  Its content is baked into the container image: no volume, no Jekyll source, and no Dockerfile anywhere in the cluster repo.
What I eventually found was [`flakeman2/Ephesus`](https://github.com/flakeman2/Ephesus): this site's actual source, a fork of [Hakan Torun's Ephesus theme](https://github.com/onepase/Ephesus) with my four posts sitting in `_posts/`.  Dockerfile and all.

I rebuilt it locally and diffed the output against the running pod.  Everything matched byte for byte except the cache-busting query string on the stylesheet links and the build timestamp in `atom.xml`.
One surprise: the deployed image was built from commit `df1dbaa`, while the branch head is a single cosmetic commit pushed three and a half hours later that never shipped.
The whole procedure is written up in the [repository docs](https://github.com/flakeman2/raspberry-pi-dramble/blob/master/docs/blog-rebuild.md), so the next rebuild is a copy-paste job instead of an archaeology dig.

This post is the first new content since 2022, which makes it the first real test of that procedure.

## The plan

The stack is still the 2021 stack: k3s 1.22 (EOL since 2022), Longhorn 1.2.3, MetalLB 0.11.0, Traefik 2.5.6, Prometheus 2.31, Grafana 8.3.5.  There are two ways forward:

1. **Upgrade in place** — 14 Kubernetes minor hops plus 11 Longhorn minors, so roughly 25 supervised upgrade events, each with a drain and a replica rebuild.
2. **Rebuild** — fresh installs on current versions, restoring the one gigabyte of content that actually matters.

I'm taking the rebuild.  The targets:

- k3s `v1.36.6+k3s1`
- Longhorn `1.13.0`
- MetalLB `0.16.2`, with the address pool moving from a `ConfigMap` to `IPAddressPool` + `L2Advertisement` custom resources
- Traefik `3.7` on Helm chart `42`, which means rewriting every `traefik.containo.us` resource to `traefik.io`
- Prometheus 3.x and Grafana 13, starting from empty volumes — there are no dashboards worth migrating

Then, once Kubernetes is current, **Argo CD**.
The `gitops/` tree is scaffolded in the repo: bootstrap Argo CD once, point it at `master`, and from then on everything else is reconciled from git.
`dev` collects changes and reaches `master` through pull requests — a workflow I set up today, along with branch protection and four merged PRs.

Ordered, the next steps are:

1. Ship this post — build the image, push a tag, bump the Deployment
2. Rotate the k3s join token and the DDNS password, and fix `kube2`'s duplicate k3s unit
3. Rebuild the cluster on k3s 1.36.6 and verify the content restores from git
4. Add requests, limits, and probes — 63 of 64 containers have no limits and 37 have no probes, which is a bad habit on 4 GB nodes
5. Bootstrap Argo CD, starting with `whoami` as the pilot app
6. Write another post, hopefully before another four years pass &#128521;

Till next time!

* * *

**Disclosure:** this post was written by AI.  Drafting and revision were done by
MiMo-V2.6-Flash (`mimo-v2.6-flash`) running in OpenCode.  The post was reviewed
and approved by Devin Flake before publishing.
