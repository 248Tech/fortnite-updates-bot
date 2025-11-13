from __future__ import annotations

import textwrap
from typing import List, Optional

import discord

from fortnite_api import NewsItem


MODE_LABELS = {
	"br": "Battle Royale",
	"stw": "Save the World",
	"cre": "Creative",
}


def _shorten(text: str, max_len: int) -> str:
	"""
	Safely shorten text to max_len characters with ellipsis, respecting word boundaries.
	"""
	text = (text or "").strip()
	if len(text) <= max_len:
		return text
	# textwrap.shorten counts words; set placeholder to "…" and a high break_long_words=False emulation
	return textwrap.shorten(text, width=max_len, placeholder="…")


def build_news_embed(*, mode: str, lang: str, items: List[NewsItem]) -> discord.Embed:
	"""
	Build a Discord embed for Fortnite news.

	Args:
		mode: 'br' | 'stw' | 'cre'
		lang: language code
		items: list of normalized news items

	Returns:
		discord.Embed formatted with numbered fields, first image, and safe length caps.
	"""
	mode_lower = (mode or "br").lower()
	mode_name = MODE_LABELS.get(mode_lower, "Battle Royale")

	title = f"Fortnite {mode_name} Updates"
	description = f"Source: FortniteAPI.io • Language: {lang}"
	embed = discord.Embed(title=title, description=description, color=discord.Color.blue())

	total_chars = len(title) + len(description)
	max_total = 6000
	max_fields = 25

	first_image_url: Optional[str] = None

	for idx, item in enumerate(items[:max_fields], start=1):
		item_title = _shorten(item.get("title", "Untitled"), 256)
		category = item.get("category")
		body = item.get("body", "")

		value_text = body.strip()
		if category:
			value_text = f"[{category}] {value_text}" if value_text else f"[{category}]"
		value_text = _shorten(value_text, 1024)

		# Enforce total embed limit with headroom
		projected = total_chars + len(item_title) + len(value_text)
		if projected > max_total - 100:  # conservative buffer
			break

		embed.add_field(name=f"{idx}. {item_title}", value=value_text or "—", inline=False)
		total_chars = projected

		if not first_image_url:
			first_image_url = item.get("image")

	if first_image_url:
		embed.set_image(url=first_image_url)

	return embed



