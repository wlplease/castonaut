const pathname = window.location.pathname.toLowerCase();
const isClient = pathname === '/' || pathname.endsWith('/index.html');
const route = pathname.endsWith('/tutorial.html') ? 'guide'
  : pathname.endsWith('/endorsements.html') ? 'notes'
    : pathname.endsWith('/privacy.html') ? 'privacy'
      : pathname.endsWith('/terms.html') ? 'terms' : 'client';

const labels = { client: 'HOME', guide: 'GUIDE', notes: 'FIELD NOTES', privacy: 'PRIVACY', terms: 'TERMS' };

// The main SPA tracks its own route changes. Track standalone pages only when
// the visitor has enabled the same local, opt-in setting there.
if (!isClient && import.meta.env.PROD) {
  let analyticsConsent = false;
  try { analyticsConsent = localStorage.getItem('castonaut.analytics-consent.v1') === 'yes'; }
  catch { analyticsConsent = false; }
  if (analyticsConsent) {
    import('@vercel/analytics').then((analytics) => {
      analytics.inject({
        disableAutoTrack: true,
        beforeSend: (event) => {
          try { if (localStorage.getItem('castonaut.analytics-consent.v1') !== 'yes') return null; }
          catch { return null; }
          const url = new URL(event.url);
          url.search = '';
          url.hash = '';
          return { ...event, url: url.toString() };
        },
      });
      analytics.pageview({ route, path: window.location.pathname });
    }).catch(() => {});
  }
}

function link(label, href, attributes = {}) {
  const anchor = document.createElement('a');
  anchor.textContent = label;
  anchor.href = href;
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  return anchor;
}

const header = document.createElement('header');
header.className = `site-header${isClient ? ' site-header--client' : ''}`;
const brand = link('', '/#feed', { class: 'site-brand', 'aria-label': 'Castonaut home' });
const logo = document.createElement('img');
logo.src = '/favicon.svg';
logo.alt = '';
logo.setAttribute('aria-hidden', 'true');
const brandText = document.createElement('span');
const brandName = document.createElement('strong');
brandName.textContent = 'castonaut';
const brandTagline = document.createElement('small');
brandTagline.textContent = 'FARCASTER · YOUR OWN CLIENT';
brandText.append(brandName, brandTagline);
brand.append(logo, brandText);

const siteNav = document.createElement('nav');
siteNav.className = 'site-nav';
siteNav.setAttribute('aria-label', 'Main navigation');
if (!isClient) siteNav.append(link('Client', '/#feed', { 'data-site-link': 'client' }));
siteNav.append(
  link('Guide', '/tutorial.html#quickstart', { 'data-site-link': 'guide' }),
  link('Field notes', '/endorsements.html', { 'data-site-link': 'notes' }),
);
if (!isClient) siteNav.append(link('About', '/#about', { 'data-site-link': 'about' }));

const tools = document.createElement('div');
tools.className = 'site-tools';
const context = document.createElement('div');
context.className = 'site-context';
const contextIndicator = document.createElement('span');
contextIndicator.setAttribute('aria-hidden', 'true');
const pageLabel = document.createElement('span');
pageLabel.id = 'page-label';
pageLabel.textContent = labels[route];
context.append(contextIndicator, pageLabel);
const accountToolsSlot = document.createElement('div');
accountToolsSlot.className = 'site-account-tools';
if (!isClient) {
  const themePicker = document.createElement('label');
  themePicker.className = 'theme-picker site-theme-picker';
  themePicker.innerHTML = '<span aria-hidden="true">✦</span><span class="sr-only">Appearance theme</span><select id="theme-select" aria-label="Appearance theme"><option value="atlas">Spacebar · warm platinum</option><option value="soft-reset">Soft Reset · lilac dusk</option><option value="night-radio">Night Radio · violet dusk</option></select>';
  accountToolsSlot.append(themePicker);
}
tools.append(context, accountToolsSlot);
header.append(brand, siteNav, tools);

const oldHeader = document.querySelector('.topbar, .endorse-header, .legal-header');
const accountTools = accountToolsSlot;
if (isClient && oldHeader) {
  const theme = oldHeader.querySelector('#theme-select')?.closest('.theme-picker');
  const commandButton = oldHeader.querySelector('#command-open');
  const account = oldHeader.querySelector('#open-account');
  if (commandButton) accountTools.append(commandButton);
  if (theme) accountTools.append(theme);
  if (account) accountTools.append(account);
}
oldHeader?.remove();
document.querySelectorAll('.app-frame .sidebar .brand').forEach((brand) => brand.remove());
if (isClient) {
  document.querySelectorAll('.app-frame .sidebar .nav-item[href="/tutorial.html"], .app-frame .sidebar .nav-item[href="/endorsements.html"]').forEach((link) => link.remove());
}
document.querySelectorAll('.page-footer, .guide-footer, .endorse-footer, .legal-footer').forEach((footer) => footer.remove());

const frame = document.querySelector('.app-frame');
const shell = document.querySelector('.endorse-shell, .legal-shell');
const firstContent = frame || shell || document.body.firstElementChild;
if (firstContent) firstContent.before(header);
else document.body.prepend(header);

const footer = document.createElement('footer');
footer.className = 'site-footer';
const footerBrand = link('', '/#feed', { class: 'site-footer-brand' });
footerBrand.append(document.createTextNode('CASTONAUT '));
const footerTagline = document.createElement('span');
footerTagline.textContent = '· AN INDEPENDENT FARCASTER CLIENT';
footerBrand.append(footerTagline);
const footerNav = document.createElement('nav');
footerNav.setAttribute('aria-label', 'Footer navigation');
footerNav.append(
  link('Feed', '/#feed'), link('Desk', '/#my-desk'), link('Search', '/#people-search'), link('Guide', '/tutorial.html'), link('Field notes', '/endorsements.html'),
  link('Privacy', '/privacy.html'), link('Terms', '/terms.html'),
  link('Source ↗', 'https://github.com/wlplease/castonaut', { target: '_blank', rel: 'noopener noreferrer' }),
);
footer.append(footerBrand, footerNav);
if (frame || shell) (frame || shell).after(footer);
else document.body.append(footer);

const active = route === 'guide' ? 'guide' : route === 'notes' ? 'notes' : route === 'privacy' || route === 'terms' ? route : 'client';
header.querySelector(`[data-site-link="${active}"]`)?.setAttribute('aria-current', 'page');
if (route === 'privacy' || route === 'terms') header.querySelector('[data-site-link="about"]')?.setAttribute('aria-current', 'location');

const THEME_STORAGE = 'castonaut.theme.v1';
const themeSelect = header.querySelector('#theme-select');
function applyTheme(value) {
  const theme = ['soft-reset', 'night-radio'].includes(value) ? value : 'atlas';
  document.documentElement.dataset.theme = theme;
  if (themeSelect && themeSelect.value !== theme) themeSelect.value = theme;
}
try { applyTheme(localStorage.getItem(THEME_STORAGE) || 'atlas'); } catch { applyTheme('atlas'); }
themeSelect?.addEventListener('change', () => {
  applyTheme(themeSelect.value);
  try { localStorage.setItem(THEME_STORAGE, themeSelect.value); } catch { /* Theme still applies for this page view. */ }
});

