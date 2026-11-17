# Ephesus

Source for **[blog.devinflake.com](https://blog.devinflake.com)** — a personal
blog served by the [raspberry-pi-dramble](https://github.com/flakeman2/raspberry-pi-dramble)
Raspberry Pi cluster.

Posts live in [`_posts/`](_posts/), the site is built by Jekyll into a Docker
image, and the cluster runs that image. Publishing is one step; see below.

## History

This repository began as a fork of [onepase/Ephesus][upstream] — Hakan Torun's
minimalist Jekyll theme. The theme's layout and structure are still recognisable
as upstream's, but it was customised in 2022 and the content, build and
deployment have been ours ever since.

| Date | Change |
|---|---|
| 2021-09-23 | Forked from [onepase/Ephesus][upstream] |
| 2022-01-23 | First divergence from the theme ("fully customized"): content, Disqus, about page, links — and the multi-stage `Dockerfile` |
| 2026-11-14 | Added `--platform=$BUILDPLATFORM` so the arm64 image builds natively instead of under qemu |
| 2026-11-17 | Added `.github/workflows/publish.yml` — build, verify, publish, open the bump PR |
| 2026-11-17 | Detached from the GitHub fork network; this is now a standalone repository |

Upstream history is preserved in the commit graph, and
[onepase/Ephesus][upstream] remains the reference for the original theme. This
repository does not track or merge from upstream, and pull requests are no
longer opened against it.

[upstream]: https://github.com/onepase/Ephesus

## Publishing a post

One step:

1. Add `_posts/YYYY-MM-DD-slug.md`, commit, push to `master`.

CI takes it from there. `.github/workflows/publish.yml` runs on pushes that
touch content and:

1. tags the build `sha-<7 of this commit>`;
2. builds `linux/arm64` with buildx — the Dockerfile pins the *build* stage to
   `$BUILDPLATFORM`, so gems compile natively and only the final `COPY` stage
   is arm64 (no Pi, no cross-compilation);
3. **smoke-tests the image** — a broken site never reaches the cluster
   (200 homepage, real HTML, at least one `<entry>` in the atom feed);
4. pushes `flakeman2/jekyll:sha-<7>` to Docker Hub;
5. opens the bump PR against `raspberry-pi-dramble` with `base: dev`.

### How a post reaches the cluster

```
 Ephesus master ──> GitHub Actions ──> Docker Hub (sha-<7>)
                          │
                          └──> bump PR in raspberry-pi-dramble
                                        │
                          merge to dev ─┴─> promote to master
                                                    │
                                          Argo CD syncs the tag
                                                    │
                                            blog.devinflake.com
```

**Two merges, not one:** the bump PR targets `dev`, and Argo CD watches
`master`, so the post is not live until the promotion PR merges too.

The tag *is* the source commit, so the deployed tag names its own source and
the `1.0.4`/`1.0.5` drift — an image built from a stale commit — cannot recur.
The tag is also never reused, which keeps the deployment's
`imagePullPolicy: IfNotPresent` honest.

Full details, including the by-hand fallback build, are in
[docs/blog-rebuild.md](https://github.com/flakeman2/raspberry-pi-dramble/blob/master/docs/blog-rebuild.md).

### Secrets

Configured in this repository's Actions secrets. **None of them grant cluster
access.**

| Secret | Purpose |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub login |
| `DOCKERHUB_TOKEN` | push to `flakeman2/jekyll` |
| `DRAMBLE_BUMP_TOKEN` | fine-grained PAT scoped to `flakeman2/raspberry-pi-dramble`, Contents + Pull requests (read/write) |

Branch auto-delete is enabled, so merged branches clean themselves up.

## Local development

```bash
git clone https://github.com/flakeman2/Ephesus.git
cd Ephesus
bundle install
bundle exec jekyll build     # output in _site/
bundle exec jekyll serve     # http://127.0.0.1:4000
```

`Gemfile.lock` pins Jekyll `4.2.1` and `rouge 3.26.1`. **Keep the `rouge`
pin** — Rouge 4.x changes syntax-highlight markup and breaks byte-for-byte
output. `bundle install` inside the Dockerfile honours the lockfile; do not let
it float.

Tags are created automatically under `/tags`. To use a math formula in a post,
add `mathjax: true` to the post's front matter.

## Theme

From [onepase/Ephesus][upstream] — demo at <https://pardin.us/ephesus/>.

- [x] Tiny CSS & No Dependency
- [x] Responsive Design
- [x] Dark/Light Theme
- [x] Custom 404 Page
- [x] About Page
- [x] Tags Page
- [x] Code Highlighter
- [x] Social Share
- [x] Atom & Json feeds
- [x] Robots.txt
- [x] Sitemap
- [x] Next & Previous Post
- [x] Pagination
- [x] Disqus
- [x] Mathjax Support
- [x] Google Analytics

#### Light
![light-theme](https://github.com/onepase/Ephesus/blob/master/light.png)

#### Dark
![dark-theme](https://github.com/onepase/Ephesus/blob/master/dark.png)

## Contributing

This is a personal blog; there is no contribution process for content. Theme
and build fixes are welcome — read [contributing](./CONTRIBUTING.md) first.

## License

This project is open source and available under the [MIT License](LICENSE.md).
