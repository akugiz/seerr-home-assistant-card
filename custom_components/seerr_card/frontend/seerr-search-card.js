/* Seerr Search Card v0.2.0 */
class SeerrSearchCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._results = [];
    this._loading = false;
    this._error = "";
    this._query = "";
    this._initialized = false;
  }

  setConfig(config) {
    this._config = {
      title: "Search movies & TV",
      max_results: 12,
      show_overview: true,
      show_rating: true,
      poster_width: 92,
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._render();
    }
  }

  getCardSize() {
    return Math.max(3, Math.ceil(this._results.length * 2.2) + 2);
  }

  getGridOptions() {
    return {
      columns: 12,
      min_columns: 6,
      max_columns: 12,
    };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        {
          name: "max_results",
          selector: { number: { min: 1, max: 30, step: 1, mode: "slider" } },
        },
        {
          name: "poster_width",
          selector: { number: { min: 60, max: 150, step: 2, mode: "slider", unit_of_measurement: "px" } },
        },
        { name: "show_overview", selector: { boolean: {} } },
        { name: "show_rating", selector: { boolean: {} } },
        { name: "is_4k", selector: { boolean: {} } },
      ],
      computeLabel: (schema) => ({
        title: "Card title",
        max_results: "Maximum search results",
        poster_width: "Poster width",
        show_overview: "Show description",
        show_rating: "Show rating",
        is_4k: "Request 4K versions",
      }[schema.name]),
    };
  }

  static getStubConfig() {
    return {
      title: "Search movies & TV",
      max_results: 12,
      show_overview: true,
      show_rating: true,
    };
  }

  async _callWS(message) {
    if (!this._hass) throw new Error("Home Assistant is not ready");
    const response = await this._hass.connection.sendMessagePromise(message);
    return response && Object.prototype.hasOwnProperty.call(response, "result")
      ? response.result
      : response;
  }

  async _search() {
    const input = this.shadowRoot.querySelector("#searchInput");
    const query = (input?.value || "").trim();
    this._query = query;

    if (query.length < 2) {
      this._error = "Enter at least 2 characters.";
      this._render();
      return;
    }

    this._loading = true;
    this._error = "";
    this._results = [];
    this._render();

    try {
      const data = await this._callWS({
        type: "seerr_card/search",
        query,
        page: 1,
        limit: Number(this._config.max_results) || 12,
      });
      this._results = Array.isArray(data?.results) ? data.results : [];
      if (!this._results.length) this._error = "No movies or TV shows found.";
      this._notifyResize();
    } catch (error) {
      this._error = this._errorMessage(error, "Search failed");
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _request(item, button) {
    if (!this._canRequest(item)) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Requesting…";
    this._error = "";

    try {
      await this._callWS({
        type: "seerr_card/request",
        media_type: item.media_type,
        media_id: item.id,
        seasons: item.media_type === "tv" ? "all" : "all",
        is_4k: Boolean(this._config.is_4k),
      });
      item.media_status = 2;
      item.request_status = 2;
      this._render();
    } catch (error) {
      this._error = this._errorMessage(error, "Request failed");
      button.disabled = false;
      button.textContent = originalText;
      this._showErrorOnly();
    }
  }

  _errorMessage(error, fallback) {
    return (
      error?.message ||
      error?.error?.message ||
      error?.error?.code ||
      (typeof error === "string" ? error : fallback)
    );
  }

  _status(item) {
    const mediaStatus = Number(item.media_status || 0);
    const requestStatus = Number(item.request_status || 0);

    if (mediaStatus === 5) return { text: "Available", kind: "available" };
    if (mediaStatus === 4) return { text: "Partially available", kind: "partial" };
    if (mediaStatus === 3) return { text: "Downloading", kind: "processing" };
    if (mediaStatus === 2) return { text: "Requested", kind: "requested" };
    if (requestStatus === 1) return { text: "Pending approval", kind: "requested" };
    if (requestStatus === 2) return { text: "Approved", kind: "processing" };
    return { text: "Not requested", kind: "none" };
  }

  _canRequest(item) {
    const mediaStatus = Number(item.media_status || 0);
    const requestStatus = Number(item.request_status || 0);
    return ![2, 3, 4, 5].includes(mediaStatus) && ![1, 2].includes(requestStatus);
  }

  _year(item) {
    return item.date ? String(item.date).slice(0, 4) : "";
  }

  _poster(item) {
    if (!item.poster_path) return "";
    return `https://image.tmdb.org/t/p/w342${item.poster_path}`;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _resultHtml(item, index) {
    const status = this._status(item);
    const poster = this._poster(item);
    const year = this._year(item);
    const type = item.media_type === "tv" ? "TV" : "Movie";
    const rating = Number(item.vote_average || 0);
    const canRequest = this._canRequest(item);

    return `
      <article class="result">
        <div class="poster" style="width:${Number(this._config.poster_width) || 92}px">
          ${poster
            ? `<img src="${this._escape(poster)}" alt="${this._escape(item.title)} poster" loading="lazy">`
            : `<div class="no-poster">🎬</div>`}
        </div>
        <div class="details">
          <div class="topline">
            <div>
              <div class="title">${this._escape(item.title)}</div>
              <div class="meta">
                ${this._escape(type)}${year ? ` · ${this._escape(year)}` : ""}
                ${this._config.show_rating && rating > 0 ? ` · ★ ${rating.toFixed(1)}` : ""}
              </div>
            </div>
            <span class="status ${status.kind}">${this._escape(status.text)}</span>
          </div>
          ${this._config.show_overview
            ? `<div class="overview">${this._escape(item.overview || "No description available.")}</div>`
            : ""}
          <div class="actions">
            <button class="request" data-index="${index}" ${canRequest ? "" : "disabled"}>
              ${canRequest ? (item.media_type === "tv" ? "Request all seasons" : "Request movie") : status.text}
            </button>
          </div>
        </div>
      </article>`;
  }

  _notifyResize() {
    this.dispatchEvent(new Event("ll-rebuild", { bubbles: true, composed: true }));
  }

  _showErrorOnly() {
    const errorBox = this.shadowRoot?.querySelector("#errorBox");
    if (!errorBox) return;
    errorBox.textContent = this._error;
    errorBox.hidden = !this._error;
  }

  _render() {
    if (!this.shadowRoot) return;

    const title = this._escape(this._config.title || "Search movies & TV");
    const content = this._loading
      ? `<div class="loading"><span class="spinner"></span>Searching Seerr…</div>`
      : this._results.map((item, index) => this._resultHtml(item, index)).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { overflow:hidden; }
        .header { padding:18px 18px 10px; font-size:20px; font-weight:600; }
        .search-row { display:flex; gap:8px; padding:0 18px 16px; }
        input {
          flex:1; min-width:0; border:1px solid var(--divider-color);
          border-radius:12px; padding:11px 13px; font:inherit;
          color:var(--primary-text-color); background:var(--card-background-color);
          outline:none;
        }
        input:focus { border-color:var(--primary-color); box-shadow:0 0 0 1px var(--primary-color); }
        button {
          border:0; border-radius:10px; padding:10px 14px; font:inherit;
          font-weight:600; cursor:pointer; color:var(--text-primary-color, white);
          background:var(--primary-color);
        }
        button:disabled { cursor:default; opacity:.62; }
        #errorBox {
          margin:0 18px 14px; padding:10px 12px; border-radius:10px;
          background:var(--error-color); color:white;
        }
        .results { border-top:1px solid var(--divider-color); }
        .result { display:flex; gap:14px; padding:15px 18px; border-bottom:1px solid var(--divider-color); }
        .result:last-child { border-bottom:0; }
        .poster { flex:0 0 auto; aspect-ratio:2/3; border-radius:9px; overflow:hidden; background:var(--secondary-background-color); }
        .poster img { width:100%; height:100%; display:block; object-fit:cover; }
        .no-poster { height:100%; display:grid; place-items:center; font-size:30px; }
        .details { min-width:0; flex:1; display:flex; flex-direction:column; }
        .topline { display:flex; gap:10px; justify-content:space-between; align-items:flex-start; }
        .title { font-size:16px; line-height:1.25; font-weight:650; color:var(--primary-text-color); }
        .meta { margin-top:4px; font-size:13px; color:var(--secondary-text-color); }
        .status { white-space:nowrap; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:700; background:var(--secondary-background-color); }
        .status.available { background:rgba(67,160,71,.18); color:var(--success-color, #43a047); }
        .status.partial { background:rgba(251,140,0,.18); color:var(--warning-color, #fb8c00); }
        .status.processing, .status.requested { background:rgba(3,169,244,.18); color:var(--info-color, #039be5); }
        .overview { margin-top:8px; color:var(--secondary-text-color); font-size:13px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
        .actions { margin-top:auto; padding-top:10px; }
        .request { padding:8px 11px; font-size:13px; }
        .loading { min-height:110px; display:flex; align-items:center; justify-content:center; gap:10px; color:var(--secondary-text-color); }
        .spinner { width:18px; height:18px; border:2px solid var(--divider-color); border-top-color:var(--primary-color); border-radius:50%; animation:spin .8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        @media (max-width:520px) {
          .header { padding:15px 14px 9px; }
          .search-row { padding:0 14px 14px; }
          .result { padding:13px 14px; gap:11px; }
          .overview { -webkit-line-clamp:2; }
          .status { display:none; }
        }
      </style>
      <ha-card>
        <div class="header">${title}</div>
        <div class="search-row">
          <input id="searchInput" type="search" placeholder="Movie or TV title…" value="${this._escape(this._query)}" autocomplete="off">
          <button id="searchButton" ${this._loading ? "disabled" : ""}>Search</button>
        </div>
        <div id="errorBox" ${this._error ? "" : "hidden"}>${this._escape(this._error)}</div>
        <div class="results">${content}</div>
      </ha-card>`;

    const input = this.shadowRoot.querySelector("#searchInput");
    const searchButton = this.shadowRoot.querySelector("#searchButton");
    searchButton?.addEventListener("click", () => this._search());
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this._search();
    });
    input?.addEventListener("input", (event) => {
      this._query = event.target.value;
    });

    this.shadowRoot.querySelectorAll("button.request").forEach((button) => {
      button.addEventListener("click", () => {
        const item = this._results[Number(button.dataset.index)];
        if (item) this._request(item, button);
      });
    });
  }
}

if (!customElements.get("seerr-search-card")) {
  customElements.define("seerr-search-card", SeerrSearchCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "seerr-search-card")) {
  window.customCards.push({
    type: "seerr-search-card",
    name: "Seerr Search Card",
    preview: false,
    description: "Search and request movies or TV shows from Seerr.",
  });
}
