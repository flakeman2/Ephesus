---
title: "Dramble: an AI reviewer that costs nothing"
date: 2026-11-17T23:00:00+00:00
author: Devin Flake
layout: post
permalink: /pr_agent_free_tier/
tags: [gitops, ci, code-review, ai, homelab]
---

The last post ended with the cluster converging on `dev` through pull requests.
That raised an obvious problem: I am the only person reviewing my own PRs. CI
catches a manifest that will not apply, a credential in git, or a broken link —
nothing catches an approach that is wrong but syntactically fine.

So this time: an AI reviewer on every pull request, for no money.

![Google Gemini logo](/assets/images/simpleicons-googlegemini.svg "Gemini Flash on the free tier")

## The tool: PR-Agent

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) posts `/describe` and
`/review` on an opened PR. It used to be Qodo's; it's now a community project
in the `The-PR-Agent` organisation, MIT licensed, and it runs **in my own
GitHub Actions** with a key I supply — the code path is a Docker container on
the runner, not a third-party webhook with access to my repository.

It talks to any model behind LiteLLM, which is what makes the free question
interesting: the tool is free, the model is where the cost lives.

## Picking a free model

PR-Agent sends large prompts — the diff plus surrounding context — and it
demands *structured* output it can parse back into a PR comment. Those two
requirements eliminate most free tiers faster than the price does:

| Option | What it actually allows | Verdict |
|---|---|---|
| **Google Gemini** | no card, **no published daily cap**, limits per project in AI Studio | ✅ chosen |
| **Groq** | 8K tokens/min, **200K tokens/day** | ⚠️ PR-Agent's default `max_model_tokens` is **256,000** — one large review could eat a day's budget |
| **OpenRouter `:free`** | **50 requests/day**, and the free model list rotates | too tight |
| **Ollama (local)** | unlimited | PR-Agent's own docs say local open models *"are not suitable for production-level code analysis tasks"* |
| **GitHub Models** | — | **retired 30 July 2026** |

Gemini won on having no published daily ceiling and a model good enough at
structured output to survive PR-Agent's schema validation. The config is two
lines in `.pr_agent.toml`: `gemini/gemini-3.8-flash`, falling back to
`gemini/gemini-3.5-flash-lite` — both free, so a rate-limit blip degrades
instead of failing the review.

The catch worth stating plainly: **Google's free tier allows your content to be
used to improve their products.** Both repositories are public, so the exposure
is low. It is still the reason this setup would not be my choice for private
work.

## I pinned it, then took the pin back

My instinct on this project is to pin everything — chart versions, image tags,
the Longhorn manifest. So I pinned PR-Agent to the commit SHA behind `v0.50.0`,
as their own `action.yaml` suggests.

Then I read their Dockerfile:

```dockerfile
FROM pragent/pr-agent:github_action
```

One line. **The PR-Agent code that actually executes comes from that image tag,
not from the commit I had just pinned.** A SHA on the wrapper would have bought
the *appearance* of supply-chain safety while pinning almost none of the code —
and cost me automatic bug and security fixes plus a manual bump treadmill.

So I unpinned it. The deciding factor is blast radius: this thing posts
comments. It is nowhere near the deploy path, and a bad or missing review is an
annoyance rather than an outage. If that ever changes, the pin belongs on the
image digest, not the wrapper — their `SECURITY.md` documents the
`docker://…@sha256:` form, and I recorded the current digest in the workflow
comment so it is one edit away.

![GitHub Actions logo](/assets/images/simpleicons-githubactions.svg "Runs in my own Actions")

## The failure that was actually two failures

First run failed with:

```
Stopping before any tool runs: no usable API key for the active model's
provider. Set OPENAI_API_KEY in this workflow's env.
```

Which is misleading. It was not asking me for an OpenAI key — it was telling me
**the active model was still OpenAI's default `gpt-6.1-sol`**, and therefore
looked for an OpenAI key.

Why? Because PR-Agent reads `.pr_agent.toml` from the repository's **default
branch**, not from the branch of the PR it is reviewing. I had added the config
and the workflow in the same pull request, so on that first run the config
simply did not exist yet: the shipped default model was active, and no amount
of `GEMINI_API_KEY` would have helped.

Two failures stacked into one message:

1. the config was not on `dev` yet — fixed by merging;
2. the secret was missing — fixed by adding it.

**Merge first, then re-run.** If you add PR-Agent and a config in one PR, expect
the first run to fail and know exactly why.

The key itself I verified separately before blaming the config: a direct call
to `gemini-3.8-flash` returned HTTP 200 and `OK` — though the first call took
**87 seconds**, which is worth expecting on a cold start.

## It works

Re-running after the merge:

- `/describe` → **"PR Reviewer Guide 🔍"**
- `/review` → **"PR Code Suggestions ✨"**
- label applied: **`Review effort 1/5`**
- total job time ≈ **9 minutes**

Honest caveats from the logs: a *"Description output failed schema validation"*
warning, a failed chunk that was retried, and *"Could not self-reflect on
suggestions; using score 7."* None of them stopped the comments posting — but
they are the texture of a free model against a tool tuned for commercial ones.
The output is useful; it is not GPT-6.

**It is advisory, deliberately.** A failed review never blocks a merge. The four
CI jobs remain the gate; PR-Agent is a second opinion.

## How this was written

Written with AI assistance from **MiMo-V2.6-Flash** (model ID
`mimo-v2.6-flash`) running in OpenCode, which produced most of the
configuration and drafted this post. **I read and verified every claim myself**
before publishing — the model limits, the retirement date, the job timings and
the log messages were all checked against the provider documentation, the
workflow run, and the PR itself rather than taken on trust.

The pinning reversal above is a good example of why that matters: the agent
pinned the action as instructed, and it took reading a one-line Dockerfile to
notice the pin was not doing what either of us assumed.

## Next

Phase 3 — addons as Argo Applications, Argo CD managing itself — and the
resilience gaps that outlast all of this: Longhorn still has no off-cluster
backup target, Grafana still has zero dashboards, and Alertmanager has nowhere
to send alerts.

---
*Logos in this post are from [Simple Icons](https://simpleicons.org), released
under [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md);
they remain trademarks of their respective owners and are used here to refer to
the projects discussed.*
