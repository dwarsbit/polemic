# Releasing

A release is built and published by the **Release** workflow
(`.github/workflows/release.yml`). It releases the version of the
`## X.Y.Z (unreleased)` heading in [CHANGELOG.md](../CHANGELOG.md).

1. Keep the next version's changes under a `## X.Y.Z (unreleased)` heading
   at the top of the changelog. Every pull request that changes, adds or
   fixes something adds its line there; start the heading if there is
   none yet.
2. Once CI on `main` is green, run the **Release** workflow from the
   Actions tab on `main`. It takes no input.

The workflow requires exactly one unreleased heading and a numeric version
(Windows installers take no pre-releases). It sets the version in
`package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, dates the
changelog heading, commits to `main` and pushes the tag `vX.Y.Z`. It then
builds for macOS (Apple Silicon and Intel), Linux and Windows and attaches
the installers to a draft GitHub release, with the changelog section as
notes. Once every build has succeeded, it publishes the release as the
latest one.

If a build or the publish fails, or the run is cancelled after the push,
the workflow rolls the release back: it deletes the draft release and the
tag, reverts the release commit on `main` (the changelog heading is
unreleased again) and runs CI on the revert. Fix the cause, then run the **Release** workflow
again from the start; re-running only the failed jobs does not work once
the tag is gone.

macOS and Windows builds are signed once the signing secrets are set;
see [Code signing](signing.md) for the setup.
