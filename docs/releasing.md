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
```

For ordinary package-change pull requests, `npm run release:status` should pass
after the matching changeset has been committed. Metadata-only release
infrastructure changes can use an empty changeset if a pull request needs a
clean status check without publishing package code.

Publishing is normally handled by `.github/workflows/release-packages.yml` after
changes are merged to `main`. The workflow runs `npm ci`, `npm test`,
`npm run typecheck`, then `changesets/action`, which either opens the version
pull request or publishes any unpublished package versions already committed on
`main`.

Use local release commands only to inspect or repair the release state. To
prepare release commits locally:

```sh
npm run release:version
```

To publish packages from the prepared release commit:

```sh
npm run release:publish
```

The release command publishes alpha releases under the `alpha` npm dist-tag.
Because `0.2.0-alpha.0` is the first published version of these packages, npm
also assigned it as `latest`.

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
