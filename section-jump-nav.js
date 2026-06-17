/*
 * section-jump-nav  —  a floating, fixed-to-viewport sidebar that scroll-jumps
 * to titled sections (vertical-stack-in-card panels) WITHIN the current page,
 * and highlights ("scrollspy") the section currently in view.
 *
 * Why a custom card: HA dashboards are deep shadow-DOM, so native "#anchor"
 * links and tap_action can't scroll to a card. This walks the shadow tree to
 * find a section header by its exact text, resolves its panel (the ha-card that
 * owns the header), and scrollIntoView()s / observes it.
 *
 * Scrollspy: an IntersectionObserver watches each panel against a thin band
 * near the top of the viewport. The topmost panel intersecting that band is the
 * "active" section. IO is used (not scroll events) because scroll events are
 * not `composed` and don't cross shadow boundaries — but IO observes elements
 * anywhere in the tree and fires precisely at the switch points.
 *
 * The bar is appended to <body> on connect / removed on disconnect (so it only
 * shows on its host page). iOS gotcha: no transform / %-top on the fixed element
 * (WebKit then anchors it to the document and it drifts on scroll) — center via
 * a top:0;bottom:0 full-height flex wrapper instead.
 *
 * Lovelace config:
 *   type: custom:section-jump-nav
 *   sections:
 *     - { target: "主卧", icon: "mdi:bed-king" }
 */
class SectionJumpNav extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (this._chips) this._buildChips();
  }

  connectedCallback() {
    if (this._wrap) return;
    const wrap = document.createElement("div");
    wrap.className = "sjn-wrap";
    const style = document.createElement("style");
    style.textContent = `
      .sjn-wrap {
        position: fixed; top: 0; bottom: 0; right: 8px;
        z-index: 7; pointer-events: none;
        display: flex; flex-direction: column; justify-content: center;
      }
      .sjn-bar {
        pointer-events: auto;
        display: flex; flex-direction: column; gap: 4px;
        padding: 6px 5px; border-radius: 22px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.30);
      }
      .sjn-bar button {
        all: unset; cursor: pointer; width: 34px; height: 34px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%; color: var(--secondary-text-color);
        transition: background 0.15s, color 0.15s;
      }
      .sjn-bar button:hover, .sjn-bar button:active { background: rgba(var(--rgb-primary-color, 33,150,243), 0.18); }
      .sjn-bar button.active { background: var(--primary-color); color: #fff; }
      .sjn-bar ha-icon { --mdc-icon-size: 22px; }
    `;
    wrap.appendChild(style);
    const bar = document.createElement("div");
    bar.className = "sjn-bar";
    this._chips = bar;
    wrap.appendChild(bar);
    document.body.appendChild(wrap);
    this._wrap = wrap;
    this._buildChips();
    this._startSpy();
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._wrap) { this._wrap.remove(); this._wrap = null; this._chips = null; }
    this._panels = null; this._inter = null; this._buttons = null;
  }

  _buildChips() {
    if (!this._chips) return;
    this._chips.innerHTML = "";
    this._buttons = [];
    (this._config.sections || []).forEach((s, idx) => {
      const b = document.createElement("button");
      b.title = s.label || s.target;
      const ic = document.createElement("ha-icon");
      ic.setAttribute("icon", s.icon || "mdi:chevron-right");
      b.appendChild(ic);
      b.addEventListener("click", () => this._jump(s.target));
      this._chips.appendChild(b);
      this._buttons.push(b);
    });
  }

  _deepCollect(pred) {
    const out = [];
    const stack = [document.body];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (n.nodeType === 1 && pred(n)) out.push(n);
      if (n.shadowRoot) for (const c of n.shadowRoot.children) stack.push(c);
      if (n.children) for (const c of n.children) stack.push(c);
    }
    return out;
  }

  _findHeader(target) {
    const t = (target || "").trim();
    let hit = this._deepCollect(
      (el) =>
        el.classList &&
        [...el.classList].some((c) => c.includes("card-header")) &&
        el.textContent.trim() === t
    )[0];
    if (!hit) {
      hit = this._deepCollect(
        (el) => el.children.length === 0 && el.textContent.trim() === t
      )[0];
    }
    return hit || null;
  }

  // the panel (ha-card) that owns a header lives one shadow root up
  _panelOf(header) {
    const root = header.getRootNode();
    return (root && root.host) || header;
  }

  _jump(target) {
    const header = this._findHeader(target);
    if (header) {
      header.style.scrollMarginTop = "72px";
      header.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  _startSpy() {
    this._inter = new Set();
    this._io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this._inter.add(e.target);
          else this._inter.delete(e.target);
        }
        this._recompute();
      },
      // a band just below the fixed header; the section occupying it is active
      { root: null, rootMargin: "-70px 0px -82% 0px", threshold: 0 }
    );
    this._ensureObserved();
    // sections render async and re-render on navigation — re-acquire periodically
    this._timer = setInterval(() => this._ensureObserved(), 1500);
  }

  _ensureObserved() {
    if (!this._config || !this._io) return;
    const cur = this._panels || [];
    if (cur.length && cur.every((p) => p && p.isConnected)) return; // still valid
    // (re)acquire panels for every section
    const panels = (this._config.sections || []).map((s) => {
      const h = this._findHeader(s.target);
      return h ? this._panelOf(h) : null;
    });
    if (!panels.some(Boolean)) return; // page not ready yet; try again next tick
    this._io.disconnect();
    this._inter.clear();
    this._panels = panels;
    panels.forEach((p) => p && this._io.observe(p));
  }

  _recompute() {
    if (!this._panels || !this._buttons) return;
    let activeIdx = -1;
    let bestTop = Infinity;
    this._panels.forEach((p, idx) => {
      if (!p || !this._inter.has(p)) return;
      const top = p.getBoundingClientRect().top;
      if (top < bestTop) { bestTop = top; activeIdx = idx; } // topmost in band
    });
    if (activeIdx < 0) return; // none in band → keep current highlight
    this._buttons.forEach((b, i) => b.classList.toggle("active", i === activeIdx));
  }

  set hass(_) {}
  getCardSize() { return 0; }
}

if (!customElements.get("section-jump-nav")) {
  customElements.define("section-jump-nav", SectionJumpNav);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "section-jump-nav",
    name: "Section Jump Nav",
    description: "Floating in-page section jumper with scrollspy",
  });
}
