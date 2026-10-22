# Terra_Map

A **desktop** app for **macOS, Windows and Linux** to build **3D mock-ups** of an area: shape the **terrain** (flat, mountains, valley), place **infrastructure** (houses, buildings, plots) by drag and drop, build **telecom networks** (antennas, OLT, splitters, ONU, fiber, copper and coax cables) and **simulate** the network — optimal cable route with **Dijkstra's algorithm**, latency, throughput, antenna coverage and link budget.

> Status: **phases 0–18 done** (layout, 3D viewport, terrain, infrastructure, `.glb` import/export, networks and telecom, network simulator, `.json` project, polish and quality, productivity, environment, measurement and reports, experience and robustness, distribution — English UI, update notice and landing page —, cross-platform installers for macOS, Windows and Linux, Blender models with a visual catalog, roads with bridges and zoning, and joined roads with editable point heights); **React** frontend. Next ideas are in the roadmap backlog.

## Features

### Done

- **Interface** in Apple style: the map fills the window and glass panels float over it — a top bar with File / View / Tools menus and a Settings gear (dark mode and snap-to-roads switches, shortcuts, user guide), the catalog on the left with a 3D preview of every infrastructure and network element, and properties on the right that slide in only while something is selected or a tool is active.
- **3D viewport** (three.js): damped orbit, pan and zoom, with a Rotate / Move switch (`H`) so the left mouse button can also pan the view; top, front and isometric views (`1`/`2`/`3`, `Home`, `F`); click to select; grid (`G`); top-down minimap — click it to move the camera.
- **Terrain**: flat, mountains, valley and custom presets (seed, amplitude, frequency), generated in the Rust core with Perlin noise; sculpting brush (`B`, `Shift` to lower) with Gaussian falloff; color gradient by altitude; save and load presets; import a PNG heightmap.
- **3D models** made in Blender: every house, building, plot, network element, marker and tree is a `.glb` built by a versioned Blender script (`ui/models/build_models.py`), at real scale (a single-storey house is clearly lower than a 7 m pole).
- **Roads like a city builder**: drag on the terrain to lay a stretch, with live length, angle and grade; start or end on another road to join it — a shared junction point in the middle of that road (clean, without lane markings), or the same road when you carry on from its end; valleys become bridges with piers and barriers and a Bridge height turns a road into a viaduct. Select a road to see its points, then click a point or a side to raise or lower just that part; roads joined at a point move with it. Houses and buildings snap next to a road, facing it, with zones shown while you drag (can be turned off in Settings).
- **Infrastructure**: house, building (adjustable floors) and plot; drag and drop that snaps to the terrain; construction phases (foundations, structure, finishing); position, rotation and scale with spinners and arrow keys (`Shift` ×10, `Alt` ÷10); transform gizmo; duplicate and delete; collision warning.
- **`.glb` models**: export the mock-up or the selection, import with validation; an imported model joins the catalog for reuse.
- **Networks and telecom**: antennas, routers, switches, OLT, ONU, splitters, poles and distribution boxes by drag and drop; Cable tool (`C`) with underground (follows the terrain), aerial (catenary) or direct routes, in fiber, copper or coax; markers (`M`) with a label and a note; dynamic key-value properties per element and per cable; in-memory network graph.
- **Network simulator**: optimal cable path with Dijkstra in the Rust core, by distance, cost, latency or attenuation; end-to-end latency, bottleneck throughput, cost and attenuation; optical link budget with a traffic light; simulate the failure of an element or cable and see the alternative route; antenna coverage with terrain attenuation (heatmap); export results to CSV.
- **Productivity**: undo/redo up to 100 actions (with a clickable history and a Reset that clears the map — undoable too), multi-selection (`Shift`+click or a rectangle with `Shift`+drag) with batch move, align, distribute and delete, copy/paste, layers (terrain, infrastructure, networks, markers) with visibility and lock, snap to grid and to objects, catalog search.
- **Environment**: day/night cycle with shadows and a gradient sky, fog, lakes (water plane), material brush (grass, dirt, sand, rock, snow) that grows grass tufts, snow drifts, boulders, clods and sand ripples, an eraser that removes anything under it, vegetation (instanced Blender trees and bushes), roads, presentation mode with a camera fly-through; the editing grid is drawn on the relief and always covers the map.
- **Measurement and reports**: ruler (`R`) with 3D distance, horizontal distance and height difference; terrain profile between the two points (chart); report with project statistics, bill of materials (BOM with symbolic prices and labor) and the last simulation; scenario comparison saved in the project; export the report to PDF (with an image of the mock-up, generated in the Rust core) and the BOM to CSV.
- **Experience**: light and dark themes (AA contrast in both), interface, report and messages in English, the whole app by keyboard (focusable viewport with a crosshair — arrow keys move the camera, `Space` clicks, `N` jumps to the next element; catalog with `Enter`), a 3-step introduction on first launch, updated program guide.
- **Updates**: on start the app checks the latest release on GitHub and, if there is a newer version, says so — “Download” opens the release page, “Later” carries on (updating is always optional).
- **Project**: save and open a versioned `.json` (with the `.glb` models included), save as, autosave every minute with recovery after a crash, unsaved-changes warning when closing or opening another project; shortcuts menu and program guide.

