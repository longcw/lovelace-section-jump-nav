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
 * Auto-hide: the bar fades fully away (nothing left on screen) after a few
 * seconds of no scrolling, and fades back in the moment you scroll again — so
 * it never covers content while you're reading. Tapping a section keeps it
 * visible (timer resets) so you can jump again. Swipe right anywhere on screen
 * to dismiss it before the timeout.
 *
 * Detecting "user is scrolling": HA scrolls inside a shadow root and `scroll`
 * events are not `composed`, so a window scroll listener won't fire. But
 * `wheel` and `touchmove` ARE composed and bubble to window — a wheel, a
 * vertical touch-drag (scroll), or a scroll key reveals the bar. Same reason
 * scrollspy uses an IntersectionObserver instead of scroll events.
 *
 * The bar is appended to <body> on connect / removed on disconnect (so it only
 * shows on its host page). iOS gotcha: no transform / %-top on the FIXED element
 * (WebKit then anchors it to the document and it drifts on scroll) — so the
 * fixed `.sjn-wrap` stays transform-free; hide/show animates the inner
 * `.sjn-bar` (opacity + a tiny ≤8px slide that never crosses the viewport edge).
 *
 * Lovelace config:
 *   type: custom:section-jump-nav
 *   timeout: 2.5          # seconds before it auto-hides (default 2.5)
 *   swipe_out: true       # swipe right anywhere to dismiss early (default true)
 *   swipe_in: true        # left edge-swipe also reveals it (default true;
 *                         #   scrolling reveals it regardless)
 *   sections:
 *     - { target: "主卧", icon: "mdi:bed-king" }
 */
const SJN_DEFAULT_TIMEOUT_S = 2.5; // fade out after this long with no scroll/interaction
const SJN_SWIPE_PX = 40;           // horizontal travel that counts as a swipe
const SJN_EDGE_PX = 28;            // right-edge zone width for swipe_in reveal
const SJN_SCROLL_KEYS = new Set([
  "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar",
]);

class SectionJumpNav extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    const t = parseFloat(this._config.timeout);
    this._idleMs = (isFinite(t) && t > 0 ? t : SJN_DEFAULT_TIMEOUT_S) * 1000;
    this._swipeIn = this._config.swipe_in !== false;    // default true
    this._swipeOut = this._config.swipe_out !== false;  // default true
    if (this._chips) this._buildChips();
  }

  connectedCallback() {
    if (this._wrap) return;
    // composed events (wheel/touchmove) bubble to window even from shadow DOM.
    // Reveal on wheel, scroll keys, or a *vertical* touch-drag (= scrolling);
    // a horizontal drag from the right edge reveals only when swipe_in is on.
    this._onWheel = () => this._show();
    this._onKey = (e) => { if (SJN_SCROLL_KEYS.has(e.key)) this._show(); };
    this._onTouchStart = (e) => {
      const t0 = e.touches && e.touches[0];
      if (t0) { this._gx = t0.clientX; this._gy = t0.clientY; }
    };
    this._onTouchMove = (e) => {
      const t0 = e.touches && e.touches[0];
      if (!t0) return;
      const dx = t0.clientX - this._gx;
      const dy = t0.clientY - this._gy;
      if (Math.abs(dy) >= Math.abs(dx)) { this._show(); return; } // vertical = scroll → reveal
      // horizontal gesture:
      if (this._swipeOut && dx > SJN_SWIPE_PX) { this._hide(); return; } // swipe right → dismiss
      if (this._swipeIn && this._gx > window.innerWidth - SJN_EDGE_PX && dx < -SJN_SWIPE_PX) {
        this._show(); // left edge-swipe → reveal
      }
    };

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
        pointer-events: none;
        display: flex; flex-direction: column; gap: 4px;
        padding: 6px 5px; border-radius: 22px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.30);
        /* hidden: faded out and nudged 8px toward the edge (never past it) */
        opacity: 0; transform: translateX(8px);
        transition: opacity 0.2s ease, transform 0.25s ease;
      }
      .sjn-bar.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
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
    // keep it visible while the pointer is over it / being touched
    bar.addEventListener("mouseenter", () => this._show());
    bar.addEventListener("touchstart", () => this._show(), { passive: true });
    this._chips = bar;
    wrap.appendChild(bar);
    document.body.appendChild(wrap);
    this._wrap = wrap;

    window.addEventListener("wheel", this._onWheel, { passive: true });
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("touchstart", this._onTouchStart, { passive: true });
    window.addEventListener("touchmove", this._onTouchMove, { passive: true });

    this._buildChips();
    this._startSpy();
    this._show(); // visible on load, then fades after the idle timeout
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._idle) { clearTimeout(this._idle); this._idle = null; }
    if (this._onWheel) {
      window.removeEventListener("wheel", this._onWheel, { passive: true });
      window.removeEventListener("keydown", this._onKey);
      window.removeEventListener("touchstart", this._onTouchStart, { passive: true });
      window.removeEventListener("touchmove", this._onTouchMove, { passive: true });
    }
    if (this._wrap) { this._wrap.remove(); this._wrap = null; this._chips = null; }
    this._panels = null; this._inter = null; this._buttons = null;
  }

  // --- auto-hide --------------------------------------------------------
  _show() {
    if (!this._chips) return;
    this._chips.classList.add("visible");
    if (this._idle) clearTimeout(this._idle);
    this._idle = setTimeout(() => this._hide(), this._idleMs || SJN_DEFAULT_TIMEOUT_S * 1000);
  }

  _hide() {
    if (this._chips) this._chips.classList.remove("visible");
  }

  _buildChips() {
    if (!this._chips) return;
    this._chips.innerHTML = "";
    this._buttons = [];
    (this._config.sections || []).forEach((s) => {
      const b = document.createElement("button");
      b.title = s.label || s.target;
      const ic = document.createElement("ha-icon");
      ic.setAttribute("icon", s.icon || "mdi:chevron-right");
      b.appendChild(ic);
      b.addEventListener("click", () => { this._jump(s.target); this._show(); });
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
    description: "Auto-hiding in-page section jumper with scrollspy",
  });
}
