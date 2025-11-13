import asyncio
import logging
import os
from typing import Literal, Optional

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

from embeds import build_news_embed
from fortnite_api import FortniteAPI, FortniteAPIError
from config_manager import ConfigManager, BotConfig


MODE_LITERAL = Literal["br", "stw", "cre"]


def get_env(key: str, default: Optional[str] = None) -> str:
	"""
	Read an environment variable, returning default if not found.
	"""
	value = os.getenv(key, default)
	return "" if value is None else value


def validate_env() -> tuple[str, str, str]:
	"""
	Validate required environment variables and return their values.

	Returns:
		A tuple of (discord_token, fortnite_api_key, news_language)

	Raises:
		RuntimeError: If any required variable is missing.
	"""
	discord_token = get_env("DISCORD_TOKEN").strip()
	api_key = get_env("FORTNITE_API_KEY").strip()
	lang = get_env("NEWS_LANGUAGE", "en").strip() or "en"

	missing = []
	if not discord_token:
		missing.append("DISCORD_TOKEN")
	if not api_key:
		missing.append("FORTNITE_API_KEY")
	if missing:
		raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
	return discord_token, api_key, lang


class FortniteUpdatesBot(commands.Bot):
	"""
	Discord Bot for posting Fortnite updates via FortniteAPI.io.
	Provides both prefix and slash commands.
	"""

	def __init__(self, *, command_prefix: str, intents: discord.Intents, api_key: str, lang: str, config: ConfigManager) -> None:
		# Allow dynamic prefix by passing a callable
		def dynamic_prefix(_bot: commands.Bot, _message: discord.Message) -> str:
			return config.config.command_prefix

		super().__init__(command_prefix=dynamic_prefix, intents=intents)
		self.tree = app_commands.CommandTree(self)
		self.api = FortniteAPI(api_key=api_key)
		self.default_lang = lang or "en"
		self.config_manager = config

	async def setup_hook(self) -> None:
		"""
		Called by discord.py when the bot is setting up.
		Registers slash commands.
		"""
		# Register slash command during setup_hook to ensure it is added before sync
		@self.tree.command(name="fortnite_updates", description="Show Fortnite updates (news) for BR, STW, or Creative.")
		@app_commands.describe(type="News type: br (Battle Royale), stw (Save the World), cre (Creative)")
		@app_commands.choices(
			type=[
				app_commands.Choice(name="Battle Royale", value="br"),
				app_commands.Choice(name="Save the World", value="stw"),
				app_commands.Choice(name="Creative", value="cre"),
			]
		)
		async def fortnite_updates_slash(interaction: discord.Interaction, type: Optional[app_commands.Choice[str]] = None) -> None:  # noqa: N803 - discord.py param name
			mode: MODE_LITERAL = (type.value if type else "br")  # type: ignore[assignment]
			await self._handle_updates(interaction=interaction, mode=mode)

		# Config slash commands (admin-only)
		config_group = app_commands.Group(name="config", description="Configure bot settings")

		@config_group.command(name="show", description="Show current bot configuration")
		@app_commands.checks.has_permissions(manage_guild=True)
		async def config_show(interaction: discord.Interaction) -> None:
			cfg = self.config_manager.config
			desc = (
				f"Prefix: `{cfg.command_prefix}`\n"
				f"Language: `{cfg.language or self.default_lang}` (None means .env default)\n"
				f"Default mode: `{cfg.default_mode}`\n"
				f"Slash ephemeral: `{cfg.slash_ephemeral}`"
			)
			embed = discord.Embed(title="Bot Configuration", description=desc, color=discord.Color.green())
			await interaction.response.send_message(embed=embed, ephemeral=True)

		@config_group.command(name="set_language", description="Set preferred language code (empty to use .env default)")
		@app_commands.describe(lang="e.g. en, fr, de. Leave empty to clear and use .env default")
		@app_commands.checks.has_permissions(manage_guild=True)
		async def config_set_language(interaction: discord.Interaction, lang: Optional[str] = None) -> None:
			cfg = self.config_manager.config
			cfg.language = lang.strip() if isinstance(lang, str) and lang and lang.strip() else None
			self.config_manager.save()
			await interaction.response.send_message(f"Language set to: `{cfg.language or self.default_lang}`", ephemeral=True)

		@config_group.command(name="set_default_mode", description="Set default news mode")
		@app_commands.choices(
			mode=[
				app_commands.Choice(name="Battle Royale", value="br"),
				app_commands.Choice(name="Save the World", value="stw"),
				app_commands.Choice(name="Creative", value="cre"),
			]
		)
		@app_commands.checks.has_permissions(manage_guild=True)
		async def config_set_default_mode(interaction: discord.Interaction, mode: app_commands.Choice[str]) -> None:
			cfg = self.config_manager.config
			cfg.default_mode = mode.value  # type: ignore[assignment]
			self.config_manager.save()
			await interaction.response.send_message(f"Default mode set to: `{cfg.default_mode}`", ephemeral=True)

		@config_group.command(name="set_ephemeral", description="Set whether slash responses are ephemeral")
		@app_commands.checks.has_permissions(manage_guild=True)
		async def config_set_ephemeral(interaction: discord.Interaction, enabled: bool) -> None:
			cfg = self.config_manager.config
			cfg.slash_ephemeral = enabled
			self.config_manager.save()
			await interaction.response.send_message(f"Slash ephemeral set to: `{cfg.slash_ephemeral}`", ephemeral=True)

		@config_group.command(name="set_prefix", description="Set command prefix for legacy commands")
		@app_commands.checks.has_permissions(manage_guild=True)
		async def config_set_prefix(interaction: discord.Interaction, prefix: str) -> None:
			prefix = prefix.strip()
			if not prefix:
				await interaction.response.send_message("Prefix cannot be empty.", ephemeral=True)
				return
			cfg = self.config_manager.config
			cfg.command_prefix = prefix
			self.config_manager.save()
			await interaction.response.send_message(f"Prefix set to: `{cfg.command_prefix}`", ephemeral=True)

		self.tree.add_command(config_group)

		# Sync commands on startup
		await self.tree.sync()

	async def on_ready(self) -> None:
		logging.info("Logged in as %s (ID: %s)", self.user, getattr(self.user, "id", "unknown"))
		logging.info("Slash commands synced for %d guilds.", len(self.guilds))

	async def close(self) -> None:
		"""
		Ensure any underlying API cleanup completes.
		"""
		await self.api.aclose()
		await super().close()

	async def _handle_updates(self, interaction: Optional[discord.Interaction] = None, ctx: Optional[commands.Context] = None, mode: MODE_LITERAL = "br") -> None:
		"""
		Shared handler to fetch Fortnite news and send an embed.
		Exactly one of interaction or ctx should be provided.
		"""
		assert (interaction is None) != (ctx is None), "Provide either interaction or ctx"
		cfg = self.config_manager.config
		lang = (cfg.language or self.default_lang).strip() or "en"
		if not mode:
			mode = cfg.default_mode
		try:
			news_items = await self.api.fetch_news(mode=mode, lang=lang)
			if not news_items:
				description = f"No news found for type '{mode.upper()}' (language: {lang})."
				embed = discord.Embed(title="Fortnite Updates", description=description, color=discord.Color.orange())
			else:
				embed = build_news_embed(mode=mode, lang=lang, items=news_items)
		except FortniteAPIError as api_err:
			logging.exception("Fortnite API error: %s", api_err)
			embed = discord.Embed(
				title="Fortnite Updates - Error",
				description=f"Failed to fetch news: {api_err}",
				color=discord.Color.red(),
			)
		except Exception as err:  # pragma: no cover - safety net
			logging.exception("Unexpected error: %s", err)
			embed = discord.Embed(
				title="Fortnite Updates - Error",
				description="An unexpected error occurred while fetching news.",
				color=discord.Color.red(),
			)

		if interaction is not None:
			await interaction.response.send_message(embed=embed, ephemeral=self.config_manager.config.slash_ephemeral)
		elif ctx is not None:
			await ctx.reply(embed=embed, mention_author=False)


