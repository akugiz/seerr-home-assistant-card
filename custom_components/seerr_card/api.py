"""Small asynchronous client for the Seerr API."""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import ClientError, ClientResponse, ClientSession


class SeerrApiError(Exception):
    """Raised when Seerr returns an error or cannot be reached."""


class SeerrClient:
    """Communicate with one Seerr server."""

    def __init__(
        self,
        session: ClientSession,
        base_url: str,
        api_key: str,
        verify_ssl: bool = True,
    ) -> None:
        cleaned_url = base_url.strip().rstrip("/")
        if cleaned_url.endswith("/api/v1"):
            self._base_url = cleaned_url
        else:
            self._base_url = f"{cleaned_url}/api/v1"

        self._session = session
        self._headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": api_key.strip(),
        }
        self._ssl = None if verify_ssl else False

    async def _decode_response(self, response: ClientResponse) -> Any:
        """Decode JSON and produce a useful API error message."""
        try:
            data = await response.json(content_type=None)
        except (ValueError, TypeError):
            data = await response.text()

        if response.status >= 400:
            if isinstance(data, dict):
                message = (
                    data.get("message")
                    or data.get("error")
                    or data.get("statusMessage")
                    or str(data)
                )
            else:
                message = str(data).strip() or response.reason
            raise SeerrApiError(f"Seerr returned HTTP {response.status}: {message}")

        return data

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        """Make one authenticated request."""
        url = f"{self._base_url}/{path.lstrip('/')}"
        try:
            async with asyncio.timeout(25):
                async with self._session.request(
                    method,
                    url,
                    headers=self._headers,
                    params=params,
                    json=json,
                    ssl=self._ssl,
                ) as response:
                    return await self._decode_response(response)
        except TimeoutError as err:
            raise SeerrApiError("Timed out while contacting Seerr") from err
        except ClientError as err:
            raise SeerrApiError(f"Could not contact Seerr: {err}") from err

    async def get_current_user(self) -> dict[str, Any]:
        """Validate the API key and return its Seerr user."""
        data = await self.request("GET", "/auth/me")
        if not isinstance(data, dict):
            raise SeerrApiError("Seerr returned an invalid user response")
        return data

    async def search(self, query: str, page: int = 1) -> dict[str, Any]:
        """Search movies, TV shows and people."""
        data = await self.request(
            "GET",
            "/search",
            params={"query": query, "page": page},
        )
        if not isinstance(data, dict):
            raise SeerrApiError("Seerr returned an invalid search response")
        return data

    async def create_request(
        self,
        media_type: str,
        media_id: int,
        *,
        seasons: str | list[int] | None = None,
        is_4k: bool = False,
    ) -> dict[str, Any]:
        """Create a movie or TV request."""
        payload: dict[str, Any] = {
            "mediaType": media_type,
            "mediaId": media_id,
            "is4k": is_4k,
        }
        if media_type == "tv":
            payload["seasons"] = seasons if seasons is not None else "all"

        data = await self.request("POST", "/request", json=payload)
        if not isinstance(data, dict):
            raise SeerrApiError("Seerr returned an invalid request response")
        return data
