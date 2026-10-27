import { PROJECTS, projectById } from './projects.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const id = new URLSearchParams(location.search).get('id');
const p = projectById(id) ?? PROJECTS[0];
const main = document.getElementById('main');
document.getElementById('year').textContent = new Date().getFullYear();
document.title = `${p.name} · Nelcyon`;
document.documentElement.style.setProperty('--accent', p.accent);
if (p.world) document.getElementById('world-link').href = `world.html#${p.id}`;

const ICON = { play: '▶', download: '⬇', buy: '🛒', source: '⌥', site: '↗' };
const primary = p.links.find((l) => l.kind === 'play' || l.kind === 'download' || l.kind === 'buy');

const links = p.links.length
  ? p.links.map((l) => `<a class="btn${l === primary ? ' primary' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${ICON[l.kind] ?? '↗'} ${esc(l.label)}</a>`).join('')
  : `<span class="btn disabled">Not available to play yet</span>`;

main.innerHTML = `
  <section class="p-hero">
    <a class="back" href="index.html#projects">← All projects</a>
    <div class="accent-bar" style="background:${esc(p.accent)}"></div>
    <h1><span aria-hidden="true">${p.icon}</span>${esc(p.name)}${p.aka ? ` <span class="aka">also called ${esc(p.aka)}</span>` : ''}</h1>
    <p class="tagline">${esc(p.tagline)}</p>
    <div class="p-meta">
      <span class="badge ${esc(p.status.kind)}">${esc(p.status.label)}</span>
      <span class="chips" style="padding:0">${p.platforms.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</span>
    </div>
    <div class="cta">${primary ? `<a class="btn primary" href="${esc(primary.url)}" target="_blank" rel="noopener">${ICON[primary.kind]} ${esc(primary.label)}</a>` : ''}
      ${p.world ? `<a class="btn" href="world.html#${esc(p.id)}">See it in the 3D world</a>` : ''}</div>
  </section>

  <section class="gallery" aria-label="Screenshots">
    ${p.gallery.map((g) => `<figure class="${esc(g.kind)}"><img src="${esc(g.src)}" alt="${esc(g.caption)}" loading="lazy" /><figcaption>${esc(g.caption)}</figcaption></figure>`).join('')}
  </section>

  <section class="cols">
    <div>
      <h2>About</h2>
      ${p.description.map((d) => `<p>${esc(d)}</p>`).join('')}
      <h2>Highlights</h2>
      <ul class="hl">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <h2>Progress</h2>
      <ol class="timeline">${p.timeline.map((t) => `<li><div class="d">${esc(t.date)}</div><div class="t">${esc(t.title)}</div><p>${esc(t.text)}</p></li>`).join('')}</ol>
    </div>
    <aside>
      <div class="box">
        <h2 style="margin-top:0">Play, download or buy</h2>
        <div class="links">${links}</div>
      </div>
      ${p.world ? `<div class="box"><h2 style="margin-top:0">In the redwoods</h2><p class="note">${esc(p.world)}</p><a class="btn" href="world.html#${esc(p.id)}">Go there in 3D</a></div>` : ''}
      <div class="box"><h2 style="margin-top:0">Built with</h2><div class="chips" style="padding:0">${p.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>
    </aside>
  </section>`;
