from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Any, Dict, Literal, Optional


ModeLiteral = Literal["br", "stw", "cre"]


@dataclass(slots=True)
class BotConfig:
	"""
	Persistent bot configuration stored on disk.
	Note: Secrets remain in .env; this file is for non-secret runtime settings.
	"""

	command_prefix: str = "!"
	language: Optional[str] = None  # If None, fall back to NEWS_LANGUAGE from .env
	default_mode: ModeLiteral = "br"
	slash_ephemeral: bool = False

	@classmethod
	def from_dict(cls, data: Dict[str, Any]) -> "BotConfig":
		prefix = str(data.get("command_prefix", "!")) or "!"
		lang = data.get("language")
		lang = str(lang).strip() if isinstance(lang, str) and lang.strip() else None
		mode = data.get("default_mode", "br")
		if mode not in {"br", "stw", "cre"}:
			mode = "br"
		slash_ephemeral = bool(data.get("slash_ephemeral", False))
		return cls(
			command_prefix=prefix,
			language=lang,
			default_mode=mode,  # type: ignore[arg-type]
			slash_ephemeral=slash_ephemeral,
		)

	def to_dict(self) -> Dict[str, Any]:
		return asdict(self)


class ConfigManager:
	"""
	Handles reading/writing the bot configuration file.
	"""

	def __init__(self, path: str = "bot_config.json") -> None:
		self.path = path
		self._config: BotConfig = BotConfig()
		self.load_or_create()

	@property
	def config(self) -> BotConfig:
		return self._config

	def load_or_create(self) -> None:
		if not os.path.exists(self.path):
			self.save()  # write defaults
		else:
			try:
				with open(self.path, "r", encoding="utf-8") as f:
					data = json.load(f)
				self._config = BotConfig.from_dict(data if isinstance(data, dict) else {})
			except Exception:
				# On any error, keep defaults and rewrite file
				self._config = BotConfig()
				self.save()

	def save(self) -> None:
		tmp_path = f"{self.path}.tmp"
		with open(tmp_path, "w", encoding="utf-8") as f:
			json.dump(self._config.to_dict(), f, indent=2, ensure_ascii=False)
		os.replace(tmp_path, self.path)



