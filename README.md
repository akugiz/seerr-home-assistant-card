# Seerr Search Card for Home Assistant

Search for movies and TV shows in Seerr directly from a Home Assistant dashboard, then send the request without opening Seerr.

## Features

- Search movies and TV shows.
- Show live movie and TV suggestions while typing.
- Display posters, year, rating, overview and request status.
- Request movies or all seasons of a TV show.
- Optional 4K requests.
- Visual dashboard card editor.
- Seerr API key is stored in the Home Assistant integration config, not in the card or browser.
- Home Assistant administrator permission is required to create a request.
- The dashboard JavaScript resource is registered automatically in normal Lovelace storage mode.

## HACS installation

This repository can currently be installed as a **HACS custom repository**:

1. Open **HACS**.
2. Open the three-dot menu and choose **Custom repositories**.
3. Add `https://github.com/akugiz/seerr-home-assistant-card`.
4. Select **Integration** as the category.
5. Install **Seerr Search Card**.
6. Restart Home Assistant.
7. Open **Settings → Devices & services → Add integration**.
8. Search for **Seerr Search Card**.
9. Enter your Seerr URL and API key.

No files, `configuration.yaml`, `secrets.yaml`, or dashboard resources need to be added manually.

After setup, add **Seerr Search Card** from the normal Home Assistant dashboard card picker.

## Card configuration

The visual editor covers the normal options. Manual YAML is also supported:

```yaml
type: custom:seerr-search-card
title: Search movies & TV
max_results: 12
live_suggestions: true
show_overview: true
show_rating: true
poster_width: 92
is_4k: false
```

Live suggestions start after two characters and wait briefly before searching, which avoids sending a Seerr request for every keypress. Use the arrow keys and Enter, or click a suggestion.

## Finding the Seerr API key

In Seerr, open:

**Settings → General → API Key**

Keep this key private because it may have administrator-level access to Seerr.

## Important notes

- TV requests currently request **all seasons**.
- `is_4k: true` requires a correctly configured default 4K Radarr/Sonarr service in Seerr.
- Automatic card resource registration works with the normal Home Assistant Lovelace storage mode. Users who run Lovelace resources entirely from YAML must add `/seerr_card/seerr-search-card.js?v=0.2.2` as a JavaScript module themselves.

## Updating

HACS will update everything under `custom_components/seerr_card`, including the backend and dashboard card.

## Troubleshooting

### Integration does not appear after installing

Restart Home Assistant, then clear the browser cache and search again under **Settings → Devices & services → Add integration**.

### Search fails

Confirm that Home Assistant can reach the Seerr address and port. Check **Settings → System → Logs** for `seerr_card` errors.

### The card is missing from the card picker

Restart Home Assistant and perform a hard refresh. The integration automatically registers the card resource when Lovelace is in storage mode.

### Request is rejected

The current Home Assistant user must be an administrator, and the Seerr API key must have permission to create requests.
