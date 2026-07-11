# Releasing SkyKit Packages

SkyKit uses Changesets for the publishable `@found-in-space/*` packages under
`packages/`. The repository root is a private workspace shell and is not
published.

The current publishable package manifests are independently versioned at
`0.2.0`. Historical prerelease notes below are retained only for
recovery/context; this checkout is not in Changesets prerelease mode because
`.changeset/pre.json` is absent.

## Public Website Version Policy

The public website is a stable-release consumer, not a head-of-tree integration
environment. While SkyKit is being developed toward `0.3.0`, the website stays
pinned to the exact stable `0.2.0` package versions and CDN URLs.

During `0.3.0` development:

- repository package examples and tests exercise the in-development workspace
  APIs;
- the website remains an ergonomics and use-case reference for the intended
  beginner-to-library learning path;
- website dependencies, live-example version constants, and CDN URLs must not
  be moved to `0.3.0` prereleases merely to follow workspace changes;
- intentional `0.3.0` API changes are documented and validated in this
  repository before the website is migrated.

After the coordinated stable `0.3.0` package batch is available, migrate the
website in a separate, reviewable change. That migration should update exact
package pins and live-example constants together, adapt tutorial code to the
released API, run the website build and live-example smoke checks, and only then
deploy the new teaching surface.

Urgent fixes for the live `0.2.0` teaching surface should use a compatible
`0.2.x` release when a package fix is required. They should not pull unfinished
`0.3.0` APIs into the website.

## Normal Change Flow

1. Make the package change.
2. Run `npm run changeset`.
3. Select the changed package or packages.
4. Pick the semver bump for each package.
5. Write a short release note for humans.
6. Commit the generated `.changeset/*.md` file with the code change.

Documentation-only changes that do not affect published package contents or API
contracts do not need a changeset.

## Release Flow

Run these checks before publishing or before merging release-sensitive package
changes:

```sh
npm test
npm run typecheck
npm run release:check-lockfile
```

For ordinary package-change pull requests, `npm run release:status` should pass
after the matching changeset has been committed. Do not merge empty changesets
for retry-only recovery: `changesets/action` treats an empty changeset as
handled release input and may skip publishing.

Publishing is normally handled by `.github/workflows/release-packages.yml` after
changes merge to `main`. The workflow runs:

```txt
npm ci
npm test
npm run typecheck
npm run release:check-lockfile
changesets/action
```

`changesets/action` either opens/updates the Changesets version pull request or
publishes unpublished package versions that are already committed on `main`.

The canonical version command is:

```sh
npm run release:version
```

It runs `changeset version` and then `npm run release:lockfile`, because
Changesets updates package manifests, changelogs, dependency ranges, and
optional prerelease state, but does not update `package-lock.json` on its own.
If you run `changeset version` directly, run `npm run release:lockfile` before
committing the release result.

Every version pull request should include matching `package-lock.json` changes
whenever a workspace package version or internal dependency range changes.
`npm run release:check-lockfile` verifies the workspace package entries in the
lockfile against the package manifests and fails when they drift.

The workflow needs permission to create the Changesets version pull request. In
GitHub, enable:

```txt
Settings -> Actions -> General -> Workflow permissions
  -> Allow GitHub Actions to create and approve pull requests
```

## Manual Release Repair

Use local release commands only to inspect or repair release state, or for an
urgent package publish when the GitHub workflow is blocked.

To prepare a release commit locally:

```sh
npm test
npm run typecheck
npm run release:version
npm run release:check-lockfile
```

Review and commit the generated package manifests, changelogs,
`package-lock.json`, and any `.changeset/pre.json` changes together.

Before publishing manually, verify that each exact package version is not
already on npm. npm package versions are immutable:

```sh
npm view @found-in-space/skykit@0.2.0 version
```

To publish packages from the prepared release commit with npm two-factor auth:

```sh
npm_config_otp=123456 npm run release:publish
```

If npm accepts only part of the batch, check which versions landed, then rerun
`npm_config_otp=<fresh-code> npm run release:publish` from the same prepared
release commit. After a local manual publish succeeds, push the release commit
and the tags created by Changesets:

```sh
git push --follow-tags
```

## Trusted Publishing Requirements

The release workflow uses npm Trusted Publishing with GitHub Actions OIDC
instead of an `NPM_TOKEN`. Each package must have a trusted publisher configured
for `Found-in-Space/skykit` and `.github/workflows/release-packages.yml`.
Configure it after the release workflow has landed on `main`:

```sh
NPM_OTP=123456 npm run release:trust
```

Each publishable package manifest must include package-level repository metadata
that matches GitHub Actions provenance. npm validates `repository.url` against
the workflow repository, so use this shape and update `directory` for the
package:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/Found-in-Space/skykit",
  "directory": "packages/skykit"
}
```

Do not rely only on the private root workspace `repository` field.

## Prerelease Mode

Changesets prerelease mode is active only when `.changeset/pre.json` exists with
`"mode": "pre"`. This checkout does not currently have that file.

To re-enter alpha prerelease mode later:

```sh
npm exec -- changeset pre enter alpha
```

While prerelease mode is active, `changeset version` produces prerelease
versions such as `0.3.0-alpha.1`, and `changeset publish` publishes with the
dist-tag from `.changeset/pre.json`. Do not pass a custom tag to
`changeset publish` while prerelease mode is active; Changesets rejects custom
tags in pre mode.

To end prerelease mode:

```sh
npm exec -- changeset pre exit
npm run release:version
```

Commit the resulting package manifests, changelogs, lockfile, and
`.changeset/pre.json` changes together.

## Failed Release Recovery

If the release workflow fails after tests and typecheck, inspect the failed run:

```sh
gh run list --workflow release-packages.yml --branch main --limit 5
gh run view <run-id> --log-failed
```

When a version was committed to `main` but npm rejected the publish, fix the
release blocker and merge that fix to `main`. The next release workflow run will
see the unpublished package version and retry publishing it.
