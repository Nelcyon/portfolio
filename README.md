# Nelcyon portfolio

My developer portfolio, in two modes:

- **Classic** (`index.html`, `project.html?id=…`): a normal project list with a page per project showing screenshots, progress and where to play, download or buy.
- **3D world** (`world.html`): a small first-person cul-de-sac built with Three.js, where people at the bus stop and in the houses are using the projects on their phones and screens. Click any screen or floating icon to open that project. `world.html#bettertalk` (or any project id) jumps straight to it.

No build step. Everything is static files; Three.js is vendored in `vendor/`.

## Editing

- **Projects, links, status and screenshots:** `js/projects.js` (one file feeds both modes).
- **Screenshots:** `assets/shots/`. `seraph-placeholder.jpg` is placeholder art; replace it with a real screenshot and keep the name, or update the paths in `js/projects.js` and `js/world.js`.
- **The world:** `js/world.js`. Houses, people and screens are built in code (no model files), so it stays small.

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening the files directly with `file://` won't work because the pages use ES modules.)

## Hosting

GitHub Pages: Settings → Pages → Build and deployment → Deploy from a branch → `main` / root.
