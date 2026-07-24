"""Config flow for Seerr Search Card."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SeerrApiError, SeerrClient
from .const import CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    """Build the user setup schema."""
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(CONF_URL, default=defaults.get(CONF_URL, "")): str,
            vol.Required(CONF_API_KEY, default=defaults.get(CONF_API_KEY, "")): str,
            vol.Optional(
                CONF_VERIFY_SSL,
                default=defaults.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
            ): bool,
        }
    )


async def _validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the Seerr connection and return display information."""
    client = SeerrClient(
        async_get_clientsession(hass),
        data[CONF_URL],
        data[CONF_API_KEY],
        data[CONF_VERIFY_SSL],
    )
    user = await client.get_current_user()
    return {
        "title": user.get("username")
        or user.get("plexUsername")
        or user.get("email")
        or "Seerr"
    }


class SeerrCardConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Seerr Search Card."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle setup started by the user."""
        errors: dict[str, str] = {}

        if user_input is not None:
            normalized_url = user_input[CONF_URL].strip().rstrip("/")
            user_input[CONF_URL] = normalized_url

            try:
                info = await _validate_input(self.hass, user_input)
            except SeerrApiError as err:
                message = str(err).lower()
                if "401" in message or "403" in message or "unauthorized" in message:
                    errors["base"] = "invalid_auth"
                else:
                    errors["base"] = "cannot_connect"
            except Exception:  # Home Assistant displays a safe generic error.
                _LOGGER.exception("Unexpected error while validating Seerr")
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(normalized_url.lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(user_input),
            errors=errors,
        )
