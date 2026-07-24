"""Seerr Search Card integration for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SeerrApiError, SeerrClient
from .const import (
    CARD_RESOURCE_URL,
    CARD_URL_PATH,
    CONF_VERIFY_SSL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


def _safe_media_result(item: dict[str, Any]) -> dict[str, Any] | None:
    """Return only the fields needed by the dashboard card."""
    media_type = item.get("mediaType")
    if media_type not in ("movie", "tv"):
        return None

    media_info = item.get("mediaInfo") or {}
    requests = media_info.get("requests") or []
    latest_request = requests[-1] if requests else {}

    title = item.get("title") if media_type == "movie" else item.get("name")
    date = item.get("releaseDate") if media_type == "movie" else item.get("firstAirDate")

    return {
        "id": item.get("id"),
        "media_type": media_type,
        "title": title or "Unknown title",
        "date": date,
        "overview": item.get("overview") or "",
        "poster_path": item.get("posterPath"),
        "backdrop_path": item.get("backdropPath"),
        "vote_average": item.get("voteAverage"),
        "media_status": media_info.get("status"),
        "request_status": latest_request.get("status"),
    }


def _client(hass: HomeAssistant) -> SeerrClient:
    """Return the configured Seerr client."""
    entries = hass.data[DOMAIN]["entries"]
    if not entries:
        raise SeerrApiError("Seerr Search Card is not configured")
    return next(iter(entries.values()))["client"]


async def _async_register_card_resource(hass: HomeAssistant) -> None:
    """Add or update the card resource when Lovelace uses storage mode."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None)

    if resources is None or not hasattr(resources, "async_create_item"):
        _LOGGER.warning(
            "Could not automatically register the Seerr card resource. "
            "Lovelace YAML mode requires adding %s as a module manually",
            CARD_RESOURCE_URL,
        )
        return

    await resources.async_get_info()
    for item in resources.async_items():
        current_url = item.get("url", "")
        if current_url.split("?", 1)[0] != CARD_URL_PATH:
            continue
        if current_url != CARD_RESOURCE_URL or item.get("type") != "module":
            await resources.async_update_item(
                item["id"],
                {"res_type": "module", "url": CARD_RESOURCE_URL},
            )
        return

    await resources.async_create_item(
        {"res_type": "module", "url": CARD_RESOURCE_URL}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "seerr_card/search",
        vol.Required("query"): cv.string,
        vol.Optional("page", default=1): vol.All(vol.Coerce(int), vol.Range(min=1)),
        vol.Optional("limit", default=12): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=30)
        ),
    }
)
@websocket_api.async_response
async def websocket_search(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Search Seerr without exposing the API key to the browser."""
    query = msg["query"].strip()
    if len(query) < 2:
        connection.send_error(msg["id"], "invalid_query", "Enter at least 2 characters")
        return

    try:
        data = await _client(hass).search(query, msg["page"])
        results: list[dict[str, Any]] = []
        for raw_item in data.get("results", []):
            if not isinstance(raw_item, dict):
                continue
            item = _safe_media_result(raw_item)
            if item is not None:
                results.append(item)
            if len(results) >= msg["limit"]:
                break

        connection.send_result(
            msg["id"],
            {
                "page": data.get("page", msg["page"]),
                "total_pages": data.get("totalPages", 1),
                "total_results": data.get("totalResults", len(results)),
                "results": results,
            },
        )
    except SeerrApiError as err:
        connection.send_error(msg["id"], "seerr_search_failed", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "seerr_card/request",
        vol.Required("media_type"): vol.In(["movie", "tv"]),
        vol.Required("media_id"): vol.All(vol.Coerce(int), vol.Range(min=1)),
        vol.Optional("seasons", default="all"): vol.Any(
            vol.In(["all"]), [vol.All(vol.Coerce(int), vol.Range(min=0))]
        ),
        vol.Optional("is_4k", default=False): cv.boolean,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_request(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create a Seerr request. Home Assistant admin access is required."""
    try:
        data = await _client(hass).create_request(
            msg["media_type"],
            msg["media_id"],
            seasons=msg["seasons"],
            is_4k=msg["is_4k"],
        )
        connection.send_result(
            msg["id"],
            {
                "id": data.get("id"),
                "status": data.get("status"),
                "media_status": (data.get("media") or {}).get("status"),
            },
        )
    except SeerrApiError as err:
        connection.send_error(msg["id"], "seerr_request_failed", str(err))


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register the static card and WebSocket API once."""
    hass.data.setdefault(DOMAIN, {"entries": {}})

    frontend_path = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig("/seerr_card", str(frontend_path), True)]
    )

    websocket_api.async_register_command(hass, websocket_search)
    websocket_api.async_register_command(hass, websocket_request)
    await _async_register_card_resource(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Seerr Search Card from a config entry."""
    client = SeerrClient(
        async_get_clientsession(hass),
        entry.data[CONF_URL],
        entry.data[CONF_API_KEY],
        entry.data[CONF_VERIFY_SSL],
    )

    try:
        user = await client.get_current_user()
    except SeerrApiError as err:
        raise ConfigEntryNotReady(str(err)) from err

    hass.data[DOMAIN]["entries"][entry.entry_id] = {
        "client": client,
        "user": user.get("username")
        or user.get("plexUsername")
        or user.get("email"),
    }
    _LOGGER.info(
        "Seerr Search Card connected as %s",
        hass.data[DOMAIN]["entries"][entry.entry_id]["user"],
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Seerr Search Card config entry."""
    hass.data[DOMAIN]["entries"].pop(entry.entry_id, None)
    return True
