#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js is not installed. Opening the download page..."; open https://nodejs.org/en/download; exit 1; fi
[ -d node_modules ] || { echo "First run: installing, this takes a few minutes..."; npm install || exit 1; }
npm start
