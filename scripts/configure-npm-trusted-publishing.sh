#!/usr/bin/env bash
set -euo pipefail

packages=(
  "@found-in-space/anchored-image"
  "@found-in-space/hr-diagram"
  "@found-in-space/meta-sidecar-provider"
  "@found-in-space/skykit"
  "@found-in-space/spatial"
  "@found-in-space/star-map-canvas"
  "@found-in-space/star-octree-provider"
  "@found-in-space/star-trees"
  "@found-in-space/three-star-field"
)

for package_name in "${packages[@]}"; do
  args=(
    trust
    github
    "$package_name"
    --repo
    Found-in-Space/skykit
    --file
    release-packages.yml
    --yes
  )

  if [[ -n "${NPM_OTP:-}" ]]; then
    args+=(--otp "$NPM_OTP")
  fi

  npm "${args[@]}"
done