### Ideas (backlog)

- Real terrain (DEM/SRTM), animated network traffic, export to the web, 2D logical network view, project templates.

## Technology

| Area | Choice |
|---|---|
| Core | [Rust](https://www.rust-lang.org) + [Tauri v2](https://v2.tauri.app) (files, presets, terrain generation, Dijkstra, PDF/CSV reports) |
| Frontend | [React](https://react.dev) + strict TypeScript + [Vite](https://vite.dev) |
| 3D | [three.js](https://threejs.org) (`OrbitControls`, `TransformControls`, `GLTFLoader`, `GLTFExporter`) |
| 3D models | [Blender](https://www.blender.org) 5 — a Python script builds the models and exports `.glb` + catalog thumbnails (authoring tool, not a runtime dependency) |
| Animation | [GSAP](https://gsap.com) (interface) and [anime.js](https://animejs.com) (3D and micro-interactions) |
| Data | projects in JSON (serde), models in `.glb` |
| Quality | rustfmt, clippy, ESLint, Prettier, `cargo test`, `tsc --noEmit` |
| Landing page | [Astro](https://astro.build) + [three.js](https://threejs.org) + [GSAP](https://gsap.com) (static page in `landing/`, deployed on [Vercel](https://vercel.com)) |
| Releases | GitHub Actions + [tauri-action](https://github.com/tauri-apps/tauri-action): installers for macOS (universal), Windows and Linux |

The frontend handles the 3D scene and the interface; everything that touches the disk or is heavy (noise, graphs) lives in the Rust core and reaches the frontend through Tauri commands, all called from `ui/src/net/bridge.ts`.

## Structure

```text
Terra_Map/
├── .github/workflows/      # release.yml: builds the installers for macOS, Windows and Linux (run by hand)
├── src-tauri/              # Rust core + Tauri
│   ├── src/
│   │   ├── main.rs         # startup and command registration
│   │   ├── commands.rs     # Tauri commands (thin)
│   │   ├── terrain.rs      # heightmap generation (Perlin/fBm)
│   │   ├── project.rs      # terrain presets on disk
│   │   ├── project_file.rs # versioned .json project, autosave, close warning
│   │   ├── glb.rs          # dialogs and .glb read/write
│   │   ├── network/        # simulator: graph, Dijkstra, metrics, coverage, CSV
│   │   ├── report/         # report: statistics, BOM, terrain profile, CSV, PDF
│   │   ├── update.rs       # update notice: latest release version, open the page
│   │   └── error.rs        # typed errors (thiserror)
│   ├── capabilities/
│   ├── icons/              # app icon: icon.svg (source) → `cargo tauri icon` (PNG, .icns, .ico)
│   └── tauri.conf.json
├── ui/                     # React + TypeScript frontend
│   ├── models/
│   │   └── build_models.py # Blender script: builds the 3D models, exports .glb + catalog thumbnails
│   ├── public/models/      # the exported .glb models and their .png thumbnails
│   ├── src/
│   │   ├── main.tsx        # creates the 3D scene and mounts <App />
│   │   ├── App.tsx         # layout
│   │   ├── components/     # top bar + menus, panels, viewport, simulator, modals (report, profile, reset…), spinner, toasts
│   │   ├── scene/          # viewport, camera, terrain (+ grid, material details), entities, models (.glb loader), roads (bridges), zones, cables, selection, gizmo, simulator overlay
│   │   ├── tools/          # brush, drag and drop, cable, marker, ruler, .glb import/export, simulator, project, report, update notice
│   │   ├── state/          # store, useStore hook, toast queue, texts (t/fmt), theme
│   │   ├── anim/           # animations (GSAP, anime.js, reduced motion)
│   │   ├── net/            # bridge to the Rust core
│   │   └── locales/        # interface texts (en.json)
│   ├── index.html
│   └── vite.config.ts
├── landing/                # landing page (Astro + three.js + GSAP): src/pages/index.astro, src/scripts/ (3D hero, Blender model showcase, motion, downloads), public/ (icon, app videos, Blender models)
├── Cargo.toml              # Rust workspace
└── package.json            # shortcuts to the ui/ scripts
```

## Getting started

Requirements: stable [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20+ and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your system.

```sh
npm install --prefix ui   # frontend dependencies
cargo tauri dev           # desktop app with hot reload
```

Other commands:

```sh
npm run dev               # frontend only, in the browser
cargo test                # Rust core tests
cargo fmt --check
cargo clippy -- -D warnings
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
cargo tauri build         # production installer
```

Landing page (`landing/`, Astro + three.js + GSAP):

```sh
npm install --prefix landing
npm --prefix landing run dev     # http://localhost:4321
npm --prefix landing run build   # static page in landing/dist
```

3D models (needs [Blender](https://www.blender.org) 5.x; rewrites `ui/public/models/`):

```sh
blender -b --factory-startup -P ui/models/build_models.py
```

## Publishing an update

1. Bump the version in `src-tauri/tauri.conf.json` (`version`, e.g. `0.2.0`) — and, to keep them in sync, in `src-tauri/Cargo.toml`, `package.json` and `ui/package.json` — and commit it.
2. Tag that commit and push the tag (the tag must be `v` + that version — the workflow checks it):

   ```sh
   git tag -a v0.2.0 -m "Terra_Map 0.2.0"
   git push origin v0.2.0
   ```

3. The **Release** workflow (Actions tab) builds on each system and attaches the installers to the release `v0.2.0`:
   - macOS: one universal `.dmg` (Apple Silicon and Intel);
   - Windows: `-setup.exe` and `.msi` (64-bit);
   - Linux: `.AppImage`, `.deb` and `.rpm` (64-bit).

   The release stays a draft until the three builds succeed; then it is published as the latest release. The workflow can also be started by hand: **Actions → Release → Run workflow**.
4. Anyone with the app installed gets the notice on the next start (updating is not mandatory), and the landing page's download buttons point to the new installers.

Notes:

- The macOS app is ad-hoc signed and not notarized (that needs a paid Apple Developer account): macOS blocks the first launch and the app opens via **System Settings › Privacy & Security › Open Anyway**. The Windows installers are not code-signed: SmartScreen may ask — **More info › Run anyway**. The release notes already say this.
- The update notice and the landing page read the latest release from the public GitHub API, so the repository has to stay public.
- `cargo tauri build` still works locally, but only for the system you are on (on a Mac: `target/release/bundle/dmg/Terra_Map_<version>_aarch64.dmg`).

## Landing page on Vercel

On Vercel: *Add New → Project*, import this repository and set **Root Directory = `landing`**. The **Astro** preset is detected automatically (build `npm run build`, output `dist`); no adapter is needed — the page is static. Node ≥ 22.23.4 (set in `landing/package.json`).

## Main shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + S` · `Shift + S` · `O` | save · save as · open project |
| `Ctrl/Cmd + E` / `I` | export / import `.glb` |
| `Ctrl/Cmd + Z` · `Shift + Z` | undo · redo |
| `Ctrl/Cmd + C` / `V` · `D` · `Delete` | copy / paste · duplicate · delete (selection) |
| `L` | layers and history |
| `B` (+ `Shift`) | brush: raise (lower) the terrain |
| `C` · `M` · `R` | cable tool · marker · ruler |
| `N` / `Shift + N` | next / previous element (selects and frames it) |
| `Tab` to the viewport, then arrows · `Shift` + arrows · `+`/`−` · `Space` | move · rotate · zoom · click at the crosshair |
| `W` / `E` / `T` | gizmo: move / rotate / scale |
| `↑` / `↓` (+ `Shift`, `Alt`) | adjust the focused spinner (×10, ÷10) |
| `F` · `1` / `2` / `3` · `Home` | focus the selection · top / front / iso view · reset the camera |
| `H` | mouse drag rotates / moves (pans) the camera |
| `G` | show/hide the grid (also View › Grid and Layers › Grid) |
| `Esc` | clear the selection |
| `?` | shortcuts menu |
