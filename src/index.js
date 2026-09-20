import { launch, findChrome } from './chrome.js';
import { buildProbe } from './probe.js';

/**
 * The widths that matter, not the ones that look thorough. 320px is the
 * narrowest phone still in use and the width where layouts break first;
 * 430px is the widest common phone. Everything between them is where real
 * traffic lives.
 */
export const DEFAULT_WIDTHS = [
  { name: 'Small phone', width: 320, height: 780 },
  { name: 'Common Android', width: 360, height: 800 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'Large phone', width: 430, height: 932 },
  { name: 'Tablet portrait', width: 768, height: 1024 },
  { name: 'Tablet landscape', width: 1024, height: 768 },
  { name: 'Laptop', width: 1440, height: 900 },
  { name: 'Desktop', width: 1920, height: 1080 },
];

export const DEFAULTS = {
  widths: DEFAULT_WIDTHS,
  minTapTarget: 24,
  minFontSize: 11.5,
  ignore: [],
  settle: 420,
  port: 9444,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Audit a list of URLs across a list of widths.
 *
 * Returns { checked, issues }. It never throws on a layout problem — that is
 * data, not an error. It throws only when it cannot do its job at all.
 */
export async function audit(urls, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('audit() needs at least one URL.');
  }

  const probe = buildProbe(opts);
  const chrome = await launch({ port: opts.port, binary: opts.binary });
  const issues = [];
  let checked = 0;

  try {
    await chrome.send('Page.enable');
    await chrome.send('Runtime.enable');

    for (const size of opts.widths) {
      const isPhone = size.width <= 430;
      const metrics = {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: isPhone,
      };
      await chrome.send('Emulation.setDeviceMetricsOverride', metrics);

      for (const url of urls) {
        await chrome.send('Page.navigate', { url });
        await sleep(opts.settle);

        const { result } = await chrome.send('Runtime.evaluate', {
          expression: probe,
          returnByValue: true,
        });
        checked++;

        let r = JSON.parse(result.value);
        const at = { width: size.width, viewport: size.name, url };

        // A page with no <meta name="viewport"> is laid out by Chrome at its
        // 980px desktop fallback, exactly as a real phone would. That is
        // honest, but it hides every other defect behind one root cause. So
        // we report the missing meta, then re-measure without mobile mode to
        // see what the layout actually does at this width.
        if (r.noViewportMeta && isPhone) {
          issues.push({
            ...at,
            type: 'no-viewport-meta',
            message:
              'no <meta name="viewport"> — phones render this page at 980px and zoom out',
          });
          await chrome.send('Emulation.setDeviceMetricsOverride', { ...metrics, mobile: false });
          await chrome.send('Page.navigate', { url });
          await sleep(opts.settle);
          const retry = await chrome.send('Runtime.evaluate', {
            expression: probe,
            returnByValue: true,
          });
          r = JSON.parse(retry.result.value);
          await chrome.send('Emulation.setDeviceMetricsOverride', metrics);
        }

        if (r.scrollWidth > r.vw + 1) {
          issues.push({
            ...at,
            type: 'page-scrolls-horizontally',
            message: `page scrolls horizontally (${r.scrollWidth}px of content in ${r.vw}px)`,
          });
        }
        for (const o of r.overflows) {
          issues.push({
            ...at,
            type: 'overflow',
            element: o.el,
            message: `${o.el} overflows by ${o.by}px`,
          });
        }
        for (const t of r.smallTargets) {
          issues.push({
            ...at,
            type: 'tap-target',
            element: t.el,
            message: `tap target ${t.w}x${t.h}px (min ${opts.minTapTarget}) — ${t.el}${t.text ? ` "${t.text}"` : ''}`,
          });
        }
        for (const t of r.smallText) {
          issues.push({
            ...at,
            type: 'small-text',
            element: t.el,
            message: `text at ${t.px}px (min ${opts.minFontSize}) — "${t.text}"`,
          });
        }
        for (const src of r.unsizedImages) {
          issues.push({
            ...at,
            type: 'unsized-image',
            message: `image without width/height — ${src}`,
          });
        }
      }
    }
  } finally {
    chrome.close();
  }

  // The same defect repeats at every width. Report the fact once, with the
  // widths it affects, instead of eight near-identical lines.
  // The same defect repeats at every width, but its message carries numbers
  // that differ (an element overflows by more at 320px than at 390px). Those
  // numbers must stay out of the identity key, or nothing would ever merge.
  const seen = new Map();
  for (const i of issues) {
    const key = `${i.url}|${i.type}|${i.element || ''}|${i.message.replace(/\d+(\.\d+)?/g, '#')}`;
    const existing = seen.get(key);
    if (existing) {
      existing.widths.push(i.width);
      // Keep the narrowest width's wording: that is where it hurts most.
      if (i.width < existing.width) {
        existing.width = i.width;
        existing.message = i.message;
      }
    } else {
      seen.set(key, { ...i, widths: [i.width] });
    }
  }

  return { checked, issues: [...seen.values()] };
}

export { findChrome };
