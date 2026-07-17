#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found. Install via 'brew install node' or from https://nodejs.org"
    read -p "Press enter to exit"
    exit 1
fi

npm install
node server.js &
SERVER_PID=$!
sleep 2

open -a "Google Chrome" --args --kiosk http://localhost:3000 || open http://localhost:3000

wait $SERVER_PID
