import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/** Prefer an explicit browser, then a system install, then Playwright's browser. */
export async function launchUiBrowser() {
  const configured = process.env.CHROME_PATH;
  if (configured && !existsSync(configured)) {
    throw new Error(`CHROME_PATH does not exist: ${configured}`);
  }
  const candidates = [
    configured,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(key =>
      process.env[key] ? [path.join(process.env[key], 'Google/Chrome/Application/chrome.exe')] : []),
    chromium.executablePath(),
  ];
  const executablePath = candidates.find(candidate => candidate && existsSync(candidate));
  if (!executablePath) {
    throw new Error('Chrome/Chromium was not found. Set CHROME_PATH or run npx playwright install chromium.');
  }
  return chromium.launch({ headless: true, executablePath });
}
