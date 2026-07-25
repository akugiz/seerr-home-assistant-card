"""Constants for the Seerr Search Card integration."""

DOMAIN = "seerr_card"

CONF_URL = "url"
CONF_API_KEY = "api_key"
CONF_VERIFY_SSL = "verify_ssl"

DEFAULT_VERIFY_SSL = True

CARD_VERSION = "0.2.4"
CARD_URL_PATH = "/seerr_card/seerr-search-card.js"
CARD_RESOURCE_URL = f"{CARD_URL_PATH}?v={CARD_VERSION}"
