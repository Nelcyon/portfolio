# Nelcyon portfolio

My developer portfolio, in two modes:

- **Classic** (`index.html`, `project.html?id=…`): a normal project list with a page per project showing screenshots, progress and where to play, download or buy.
- **3D world** (`world.html`): a first-person redwood forest built with Three.js, where a family in their house (and a few people at the bus stop) use the projects on their phones and screens. Click any screen or floating icon to open that project. `world.html#bettertalk` (or any project id) jumps straight to it.

No build step. Everything is static files; Three.js is vendored in `vendor/`.

## Editing

- **Projects, links, status and screenshots:** `js/projects.js` (one file feeds both modes).
- **The world:** `js/world.js`. The houses, trees, road, people and screens are built in code. Everything is low-poly and flat-colored to keep it light: furniture and the car are small compressed glTF models in `assets/models/` (made with `tools/slim.mjs`), surface colors are the `SURFACE` table in `js/world.js`, and the only images are the screenshots in `assets/shots/` (in-world copies in `assets/shots/w/`, made with `tools/webtex.py`). Add `?low` to the URL to try the phone settings on a computer. Sources and licenses are listed in [`assets/CREDITS.md`](assets/CREDITS.md).

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening the files directly with `file://` won't work because the pages use ES modules.)

## Hosting

GitHub Pages: Settings → Pages → Build and deployment → Deploy from a branch → `main` / root.
