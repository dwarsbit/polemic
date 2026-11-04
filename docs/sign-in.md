# Sign in with GitHub and GitLab

Polemic can push and pull a project's Git repository with an account on
github.com or gitlab.com. This page explains how the sign-in works and
how a fork of Polemic uses its own OAuth apps.

## GitHub

**Sign in with GitHub** uses the OAuth device flow of Polemic's own
GitHub OAuth App, whose client ID is in `src-tauri/src/github.rs`. The
client ID is public and there is no client secret: the editor talks to
github.com directly, and the token stays in your system's credential
store.

A fork can use its own OAuth App instead: register one with **Enable
Device Flow** ticked, then set `POLEMIC_GITHUB_CLIENT_ID` when building
or running.

```bash
POLEMIC_GITHUB_CLIENT_ID=<client id> pnpm tauri dev
```

## GitLab

**Sign in with GitLab** works the same way for gitlab.com, through a
GitLab application (scope `api`, not confidential). Polemic's
application ID goes in `src-tauri/src/gitlab.rs`; until it is there, set
`POLEMIC_GITLAB_CLIENT_ID` to turn the button on.

GitLab's tokens expire after two hours, so Polemic keeps the refresh
token in the credential store too and renews the access token before a
pull or push. A self-hosted GitLab is a custom remote with a personal
access token.

## Without signing in

A personal access token added in **Settings → Git** works for pull, push
and Publish.
