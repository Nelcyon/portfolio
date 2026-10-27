import { OWNER, PROJECTS } from './projects.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

$('#owner-blurb').textContent = OWNER.blurb;
$('#year').textContent = new Date().getFullYear();
$('#gh').href = OWNER.github;

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'access', label: 'Accessibility', test: (p) => p.tags.includes('Accessibility') },
  { id: 'games', label: 'Games', test: (p) => p.tags.includes('Game') },
  { id: 'play', label: 'Playable now', test: (p) => p.links.some((l) => l.kind === 'play' || l.kind === 'download') },
  { id: 'mods', label: 'Mods', test: (p) => p.status.kind === 'mod' },
];

// Cards show the 768 px WebP copies of the screenshots (tools/webtex.py makes them).
const thumb = (src) => src.replace('assets/shots/', 'assets/shots/w/').replace(/\.(jpg|png)$/, '.webp');

function card(p) {
  const phone = p.gallery.find((g) => g.src === p.cover)?.kind === 'phone';
  return `
    <a class="card" href="project.html?id=${encodeURIComponent(p.id)}">
      <div class="cover${phone ? ' phone' : ''}"><img src="${esc(thumb(p.cover))}" alt="" loading="lazy" /></div>
      <div class="body">
        <span class="badge ${esc(p.status.kind)}">${esc(p.status.label)}</span>
        <h3><span aria-hidden="true">${p.icon}</span>${esc(p.name)}</h3>
        <p>${esc(p.tagline)}</p>
        <div class="chips">${p.platforms.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
      </div>
    </a>`;
}

function render(filterId) {
  const f = FILTERS.find((x) => x.id === filterId) ?? FILTERS[0];
  $('#grid').innerHTML = PROJECTS.filter(f.test).map(card).join('');
  document.querySelectorAll('.filters button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === f.id)));
}

$('.filters').innerHTML = FILTERS.filter((f) => PROJECTS.some(f.test)).map((f) => `<button type="button" data-f="${f.id}">${f.label}</button>`).join('');
$('.filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) render(b.dataset.f);
});
render('all');
