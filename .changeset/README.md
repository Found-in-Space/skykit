# Changesets

This repo uses Changesets to coordinate releases for the publishable
`@found-in-space/*` workspace packages.

For package changes, run:

```sh
npm run changeset
```

Commit the generated markdown file with the code change. The release workflow
turns those files into version bumps, package changelogs, and npm publishes.
This branch is in Changesets prerelease mode. `.changeset/pre.json` records the
`alpha` tag, original versions and changesets included in each alpha batch.
Already versioned changesets remain available for the eventual stable release.

Publishable package manifests must keep package-level `repository` metadata in
sync with the GitHub Actions provenance repository. See `docs/releasing.md`
before adding a new package or changing release metadata.
