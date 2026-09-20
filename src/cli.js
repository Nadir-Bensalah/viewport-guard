#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { audit, DEFAULTS, DEFAULT_WIDTHS, findChrome } from './index.js';

const HELP = `viewport-guard — catch layout problems at the widths that matter

Usage
  viewport-guard <url...> [options]

Options
  --widths 320,390,1440     Widths to test (default: 8 common widths)
  --min-tap 24              Minimum tap target in px (WCAG 2.2: 24)
  --min-font 11.5           Minimum font size in px
  --ignore "sel,sel"        CSS selectors to skip
  --settle 420              Ms to wait after navigation
  --json                    Machine-readable output
  --skip-if-no-chrome       Exit 0 when Chrome is missing (for CI)
  --config <file>           Load options from a JSON file
  -h, --help                This

Config file (viewport-guard.json)
  { "urls": [...], "widths": [...], "ignore": [...] }

Exits 1 when issues are found, 0 when clean.`;

function parse(argv) {
  const opts = {};
  const urls = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') return { help: true };
    else if (a === '--json') opts.json = true;
    else if (a === '--skip-if-no-chrome') opts.skipIfNoChrome = true;
    else if (a === '--config') opts.config = next();
    else if (a === '--widths')
      opts.widths = next()
        .split(',')
        .map((w) => Number(w.trim()))
        .filter((w) => w > 0)
        .map((w) => ({ name: `${w}px`, width: w, height: w <= 430 ? 844 : 900 }));
    else if (a === '--min-tap') opts.minTapTarget = Number(next());
    else if (a === '--min-font') opts.minFontSize = Number(next());
    else if (a === '--settle') opts.settle = Number(next());
    else if (a === '--ignore')
      opts.ignore = next()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}\n`);
      return { help: true, bad: true };
    } else urls.push(a);
  }
  return { opts, urls };
}

const { help, bad, opts = {}, urls = [] } = parse(process.argv.slice(2));

if (help) {
  console.log(HELP);
  process.exit(bad ? 1 : 0);
}

let config = {};
const configPath = opts.config || (existsSync('viewport-guard.json') ? 'viewport-guard.json' : null);
if (configPath) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${configPath}: ${e.message}`);
    process.exit(1);
  }
  if (Array.isArray(config.widths) && typeof config.widths[0] === 'number') {
    config.widths = config.widths.map((w) => ({
      name: `${w}px`,
      width: w,
      height: w <= 430 ? 844 : 900,
    }));
  }
}

const targets = urls.length ? urls : config.urls || [];
if (targets.length === 0) {
  console.error('No URLs given. Pass them as arguments or list them in viewport-guard.json.\n');
  console.log(HELP);
  process.exit(1);
}

// In CI, a missing browser should not be mistaken for a passing site. But
// teams often want the rest of their pipeline to continue, so this is opt-in
// and it says clearly that nothing was verified.
if (!findChrome()) {
  const message = 'Chrome not found. Install Chrome/Chromium or set CHROME_PATH.';
  if (opts.skipIfNoChrome) {
    console.warn(`${message} Skipping — nothing was verified.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

const settings = { ...DEFAULTS, ...config, ...opts };

try {
  const { checked, issues } = await audit(targets, settings);
  const widths = settings.widths || DEFAULT_WIDTHS;

  if (opts.json) {
    console.log(JSON.stringify({ checked, issues }, null, 2));
    process.exit(issues.length ? 1 : 0);
  }

  console.log(`${checked} renders checked (${targets.length} pages x ${widths.length} widths).\n`);

  if (issues.length === 0) {
    console.log('No overflow, no undersized tap target, no unreadable text.');
    process.exit(0);
  }

  const byUrl = new Map();
  for (const i of issues) {
    if (!byUrl.has(i.url)) byUrl.set(i.url, []);
    byUrl.get(i.url).push(i);
  }

  console.error(`${issues.length} issue(s):\n`);
  for (const [url, list] of byUrl) {
    console.error(`  ${url}`);
    for (const i of list) {
      const at = i.widths.length > 3 ? 'all widths' : `${i.widths.join(', ')}px`;
      console.error(`    x [${at}] ${i.message}`);
    }
    console.error('');
  }
  process.exit(1);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
