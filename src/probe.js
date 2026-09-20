/**
 * The probe runs inside the page and reports only what a rendered layout can
 * prove. Reading source code cannot tell you that a card overflows at 320px,
 * because that depends on the font that actually loaded, the text that was
 * actually there, and the box the browser actually computed.
 *
 * Every rule here exists because of a false positive it had to stop
 * producing. Those exclusions are the difference between a tool a team keeps
 * and a tool a team mutes after two days.
 */
export function buildProbe({ minTapTarget, minFontSize, ignore }) {
  const ignoreList = JSON.stringify(ignore || []);

  return `(() => {
  const IGNORE = ${ignoreList};
  const MIN_TAP = ${minTapTarget};
  const MIN_FONT = ${minFontSize};

  const vw = document.documentElement.clientWidth;
  const out = {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    noViewportMeta: !document.querySelector('meta[name="viewport"]'),
    overflows: [],
    smallTargets: [],
    smallText: [],
    unsizedImages: [],
  };

  const describe = (el) => {
    const cls =
      typeof el.className === 'string'
        ? el.className.split(' ').filter(Boolean).slice(0, 3).join('.')
        : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };

  const ignored = (el) => IGNORE.some((sel) => { try { return el.matches(sel) || el.closest(sel); } catch { return false; } });

  for (const el of document.querySelectorAll('body *')) {
    if (ignored(el)) continue;

    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;

    // A fixed element is positioned against the viewport on purpose. Sticky
    // headers and cookie bars would otherwise report as overflow forever.
    if (s.position === 'fixed') continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Elements parked far off-screen to the left are a deliberate pattern:
    // skip links before focus, honeypot fields, visually-hidden labels. They
    // are never parked off the RIGHT edge, which is what real overflow is.
    if (r.right < 0) continue;
    if (el.closest('[aria-hidden="true"]')) continue;

    if (r.right > vw + 1 || r.left < -1) {
      // A horizontally scrollable ancestor means the author opted in: wide
      // tables, code blocks and carousels are allowed to exceed the viewport.
      let scrollable = false;
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { scrollable = true; break; }
        p = p.parentElement;
      }
      if (!scrollable && out.overflows.length < 12) {
        out.overflows.push({
          el: describe(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          by: Math.round(Math.max(r.right - vw, -r.left)),
        });
      }
    }

    // WCAG 2.2 "Target Size (Minimum)" is 24x24 CSS pixels. Apple's 44pt is a
    // comfort guideline, not a conformance rule, and applying it to an inline
    // link inside a sentence would be wrong: WCAG explicitly excepts targets
    // in a block of text, because enlarging them would break the paragraph.
    const interactive =
      el.tagName === 'BUTTON' ||
      (el.tagName === 'A' && el.getAttribute('href')) ||
      el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !['hidden'].includes(el.type));

    if (interactive && !el.closest('p, li, nav, article, [data-prose]')) {
      if (r.height > 0 && (r.height < MIN_TAP || r.width < MIN_TAP) && out.smallTargets.length < 10) {
        out.smallTargets.push({
          el: describe(el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    }

    const size = parseFloat(s.fontSize);
    if (size > 0 && size < MIN_FONT && el.textContent && el.textContent.trim().length > 3) {
      // Only blame the element that owns the text node, not every ancestor
      // that happens to contain it.
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownsText && out.smallText.length < 8) {
        out.smallText.push({
          el: describe(el),
          px: Math.round(size * 10) / 10,
          text: el.textContent.trim().slice(0, 40),
        });
      }
    }
  }

  // Images without intrinsic dimensions shift the page as they load. This is
  // the single largest contributor to Cumulative Layout Shift on most sites.
  for (const img of document.querySelectorAll('img')) {
    if (ignored(img)) continue;
    if (img.loading === 'lazy' && !img.getAttribute('width')) { /* still counts */ }
    if (!img.getAttribute('width') || !img.getAttribute('height')) {
      if (!img.style.aspectRatio && getComputedStyle(img).aspectRatio === 'auto') {
        if (out.unsizedImages.length < 8) {
          out.unsizedImages.push(img.getAttribute('src') || '(no src)');
        }
      }
    }
  }

  return JSON.stringify(out);
})()`;
}
