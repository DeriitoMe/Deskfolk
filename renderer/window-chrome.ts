import iconUrl from '../assets/icons/tray@2x.png?url';
import './window-chrome.css';

/**
 * Light in-page title bar for the settings and projects windows. The main
 * process hides the native (accent-blue) bar and keeps the system caption
 * buttons through titleBarOverlay in the same mint colour.
 */
export function mountTitleBar(title: string): void {
  const existing = document.querySelector('.window-titlebar-page');
  if (existing) { existing.textContent = title; return; }
  const bar = document.createElement('header');
  bar.className = 'window-titlebar';
  const icon = document.createElement('img');
  icon.src = iconUrl; icon.alt = ''; icon.width = 18; icon.height = 18;
  const name = document.createElement('span');
  name.className = 'window-titlebar-name'; name.textContent = 'Deskfolk';
  const page = document.createElement('span');
  page.className = 'window-titlebar-page'; page.textContent = title;
  bar.append(icon, name, page);
  document.body.prepend(bar);
  document.body.classList.add('has-titlebar');
  const sync = () => document.body.classList.toggle('titlebar-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', sync, { passive: true });
  sync();
}
