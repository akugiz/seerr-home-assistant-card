/* Seerr Search Card v0.2.2 */
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
    this._suggestions = [];
    this._suggestionsLoading = false;
    this._suggestionsOpen = false;
    this._activeSuggestion = -1;
    this._suggestionTimer = null;
    this._suggestionRequest = 0;
  }

  disconnectedCallback() {
    clearTimeout(this._suggestionTimer);
    this._suggestionRequest += 1;
  }

  setConfig(config) {
    this._config = {
      title: "Search movies & TV",
      max_results: 12,
      show_overview: true,
      show_rating: true,
      poster_width: 92,
      live_suggestions: true,
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
        { name: "live_suggestions", selector: { boolean: {} } },
        { name: "show_overview", selector: { boolean: {} } },
        { name: "show_rating", selector: { boolean: {} } },
        { name: "is_4k", selector: { boolean: {} } },
      ],
      computeLabel: (schema) => ({
        title: "Card title",
        max_results: "Maximum search results",
        poster_width: "Poster width",
        live_suggestions: "Show suggestions while typing",
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
      live_suggestions: true,
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

  _scheduleSuggestions(value) {
    this._query = value;
    clearTimeout(this._suggestionTimer);
    const requestId = ++this._suggestionRequest;
    const query = value.trim();

    if (!this._config.live_suggestions || query.length < 2) {
      this._suggestions = [];
      this._suggestionsLoading = false;
      this._suggestionsOpen = false;
      this._activeSuggestion = -1;
      this._renderSuggestions();
      return;
    }

    this._suggestionsLoading = true;
    this._suggestionsOpen = true;
    this._activeSuggestion = -1;
    this._renderSuggestions();

    this._suggestionTimer = setTimeout(
      () => this._loadSuggestions(query, requestId),
      350,
    );
  }

  async _loadSuggestions(query, requestId) {
    try {
      const data = await this._callWS({
        type: "seerr_card/search",
        query,
        page: 1,
        limit: 6,
      });

      if (requestId !== this._suggestionRequest || query !== this._query.trim()) return;
      this._suggestions = Array.isArray(data?.results) ? data.results.slice(0, 6) : [];
      this._suggestionsOpen = this._suggestions.length > 0;
    } catch (error) {
      if (requestId !== this._suggestionRequest) return;
      this._suggestions = [];
      this._suggestionsOpen = false;
      console.warn("Seerr suggestions failed", error);
    } finally {
      if (requestId !== this._suggestionRequest) return;
      this._suggestionsLoading = false;
      this._renderSuggestions();
    }
  }

  _closeSuggestions(clear = false) {
    clearTimeout(this._suggestionTimer);
    this._suggestionsOpen = false;
    this._suggestionsLoading = false;
    this._activeSuggestion = -1;
    if (clear) this._suggestions = [];
    this._renderSuggestions();
  }

  _moveSuggestion(direction) {
    if (!this._suggestionsOpen || !this._suggestions.length) return;
    const count = this._suggestions.length;
    this._activeSuggestion = (this._activeSuggestion + direction + count) % count;
    this._renderSuggestions();
    this.shadowRoot
      ?.querySelector(`.suggestion[data-index="${this._activeSuggestion}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  _selectSuggestion(index) {
    const item = this._suggestions[index];
    if (!item) return;

    clearTimeout(this._suggestionTimer);
    this._suggestionRequest += 1;
    this._query = item.title || "";
    this._results = [item];
    this._error = "";
    this._loading = false;
    this._suggestions = [];
    this._suggestionsOpen = false;
    this._suggestionsLoading = false;
    this._activeSuggestion = -1;
    this._render();
  }

  async _search(queryOverride) {
    const input = this.shadowRoot.querySelector("#searchInput");
    const query = String(queryOverride ?? input?.value ?? this._query).trim();
    this._query = query;
    clearTimeout(this._suggestionTimer);
    this._suggestionRequest += 1;
    this._suggestions = [];
    this._suggestionsOpen = false;
    this._suggestionsLoading = false;
    this._activeSuggestion = -1;

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
        seasons: "all",
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

  _suggestionHtml(item, index) {
    const poster = this._poster(item);
    const year = this._year(item);
    const type = item.media_type === "tv" ? "TV" : "Movie";
    const active = index === this._activeSuggestion;

    return `
      <button
        type="button"
        class="suggestion${active ? " active" : ""}"
        data-index="${index}"
        role="option"
        aria-selected="${active}"
      >
        <span class="suggestion-poster">
          ${poster
            ? `<img src="${this._escape(poster)}" alt="" loading="lazy">`
            : `<span class="suggestion-no-poster">🎬</span>`}
        </span>
        <span class="suggestion-text">
          <span class="suggestion-title">${this._escape(item.title)}</span>
          <span class="suggestion-meta">${this._escape(type)}${year ? ` · ${this._escape(year)}` : ""}</span>
        </span>
      </button>`;
  }

  _renderSuggestions() {
    const box = this.shadowRoot?.querySelector("#suggestions");
    const input = this.shadowRoot?.querySelector("#searchInput");
    if (!box) return;

    const visible = Boolean(
      this._config.live_suggestions &&
      this._suggestionsOpen &&
      (this._suggestionsLoading || this._suggestions.length),
    );

    box.hidden = !visible;
    input?.setAttribute("aria-expanded", String(visible));

    if (!visible) {
      box.innerHTML = "";
      return;
    }

    box.innerHTML = this._suggestionsLoading
      ? `<div class="suggestion-loading"><span class="mini-spinner"></span>Finding matches…</div>`
      : this._suggestions.map((item, index) => this._suggestionHtml(item, index)).join("");

    box.querySelectorAll("button.suggestion").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("mouseenter", () => {
        this._activeSuggestion = Number(button.dataset.index);
        box.querySelectorAll("button.suggestion").forEach((itemButton) => {
          const isActive = itemButton === button;
          itemButton.classList.toggle("active", isActive);
          itemButton.setAttribute("aria-selected", String(isActive));
        });
      });
      button.addEventListener("click", () => {
        this._selectSuggestion(Number(button.dataset.index));
      });
    });
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
        .search-row { display:flex; align-items:flex-start; gap:8px; padding:0 18px 16px; }
        .search-wrap { flex:1; min-width:0; }
        input {
          width:100%; box-sizing:border-box; border:1px solid var(--divider-color);
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
        .suggestions {
          margin-top:6px; overflow:hidden; max-height:390px; overflow-y:auto;
          border:1px solid var(--divider-color); border-radius:12px;
          background:var(--card-background-color); box-shadow:var(--ha-card-box-shadow, 0 4px 14px rgba(0,0,0,.18));
        }
        .suggestions[hidden] { display:none; }
        .suggestion {
          width:100%; display:flex; align-items:center; gap:10px; padding:8px;
          border-radius:0; color:var(--primary-text-color); background:transparent;
          text-align:left; font-weight:400;
        }
        .suggestion + .suggestion { border-top:1px solid var(--divider-color); }
        .suggestion:hover, .suggestion.active { background:var(--secondary-background-color); }
        .suggestion-poster {
          width:36px; height:54px; flex:0 0 36px; overflow:hidden; border-radius:6px;
          background:var(--secondary-background-color); display:grid; place-items:center;
        }
        .suggestion-poster img { width:100%; height:100%; object-fit:cover; display:block; }
        .suggestion-no-poster { font-size:18px; }
        .suggestion-text { min-width:0; display:flex; flex-direction:column; gap:3px; }
        .suggestion-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
        .suggestion-meta { color:var(--secondary-text-color); font-size:12px; }
        .suggestion-loading {
          min-height:56px; display:flex; align-items:center; justify-content:center;
          gap:8px; color:var(--secondary-text-color); font-size:13px;
        }
        .mini-spinner {
          width:14px; height:14px; border:2px solid var(--divider-color);
          border-top-color:var(--primary-color); border-radius:50%; animation:spin .8s linear infinite;
        }
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
          <div class="search-wrap">
            <input
              id="searchInput"
              type="search"
              placeholder="Movie or TV title…"
              value="${this._escape(this._query)}"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="suggestions"
              aria-expanded="false"
            >
            <div id="suggestions" class="suggestions" role="listbox" hidden></div>
          </div>
          <button id="searchButton" ${this._loading ? "disabled" : ""}>Search</button>
        </div>
        <div id="errorBox" ${this._error ? "" : "hidden"}>${this._escape(this._error)}</div>
        <div class="results">${content}</div>
      </ha-card>`;

    const input = this.shadowRoot.querySelector("#searchInput");
    const searchButton = this.shadowRoot.querySelector("#searchButton");
    searchButton?.addEventListener("click", () => this._search());
    input?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && this._suggestionsOpen) {
        event.preventDefault();
        this._moveSuggestion(1);
      } else if (event.key === "ArrowUp" && this._suggestionsOpen) {
        event.preventDefault();
        this._moveSuggestion(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (this._suggestionsOpen && this._activeSuggestion >= 0) {
          this._selectSuggestion(this._activeSuggestion);
        } else {
          this._search();
        }
      } else if (event.key === "Escape") {
        this._closeSuggestions(false);
      }
    });
    input?.addEventListener("input", (event) => {
      this._scheduleSuggestions(event.target.value);
    });
    input?.addEventListener("focus", () => {
      if (this._config.live_suggestions && this._suggestions.length && this._query.trim().length >= 2) {
        this._suggestionsOpen = true;
        this._renderSuggestions();
      }
    });
    input?.addEventListener("blur", () => {
      setTimeout(() => this._closeSuggestions(false), 140);
    });

    this._renderSuggestions();

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
