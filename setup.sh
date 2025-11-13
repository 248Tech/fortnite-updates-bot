#!/usr/bin/env bash
set -euo pipefail

echo "== Fortnite Updates Bot Setup (Unix) =="

resolve_python() {
	if command -v python3 >/dev/null 2>&1; then echo "python3"; return; fi
	if command -v python >/dev/null 2>&1; then echo "python"; return; fi
	echo "Error: Python 3.10+ not found on PATH." >&2
	exit 1
}

PY=$(resolve_python)
echo "Using Python: $PY"

# Create venv
if [ ! -f ".venv/bin/python" ]; then
	echo "Creating virtual environment (.venv)..."
	"$PY" -m venv .venv
fi
VENVPY=".venv/bin/python"

# Install dependencies
echo "Upgrading pip and installing requirements..."
"$VENVPY" -m pip install --upgrade pip
if [ -f "requirements.txt" ]; then
	"$VENVPY" -m pip install -r requirements.txt
fi

# Create .env if missing
if [ ! -f ".env" ]; then
	echo "Creating .env..."
	read -r -p "Enter DISCORD_TOKEN: " DISCORD_TOKEN
	read -r -p "Enter FORTNITE_API_KEY: " FORTNITE_API_KEY
	read -r -p "Enter NEWS_LANGUAGE (default: en): " NEWS_LANGUAGE || true
	NEWS_LANGUAGE=${NEWS_LANGUAGE:-en}
	cat > .env <<EOF
DISCORD_TOKEN=$DISCORD_TOKEN
FORTNITE_API_KEY=$FORTNITE_API_KEY
NEWS_LANGUAGE=$NEWS_LANGUAGE
EOF
	echo ".env created."
else
	echo ".env already exists, skipping."
fi

# Create bot_config.json if missing
if [ ! -f "bot_config.json" ]; then
	echo "Creating bot_config.json with defaults..."
	cat > bot_config.json <<'JSON'
{
  "command_prefix": "!",
  "language": null,
  "default_mode": "br",
  "slash_ephemeral": false
}
JSON
else
	echo "bot_config.json already exists, skipping."
fi

echo "Setup complete."

if [ "${1:-}" = "--run" ]; then
	echo "Starting bot..."
	exec "$VENVPY" bot.py
fi



