import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChrome() {
  for (const c of CANDIDATES.filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chrome needs a moment before its debugging port answers. We poll rather
 * than sleep a fixed amount, so a fast machine is not punished and a slow
 * CI runner still succeeds.
 *
 * The target must be of type "page": any other target refuses
 * Emulation.setDeviceMetricsOverride, which is the whole point here.
 */
async function debuggerUrl(port, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const list = await new Promise((res, rej) => {
        http
          .get(`http://127.0.0.1:${port}/json/list`, (r) => {
            let d = '';
            r.on('data', (c) => (d += c));
            r.on('end', () => {
              try {
                res(JSON.parse(d));
              } catch (e) {
                rej(e);
              }
            });
          })
          .on('error', rej);
      });
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome did not open its debugging port (${port}) in time.`);
}

export async function launch({ port = 9444, binary } = {}) {
  const chromePath = binary || findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Chrome or Chromium, or set CHROME_PATH to the binary.'
    );
  }

  const proc = spawn(chromePath, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    'about:blank',
  ]);
  proc.on('error', () => {});

  const url = await debuggerUrl(port);
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Could not attach to Chrome.')), {
      once: true,
    });
  });

  let nextId = 0;
  const send = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== id) return;
        ws.removeEventListener('message', onMessage);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  return {
    send,
    close() {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      proc.kill();
    },
  };
}
