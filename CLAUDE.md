# Notes for agents

- Every piece of user-facing text (interface strings, errors, docs, README, changelog) follows [CONTENT.md](CONTENT.md).
- Every change, feature or bug fix adds its line to the `## X.Y.Z (unreleased)` section at the top of [CHANGELOG.md](CHANGELOG.md), in the same pull request. Start that section with the next version if there is none: a minor bump for new features, a patch bump for fixes only. Changes the reader doesn't see (CI, refactors, tests) get no line.
- Releases are cut from that section by the Release workflow; see [docs/releasing.md](docs/releasing.md).
