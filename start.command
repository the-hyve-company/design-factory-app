#!/usr/bin/env bash
# Design Factory - start
# macOS: double-click this file in Finder. Linux: run ./start.command
# Installs dependencies on the first run, builds the optimized app, then
# launches it and opens your browser at http://localhost:1420.
# (Contributors who want the hot-reload dev server: npm run dev:web)

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install it from https://nodejs.org and run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies. This can take a minute..."
  npm install
fi

echo "Starting Design Factory. The first run builds the app, then the browser opens on its own."
echo "Leave this window open while you work. Close it or press Ctrl+C to stop."
npm start
