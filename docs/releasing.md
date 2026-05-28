# Releasing SkyKit Packages

SkyKit uses Changesets for package releases.

The first publishable alpha baseline is aligned at `0.2.0-alpha.0` for every
package under `packages/`. This gives the package-first rewrite one shared
starting point after the old private workspace reached `0.1.x`.

That first baseline was bootstrapped directly in the package manifests rather
than generated from a changeset. npm assigns `latest` to the first published
version of a package, even when it is also published with the `alpha` dist-tag.

After the first alpha, packages are versioned independently. A batch release can
still publish several changed packages together, but the versions do not need to
stay lockstep.

## Normal Change Flow

1. Make the package change.
2. Run `npm run changeset`.
3. Select the changed package or packages.
4. Pick the semver bump for each package.
5. Write a short release note for humans.
6. Commit the generated `.changeset/*.md` file with the code change.

## Release Flow

Run these checks before publishing:

```sh
npm test
npm run typecheck
npm run release:check-lockfile
```

For ordinary package-change pull requests, `npm run release:status` should pass
after the matching changeset has been committed. Do not merge empty changesets
into `main` during release recovery: `changesets/action` treats an empty
changeset as handled release input and will skip the publish command.

Publishing is normally handled by `.github/workflows/release-packages.yml` after
changes are merged to `main`. The workflow runs `npm ci`, `npm test`,
`npm run typecheck`, `npm run release:check-lockfile`, then
`changesets/action`, which either opens the version pull request or publishes
any unpublished package versions already committed on `main`.

The version command used by the workflow is `npm run release:version`. Keep this
as the canonical command. It runs `changeset version` and then
`npm run release:lockfile`, because Changesets updates package manifests,
changelogs, dependency ranges, and `.changeset/pre.json`, but does not update
`package-lock.json` on its own. If you ever run `changeset version` directly,
run `npm run release:lockfile` before committing the release result.

Every version pull request should include the matching `package-lock.json`
changes whenever a workspace package version or internal dependency range
changes. `npm run release:check-lockfile` verifies the workspace package entries
in the lockfile against the package manifests and fails when they drift.

The workflow needs permission to create the Changesets version pull request.
The workflow file already grants `contents: write` and `pull-requests: write`,
but GitHub also has a repository or organization setting that can block
`GITHUB_TOKEN` from creating pull requests. In GitHub, enable:

`Settings -> Actions -> General -> Workflow permissions -> Allow GitHub Actions to create and approve pull requests`

## Alpha Prerelease Flow

SkyKit currently publishes alpha packages from Changesets prerelease mode. The
repo enters that mode with:

```sh
npm exec -- changeset pre enter alpha
```

That creates `.changeset/pre.json`. Do not run this again if the repo is already
in pre mode. While this file has `"mode": "pre"` and `"tag": "alpha"`,
`changeset version` produces prerelease versions such as `0.2.0-alpha.1` or
`0.2.0-alpha.20260528`, and `changeset publish` publishes those versions with
the `alpha` npm dist-tag.

Do not pass a custom tag to `changeset publish` while prerelease mode is active.
The prerelease tag in `.changeset/pre.json` is already the npm dist-tag.
Running `changeset publish --tag alpha` in pre mode fails with:

```txt
Releasing under custom tag is not allowed in pre mode
```

The normal alpha cycle is:

1. Merge feature/package pull requests with their `.changeset/*.md` files.
2. Let the release workflow open or update `changeset-release/main`.
3. Review the generated package versions, changelogs, dependency bumps, and
   `package-lock.json` and `.changeset/pre.json` changes in the Changesets
   version pull request.
4. Merge the Changesets version pull request when ready to publish.
5. Let the next release workflow run publish the unpublished package versions.

If a publish fails after the Changesets version pull request has merged, fix the
release blocker and rerun the release workflow or merge a small fix to `main`.
Do not add a new empty changeset for retry-only recovery.

To end alpha prereleases later, commit the result of:

```sh
npm exec -- changeset pre exit
npm run release:version
```

That converts pending prerelease state into ordinary release versions and removes
the prerelease mode state as part of the version commit.

Use local release commands only to inspect or repair the release state, or for
an urgent alpha package needed to test the public embed/CDN path before the
GitHub release workflow is usable.

To prepare release commits locally:

```sh
npm test
npm run typecheck
npm run release:version
npm run release:check-lockfile
```

Review and commit the generated package manifests, changelogs,
`package-lock.json`, and `.changeset/pre.json` changes together. Do not leave
stale `0.2.0-dev.*` package versions in public release commits or website pins;
the website and CDN tests should use immutable public alpha package versions.

Before publishing manually, verify that each exact package version is not
already on npm. npm package versions are immutable:

```sh
npm view @found-in-space/skykit@0.2.0-alpha.20260529 version
```

To publish packages from the prepared release commit with npm two-factor auth:

```sh
npm_config_otp=123456 npm run release:publish
```

While the repo is in alpha prerelease mode, `release:publish` should call
`changeset publish` without `--tag`. The release command still publishes under
the `alpha` npm dist-tag because that tag comes from `.changeset/pre.json`.
Because `0.2.0-alpha.0` is the first published version of these packages, npm
also assigned it as `latest`.

If the OTP expires or npm accepts only part of the batch, check npm for the
versions that landed, then rerun `npm_config_otp=<fresh-code> npm run
release:publish` from the same prepared release commit. After a local manual
publish succeeds, push the release commit and the tags created by Changesets:

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

Each publishable package manifest must also include package-level repository
metadata that matches GitHub Actions provenance. npm validates
`repository.url` against the workflow repository, so use this shape and update
`directory` for the package:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/Found-in-Space/skykit",
  "directory": "packages/skykit"
}
```

Do not rely only on the private root workspace `repository` field. Trusted
publishing validates the manifest of the package being published.

The root workspace package is private and is not published.

## Failed Release Recovery

If the release workflow fails after tests and typecheck, inspect the failed run:

```sh
gh run list --workflow release-packages.yml --branch main --limit 5
gh run view <run-id> --log-failed
```

When a version was committed to `main` but npm rejected the publish, fix the
release blocker and merge that fix to `main`. The next release workflow run will
see the unpublished package version and retry the publish.
