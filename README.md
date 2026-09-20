# viewport-guard

[![test](https://github.com/Nadir-Bensalah/viewport-guard/actions/workflows/test.yml/badge.svg)](https://github.com/Nadir-Bensalah/viewport-guard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/viewport-guard)](https://www.npmjs.com/package/viewport-guard)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://github.com/Nadir-Bensalah/viewport-guard/blob/main/package.json)

**Your CSS compiles. Your tests pass. Your homepage still scrolls sideways on a 320px phone.**

Nothing in a linter, a type checker or a unit test can tell you that a card overflows at 360px. That depends on the font that actually loaded, the text that was actually there, and the box the browser actually computed. You have to render the page and measure it.

`viewport-guard` renders every page at every width you care about and reports what it measures. It drives headless Chrome over the DevTools Protocol directly — **no Puppeteer, no Playwright, no dependencies at all.**

```
npx viewport-guard https://example.com https://example.com/pricing
```

```
16 renders checked (2 pages x 8 widths).

2 issue(s):

  https://example.com
    x [320, 360px] div.hero__inner overflows by 42px
    x [all widths] tap target 18x18px (min 24) — button.close "×"
```

Exits `1` when it finds something. Drop it in CI and layout regressions stop reaching production.

## Install

```bash
npm i -D viewport-guard
```

Node 22+ (it uses the native `WebSocket`). Chrome or Chromium must be installed — set `CHROME_PATH` if it lives somewhere unusual.

## What it catches

| | Why it matters |
|---|---|
| **Horizontal overflow** | The single most common mobile defect. One 400px-wide element makes the whole page scroll sideways. |
| **Tap targets under 24px** | WCAG 2.2 *Target Size (Minimum)*. Small controls are unusable with a thumb. |
| **Text under 11.5px** | Below this, people zoom. Some just leave. |
| **Images without dimensions** | The largest single contributor to Cumulative Layout Shift. |
| **Missing viewport meta** | Phones render the page at 980px and zoom out. Everything else is downstream of this. |

## What it does *not* report, on purpose

Most layout tools get abandoned because they cry wolf. These exclusions each exist because of a false positive they had to stop producing:

- An element inside an `overflow-x: auto` ancestor. Wide tables, code blocks and carousels scroll **by design**.
- Links inside `p`, `li`, `nav` or `article`. WCAG explicitly excepts targets in a block of text — enlarging them would break the paragraph.
- `position: fixed` elements. Sticky headers and cookie bars are positioned against the viewport on purpose.
- Anything parked off the **left** edge: skip links before focus, honeypot fields, visually-hidden labels. Real overflow goes off the right.
- Anything inside `[aria-hidden="true"]`.

## Usage

```bash
viewport-guard <url...> [options]

  --widths 320,390,1440     Widths to test (default: 8 common widths)
  --min-tap 24              Minimum tap target in px
  --min-font 11.5           Minimum font size in px
  --ignore "sel,sel"        CSS selectors to skip
  --settle 420              Ms to wait after navigation
  --json                    Machine-readable output
  --skip-if-no-chrome       Exit 0 when Chrome is missing
  --config <file>           Load options from JSON
```

Put the repeated parts in `viewport-guard.json` and just run `npx viewport-guard`:

```json
{
  "urls": [
    "http://localhost:3000",
    "http://localhost:3000/pricing"
  ],
  "widths": [320, 390, 768, 1440],
  "ignore": [".mapbox-canvas", "[data-carousel]"]
}
```

### As a library

```js
import { audit } from 'viewport-guard';

const { checked, issues } = await audit(['http://localhost:3000'], {
  widths: [{ name: 'iPhone SE', width: 320, height: 780 }],
  ignore: ['.third-party-widget'],
});

for (const i of issues) {
  console.log(i.type, i.element, i.widths, i.message);
}
```

`audit()` never throws on a layout problem — that is data, not an error. It throws only when it cannot do its job.

## In CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22

- run: npm ci && npm run build
- run: npx serve dist -p 3000 &
- run: npx viewport-guard http://localhost:3000 --skip-if-no-chrome
```

GitHub's `ubuntu-latest` runners ship with Chrome already.

## The default widths

320, 360, 390, 430, 768, 1024, 1440, 1920.

Not a list that looks thorough — a list that matters. **320px** is the narrowest phone still in use and where layouts break first. **430px** is the widest common phone. Between them is where the traffic is.

## Why not Puppeteer or Playwright

They are excellent, and they are ~300MB that downloads its own browser. This is four files and zero dependencies, talking to the Chrome you already have over a WebSocket that Node 22 provides natively. If you are already running Playwright, use it. If you just want to stop shipping sideways-scrolling pages, this is the smaller answer.

## License

MIT © [Nadir Ben Salah](https://nadirbensalah.com)

Built while auditing my own sites, where it found things I had looked at for weeks without seeing.
