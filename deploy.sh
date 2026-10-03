#!/usr/bin/env sh
# Build and publish dist/ to the gh-pages branch (GitHub Pages: deploy from branch).
set -e
npm run build
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Publish build" -m "Static bundle from main"
git push -q -f https://github.com/Incognius/QuantumZombie.git gh-pages
