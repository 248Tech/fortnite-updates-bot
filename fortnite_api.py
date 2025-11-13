from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict

import aiohttp


class FortniteAPIError(Exception):
	"""
	Custom error for Fortnite API failures.
	"""


class NewsItem(TypedDict, total=False):
	title: str
	body: str
	image: Optional[str]
	category: Optional[str]


ModeLiteral = Literal["br", "stw", "cre"]


@dataclass(slots=True)
class FortniteAPI:
	"""
	Client for FortniteAPI.io to fetch news.

	Attributes:
		api_key: FortniteAPI.io API key
		request_timeout_s: total timeout for API calls, in seconds
	"""

	api_key: str
	request_timeout_s: float = 10.0
	_session: Optional[aiohttp.ClientSession] = None

	BASE_URL = "https://fortniteapi.io/v2/news"

	def _headers(self) -> Dict[str, str]:
		return {"Authorization": self.api_key, "Accept": "application/json"}

	def _mode_key(self, mode: ModeLiteral) -> str:
		"""
		Map internal mode to likely API key used in response structure.
		"""
		if mode == "cre":
			return "creative"
		return mode

	async def _get_session(self) -> aiohttp.ClientSession:
		if self._session is None or self._session.closed:
			timeout = aiohttp.ClientTimeout(total=self.request_timeout_s)
			self._session = aiohttp.ClientSession(timeout=timeout)
		return self._session

	async def aclose(self) -> None:
		"""
		Close the underlying session if open.
		"""
		if self._session is not None and not self._session.closed:
			await self._session.close()

	async def fetch_news(self, *, mode: ModeLiteral = "br", lang: str = "en") -> List[NewsItem]:
		"""
		Fetch Fortnite news for a given mode and language.

		Args:
			mode: 'br' | 'stw' | 'cre'
			lang: ISO language code (e.g., 'en')

		Returns:
			List of normalized news items.

		Raises:
			FortniteAPIError: On HTTP, timeout, or parse errors.
		"""
		params = {"lang": lang}
		session = await self._get_session()
		try:
			async with session.get(self.BASE_URL, headers=self._headers(), params=params) as resp:
				if resp.status != 200:
					text = await resp.text()
					raise FortniteAPIError(f"HTTP {resp.status}: {text[:300]}")
				# content_type=None to be resilient to server content-type quirks
				payload: Dict[str, Any] = await resp.json(content_type=None)
		except asyncio.TimeoutError as e:
			raise FortniteAPIError("Request timed out") from e
		except aiohttp.ClientError as e:
			raise FortniteAPIError(f"Network error: {e}") from e
		except ValueError as e:
			# JSON parse error
			raise FortniteAPIError("Invalid JSON response") from e

		return self._parse_news_payload(payload, mode)

	def _parse_news_payload(self, payload: Dict[str, Any], mode: ModeLiteral) -> List[NewsItem]:
		"""
		Parse and normalize news payload into a list of NewsItem objects.
		Handles multiple common shapes used by Fortnite news endpoints.
		"""
		news_root = payload.get("news") or payload.get("data") or {}
		mode_key = self._mode_key(mode)
		mode_obj = news_root.get(mode_key) or news_root.get(mode_key.upper()) or {}

		# Some APIs may nest the list under different keys
		candidate_lists = [
			mode_obj.get("motds"),
			mode_obj.get("messages"),
			mode_obj.get("items"),
			mode_obj.get("entries"),
			mode_obj.get("news"),
			mode_obj if isinstance(mode_obj, list) else None,
		]
		source_list: Optional[List[Dict[str, Any]]] = None
		for lst in candidate_lists:
			if isinstance(lst, list):
				source_list = lst
				break
		if not source_list:
			return []

		normalized: List[NewsItem] = []
		for raw in source_list:
			if not isinstance(raw, dict):
				continue
			title = self._pick_first_str(raw, "title", "header", "name", "shortTitle")
			body = self._pick_first_str(raw, "body", "message", "description", "text")
			image = self._pick_first_str(raw, "image", "image_url", "imageUrl", "tileImage", "banner", "picture")
			category = self._pick_first_str(raw, "tabTitle", "category", "type", "group")

			item: NewsItem = {
				"title": title or "Untitled",
				"body": body or "No description available.",
			}
			if image:
				item["image"] = image
			if category:
				item["category"] = category
			normalized.append(item)

		return normalized

	@staticmethod
	def _pick_first_str(obj: Dict[str, Any], *keys: str) -> Optional[str]:
		for k in keys:
			v = obj.get(k)
			if isinstance(v, str) and v.strip():
				return v
		return None



