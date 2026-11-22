#!/bin/bash

# Change to the directory where this script is located
cd "$(dirname "$0")" || exit 1

# Check for NVM installation
if [ -d "$HOME/.nvm" ]; then
    # Source NVM setup script
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 2> /dev/null
    if command -v nvm > /dev/null 2>&1; then
        # Use NVM to ensure Node.js is available
        nvm install node || nvm use node
    fi
fi

# Check if Node.js is installed
if ! command -v node > /dev/null 2>&1; then
    echo "Node.js is not installed. Opening the download page..."
    # Open default web browser
    if command -v xdg-open > /dev/null 2>&1; then
        xdg-open https://nodejs.org/en/download
    elif command -v firefox > /dev/null 2>&1; then
        firefox https://nodejs.org/en/download
    elif command -v chromium > /dev/null 2>&1; then
        chromium https://nodejs.org/en/download
    else
        echo "No web browser found. Please install one to proceed."
        read -p "Press Enter to continue..."
        exit 1
    fi
    read -p "Press Enter to continue..."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "First run: installing dependencies, this may take a few minutes..."
    npm install || {
        echo "npm install failed. Please check your internet connection or try again."
        read -p "Press Enter to continue..."
        exit 1
    }
fi

# Start the app
npm start