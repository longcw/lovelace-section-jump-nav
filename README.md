# Section Jump Nav

A floating, viewport-fixed sidebar for Home Assistant dashboards that **scroll-jumps to sections within the current page** and **highlights the section you're currently in** (scrollspy).

Home Assistant's dashboard is deep shadow-DOM, so native `#anchor` links and `tap_action` can't scroll to a card. This card walks the shadow tree, finds a section by its header text, and `scrollIntoView()`s it — and uses an `IntersectionObserver` to keep the matching icon highlighted as you scroll.

- 📌 Floating pill, fixed to the viewport — stays put while you scroll
- 🎯 Tap an icon to smooth-scroll to that section
- 🔦 Scrollspy: the current section's icon stays highlighted and switches as you move between areas
- 📱 Works in the iOS/Android companion apps (avoids the WebKit `position: fixed` drift bug)
- 🧩 Self-contained — no other custom cards or backend integration required

## Installation

### HACS (recommended)

1. HACS → ⋮ (top right) → **Custom repositories**.
2. Add `https://github.com/longcw/lovelace-section-jump-nav` with category **Dashboard**.
3. Install **Section Jump Nav**, then reload your browser / restart the app's frontend.

HACS downloads the file and registers the dashboard resource automatically.

### Manual

1. Copy `section-jump-nav.js` to `<config>/www/`.
2. Add it as a dashboard resource (Settings → Dashboards → ⋮ → Resources):
   - URL `/local/section-jump-nav.js`, type **JavaScript Module**.
3. Hard-refresh the frontend.

## Usage

Add the card to **the view whose sections you want to navigate** (it shows only on that page — it is added to `<body>` on connect and removed on leave). Each `target` must match a section's title text exactly.

```yaml
type: custom:section-jump-nav
sections:
  - target: 主卧          # must match the section's title (e.g. a vertical-stack-in-card `title:`)
    icon: mdi:bed-king
  - target: 客厅
    icon: mdi:sofa
  - target: 书房
    icon: mdi:bookshelf
  - target: 餐厅
    icon: mdi:silverware-fork-knife
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `sections` | list | yes | The sections to navigate. |
| `sections[].target` | string | yes | Exact title text of the section to jump to (matched against a rendered `.card-header`). |
| `sections[].icon` | string | no | MDI icon for the chip (default `mdi:chevron-right`). |
| `sections[].label` | string | no | Tooltip text (defaults to `target`). |

## How it matches sections

A "section" is any card that renders an `ha-card` **header** with text equal to your `target` — most commonly a [`vertical-stack-in-card`](https://github.com/custom-cards/vertical-stack-in-card) (or any `ha-card`) with a `title:`. The card resolves the panel from the header (`header.getRootNode().host`) and observes it for scrollspy.

## Notes

- Section panels re-render on navigation; the card re-acquires them on a short interval, so it self-heals.
- Centering uses a `top:0;bottom:0` flex wrapper (no `transform`/`%` on the fixed element) specifically so it stays fixed in the iOS WKWebView companion app.

## License

[MIT](LICENSE)
