#!/usr/bin/env bash
# Design Factory - update
# macOS: double-click this file in Finder. Linux: run ./update.command
# Pulls the latest version from GitHub and refreshes dependencies.

set -e
cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to update. Install it from https://git-scm.com and run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

echo "Updating Design Factory to the latest version..."
# Hard-sync to the official latest instead of `git pull`. A plain pull fails
# when local history diverges (e.g. after a maintainer rewrite); reset always
# lands cleanly. Your generated work in projects/ is gitignored, so it is left
# untouched.
git fetch origin
git reset --hard origin/main
npm install
echo "Done. Open start to launch the app."
read -n 1 -s -r -p "Press any key to close."