def add_legacy_commands(bot: FortniteUpdatesBot) -> None:
	"""
	Register the legacy prefix command: !fortnite_updates [br|stw|cre]
	"""

	@bot.command(name="fortnite_updates", help="Show Fortnite updates. Usage: !fortnite_updates [br|stw|cre] (default: br)")
	async def fortnite_updates_cmd(ctx: commands.Context, type: Optional[str] = None) -> None:  # noqa: N803 - discord.py param name
		mode: MODE_LITERAL = "br"
		if type:
			type_lower = type.lower()
			if type_lower in {"br", "stw", "cre"}:
				mode = type_lower  # type: ignore[assignment]
		await bot._handle_updates(ctx=ctx, mode=mode)

	# Admin-only legacy config commands
	@bot.command(name="setprefix", help="Admin: Set command prefix. Usage: !setprefix ?")
	@commands.has_permissions(manage_guild=True)
	async def setprefix_cmd(ctx: commands.Context, prefix: str) -> None:
		prefix = prefix.strip()
		if not prefix:
			await ctx.reply("Prefix cannot be empty.", mention_author=False)
			return
		cfg = bot.config_manager.config
		cfg.command_prefix = prefix
		bot.config_manager.save()
		await ctx.reply(f"Prefix set to `{cfg.command_prefix}`", mention_author=False)

	@bot.command(name="setlang", help="Admin: Set language (e.g., en). Usage: !setlang en")
	@commands.has_permissions(manage_guild=True)
	async def setlang_cmd(ctx: commands.Context, lang: Optional[str] = None) -> None:
		cfg = bot.config_manager.config
		cfg.language = lang.strip() if isinstance(lang, str) and lang and lang.strip() else None
		bot.config_manager.save()
		await ctx.reply(f"Language set to `{cfg.language or bot.default_lang}`", mention_author=False)

	@bot.command(name="setmode", help="Admin: Set default mode. Usage: !setmode br|stw|cre")
	@commands.has_permissions(manage_guild=True)
	async def setmode_cmd(ctx: commands.Context, mode: str) -> None:
		mode = (mode or "").lower().strip()
		if mode not in {"br", "stw", "cre"}:
			await ctx.reply("Invalid mode. Use br, stw, or cre.", mention_author=False)
			return
		cfg = bot.config_manager.config
		cfg.default_mode = mode  # type: ignore[assignment]
		bot.config_manager.save()
		await ctx.reply(f"Default mode set to `{cfg.default_mode}`", mention_author=False)

	@bot.command(name="setephemeral", help="Admin: Set slash ephemeral responses. Usage: !setephemeral true|false")
	@commands.has_permissions(manage_guild=True)
	async def setephemeral_cmd(ctx: commands.Context, enabled: str) -> None:
		val = (enabled or "").strip().lower()
		if val not in {"true", "false"}:
			await ctx.reply("Usage: !setephemeral true|false", mention_author=False)
			return
		cfg = bot.config_manager.config
		cfg.slash_ephemeral = val == "true"
		bot.config_manager.save()
		await ctx.reply(f"Slash ephemeral set to `{cfg.slash_ephemeral}`", mention_author=False)


def main() -> None:
	"""
	Entrypoint: load env, validate config, and start the bot.
	"""
	# Logging setup
	log_level = os.getenv("LOG_LEVEL", "INFO").upper()
	logging.basicConfig(
		level=getattr(logging, log_level, logging.INFO),
		format="%(asctime)s %(levelname)s %(name)s: %(message)s",
	)

	# Load .env
	load_dotenv()
	try:
		token, api_key, lang = validate_env()
	except RuntimeError as e:
		logging.error("%s", e)
		raise SystemExit(1) from e

	intents = discord.Intents.default()
	config = ConfigManager()
	bot = FortniteUpdatesBot(command_prefix="!", intents=intents, api_key=api_key, lang=lang, config=config)
	add_legacy_commands(bot)

	# Run the bot
	try:
		bot.run(token)
	except KeyboardInterrupt:
		# Graceful shutdown
		logging.info("Shutting down...")
		try:
			loop = asyncio.get_event_loop()
			loop.run_until_complete(bot.close())
		except Exception:  # pragma: no cover
			pass


if __name__ == "__main__":
	main()


