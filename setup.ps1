Param(
	[switch]$Run
)

$ErrorActionPreference = "Stop"

function Resolve-Python {
	Param(
		[string[]]$Candidates = @("py", "python", "python3")
	)
	foreach ($c in $Candidates) {
		try {
			$cmd = Get-Command $c -ErrorAction SilentlyContinue
			if ($cmd) {
				return $cmd.Source
			}
		} catch {
			# ignore
		}
	}
	throw "Python executable not found. Please install Python 3.10+ and ensure it is on PATH."
}

Write-Host "== Fortnite Updates Bot Setup =="
$python = Resolve-Python
Write-Host "Using Python: $python"

# Create venv
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
	Write-Host "Creating virtual environment (.venv)..."
	& $python -m venv .venv
}
$venvPython = ".\.venv\Scripts\python.exe"

# Install dependencies
Write-Host "Upgrading pip and installing requirements..."
& $venvPython -m pip install --upgrade pip
if (Test-Path ".\requirements.txt") {
	& $venvPython -m pip install -r requirements.txt
}

# Create .env if missing
if (-not (Test-Path ".\.env")) {
	Write-Host "Creating .env..."
	$discordToken = Read-Host "Enter DISCORD_TOKEN"
	$apiKey = Read-Host "Enter FORTNITE_API_KEY"
	$lang = Read-Host "Enter NEWS_LANGUAGE (default: en)"
	if ([string]::IsNullOrWhiteSpace($lang)) { $lang = "en" }

	@(
		"DISCORD_TOKEN=$discordToken"
		"FORTNITE_API_KEY=$apiKey"
		"NEWS_LANGUAGE=$lang"
	) | Set-Content -Path ".\.env" -Encoding UTF8
	Write-Host ".env created."
} else {
	Write-Host ".env already exists, skipping."
}

# Create bot_config.json if missing
if (-not (Test-Path ".\bot_config.json")) {
	Write-Host "Creating bot_config.json with defaults..."
	@"
{
  "command_prefix": "!",
  "language": null,
  "default_mode": "br",
  "slash_ephemeral": false
}
"@ | Set-Content -Path ".\bot_config.json" -Encoding UTF8
} else {
	Write-Host "bot_config.json already exists, skipping."
}

Write-Host "Setup complete."

if ($Run) {
	Write-Host "Starting bot..."
	& $venvPython ".\bot.py"
}



