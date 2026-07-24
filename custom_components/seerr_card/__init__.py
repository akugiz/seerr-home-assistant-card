"""Backend for the Seerr Search dashboard card."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SeerrApiError, SeerrClient
from .const import CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL, DOMAIN

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_URL): cv.string,
                vol.Required(CONF_API_KEY): cv.string,
                vol.Optional(CONF_VERIFY_SSL, default=DEFAULT_VERIFY_SSL): cv.boolean,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


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
    """Get the configured client."""
    return hass.data[DOMAIN]["client"]


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
    """Create a Seerr request. HA admin is required because the API key is privileged."""
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
    """Set up the YAML integration and register card WebSocket commands."""
    conf = config.get(DOMAIN)
    if conf is None:
        return True

    client = SeerrClient(
        async_get_clientsession(hass),
        conf[CONF_URL],
        conf[CONF_API_KEY],
        conf[CONF_VERIFY_SSL],
    )

    try:
        user = await client.get_current_user()
    except SeerrApiError as err:
        _LOGGER.error("Unable to set up Seerr Card: %s", err)
        return False

    hass.data[DOMAIN] = {
        "client": client,
        "user": user.get("username") or user.get("plexUsername") or user.get("email"),
    }

    websocket_api.async_register_command(hass, websocket_search)
    websocket_api.async_register_command(hass, websocket_request)

    _LOGGER.info("Seerr Card connected as %s", hass.data[DOMAIN]["user"])
    return True
