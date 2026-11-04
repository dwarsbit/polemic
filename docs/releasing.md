# Releasing

A release is built and published by the **Release** workflow
(`.github/workflows/release.yml`).

1. Add a `## X.Y.Z (unreleased)` section to [CHANGELOG.md](../CHANGELOG.md)
   with the changes, and merge it to `main`.
2. Once CI on `main` is green, run the **Release** workflow from the
   Actions tab on `main`, with the version `X.Y.Z` (without the `v`).

The workflow sets the version in `package.json`, `tauri.conf.json`,
`Cargo.toml` and `Cargo.lock`, dates the changelog section, commits to
`main` and pushes the tag `vX.Y.Z`. It then builds for macOS (Apple
Silicon and Intel), Linux and Windows and attaches the installers to a
draft GitHub release, with the changelog section as notes. Publish the
draft once the assets look right.

macOS and Windows builds are signed once the signing secrets are set;
see [Code signing](signing.md) for the setup.
