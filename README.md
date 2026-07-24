# Seerr Search Card for Home Assistant — v0.1.0

This package contains:

- `custom_components/seerr_card/` — secure Home Assistant backend that stores the Seerr API key and calls Seerr.
- `www/seerr-search-card.js` — Home Assistant dashboard card.

## Current features

- Search movies and TV shows from the Home Assistant dashboard.
- Display poster, title, year, rating, overview and Seerr status.
- Request a movie.
- Request all seasons of a TV show.
- Configure normal card options in Home Assistant’s visual card editor.
- Keep the Seerr API key out of the browser and dashboard YAML.
- Require the Home Assistant user to be an administrator before creating a request.

## 1. Copy the files

Using File Editor, Samba or SSH:

- Copy `custom_components/seerr_card` into `/config/custom_components/seerr_card`
- Copy `www/seerr-search-card.js` into `/config/www/seerr-search-card.js`

Create `/config/custom_components` and `/config/www` if they do not already exist.

## 2. Add your API key to secrets.yaml

Get the API key from Seerr:

`Settings → General → API Key`

Add this to `/config/secrets.yaml`:

```yaml
seerr_api_key: "PASTE_YOUR_SEERR_API_KEY_HERE"
```

## 3. Add the integration to configuration.yaml

Change the URL to the local address of your Seerr server:

```yaml
seerr_card:
  url: "http://192.168.1.20:5055"
  api_key: !secret seerr_api_key
  verify_ssl: true
```

Notes:

- For normal local HTTP, `verify_ssl: true` is fine because SSL is not used.
- For HTTPS with a self-signed certificate, use `verify_ssl: false`.
- You may enter a URL with or without `/api/v1` at the end.

Restart Home Assistant completely.

After restart, check **Settings → System → Logs**. You should see `Seerr Card connected as ...` and no Seerr Card setup error.

## 4. Register the JavaScript resource

Open:

`Settings → Dashboards → three-dot menu → Resources → Add resource`

Use:

- URL: `/local/seerr-search-card.js?v=0.1.0`
- Resource type: `JavaScript Module`

If Resources is not visible, enable **Advanced Mode** in your Home Assistant user profile.

## 5. Add the dashboard card

Search for **Seerr Search Card** in the card picker. It includes a visual settings editor.

You can also add a **Manual card** with:

```yaml
type: custom:seerr-search-card
title: Search movies & TV
max_results: 12
show_overview: true
show_rating: true
poster_width: 92
```

Optional 4K requests:

```yaml
type: custom:seerr-search-card
title: Search 4K movies & TV
is_4k: true
max_results: 12
```

Only use `is_4k: true` if a default 4K Radarr/Sonarr service is correctly configured in Seerr.

## Troubleshooting

### Card says custom element does not exist

- Confirm the JS file is exactly `/config/www/seerr-search-card.js`.
- Confirm the resource URL is `/local/seerr-search-card.js?v=0.1.0`.
- Clear the browser cache or change the URL to `?v=0.1.1`.

### Search fails

- Confirm Home Assistant can reach the Seerr local IP and port.
- Confirm the Seerr URL and API key.
- Check **Settings → System → Logs**.

### Request fails with unauthorized/admin error

The card deliberately requires the current Home Assistant account to be an administrator because the configured Seerr API key can be highly privileged.

### TV request behavior

Version 0.1.0 requests **all seasons**. A future version can add a season selection dialog.

## Security

Do not place the Seerr API key in the card YAML or JavaScript file. Keep it in `secrets.yaml`. Seerr warns that the API key may provide administrator-level access.
