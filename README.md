# Terra_Map

Aplicação **desktop** para criar **maquetes 3D** de uma área: modelar o **terreno** (plano, montanhas, vale), colocar **infraestruturas** (casas, prédios, lotes) por arrastar e largar, montar **redes de telecomunicação** (antenas, OLT, splitters, ONU, cabos de fibra, cobre e coaxial) e **simular** a rede — caminho óptimo por cabo com o **algoritmo de Dijkstra**, latência, débito, cobertura de antena e link budget.

> Estado: **em desenvolvimento**. Fases 0–5 feitas (layout, viewport 3D, terrenos, infraestruturas, import/export `.glb`). Redes, simulador e projecto `.json` por fazer. O frontend vai passar de TypeScript simples para **React** (planeado, ainda sem código).

## Funcionalidades

### Feito

- **Interface** estilo Apple: navbar superior (Save, Import, Export, Open), catálogo à esquerda, propriedades à direita, botão circular de atalhos e guia, painéis com efeito de vidro.
- **Viewport 3D** (three.js): órbita, pan e zoom com amortecimento; vistas topo, frente e isométrica (`1`/`2`/`3`, `Home`, `F`); selecção por clique; grelha (`G`).
- **Terrenos**: presets plano, montanhas, vale e personalizado (seed, amplitude, frequência), gerados no núcleo Rust por ruído Perlin; pincel de escultura (`B`, `Shift` para baixar) com falloff gaussiano; gradiente de cor por altitude; guardar e carregar presets; importar heightmap PNG.
- **Infraestruturas**: casa, prédio (pisos ajustáveis) e lote; arrastar e largar com encaixe no relevo; fases de construção (fundações, estrutura, acabamento); posição, rotação e escala por spinners e setas (`Shift` ×10, `Alt` ÷10); gizmo de transformação; duplicar e eliminar; aviso de colisão.
- **Modelos `.glb`**: exportar a maquete ou a selecção, importar com validação; o modelo importado entra no catálogo como reutilizável.

### Planeado

- **Redes e telecomunicação**: antenas, routers, switches, OLT, ONU, splitters, postes, caixas; cabos subterrâneos (seguem o relevo), aéreos (catenária) ou directos; marcadores; propriedades dinâmicas por elemento.
- **Simulador**: Dijkstra no núcleo Rust com peso por distância, custo, latência ou atenuação; latência e débito ponta-a-ponta; link budget; heatmap de cobertura; simulação de falha de nó ou cabo; exportar resultados em CSV.
- **Projecto**: guardar e abrir `.json` versionado, autosave, aviso de alterações por guardar.
- **Depois**: undo/redo, camadas, ciclo dia/noite, água, estradas, vegetação, régua, perfil do terreno, BOM e relatório PDF, tema escuro, inglês.

## Tecnologia

| Área | Escolha |
|---|---|
| Núcleo | [Rust](https://www.rust-lang.org) + [Tauri v2](https://v2.tauri.app) (ficheiros, presets, geração de terreno, Dijkstra) |
| Frontend | TypeScript strict + [Vite](https://vite.dev) — migração para [React](https://react.dev) planeada |
| 3D | [three.js](https://threejs.org) (`OrbitControls`, `TransformControls`, `GLTFLoader`, `GLTFExporter`) |
| Animação | [GSAP](https://gsap.com) (interface) e [anime.js](https://animejs.com) (3D e micro-interacções) |
| Dados | projectos em JSON (serde), modelos em `.glb` |
| Qualidade | rustfmt, clippy, ESLint, Prettier, `cargo test`, `tsc --noEmit` |

O frontend faz a cena 3D e a interface; tudo o que toca no disco ou é pesado (ruído, grafos) vive no núcleo Rust e chega ao frontend por comandos Tauri, todos chamados a partir de `ui/src/net/bridge.ts`.

## Estrutura

```text
Terra_Map/
├── src-tauri/              # núcleo Rust + Tauri
│   ├── src/
│   │   ├── main.rs         # arranque e registo dos comandos
│   │   ├── commands.rs     # comandos Tauri (finos)
│   │   ├── terrain.rs      # geração de heightmap (Perlin/fBm)
│   │   ├── project.rs      # presets de terreno em disco
│   │   ├── glb.rs          # diálogos e leitura/escrita de .glb
│   │   └── error.rs        # erros tipados (thiserror)
│   ├── capabilities/
│   ├── icons/
│   └── tauri.conf.json
├── ui/                     # frontend React + TypeScript
│   ├── src/
│   │   ├── main.tsx        # cria a cena 3D e monta <App />
│   │   ├── App.tsx         # layout
│   │   ├── components/     # barra superior, painéis, viewport, spinner, toasts, menu de atalhos
│   │   ├── scene/          # viewport, câmara, terreno, entidades, cabos, selecção, gizmo
│   │   ├── tools/          # pincel, arrastar e largar, cabo, marcador, import/export .glb
│   │   ├── state/          # store, hook useStore, fila de toasts
│   │   ├── anim/           # animações (GSAP, anime.js, movimento reduzido)
│   │   ├── net/            # ponte para o núcleo Rust
│   │   └── locales/        # pt, en
│   ├── index.html
│   └── vite.config.ts
├── scripts/                # utilitários (gerar ícone)
├── Cargo.toml              # workspace Rust
└── package.json            # atalhos para os scripts de ui/
```

## Como correr

Requisitos: [Rust](https://rustup.rs) estável, [Node.js](https://nodejs.org) 20+ e os [pré-requisitos do Tauri v2](https://v2.tauri.app/start/prerequisites/) para o teu sistema.

```sh
npm install --prefix ui   # dependências do frontend
cargo tauri dev           # app desktop com hot reload
```

Outros comandos:

```sh
npm run dev               # só o frontend, no browser
cargo test                # testes do núcleo Rust
cargo fmt --check
cargo clippy -- -D warnings
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
cargo tauri build         # instalador de produção
```

## Atalhos principais

| Atalho | Acção |
|---|---|
| `Ctrl/Cmd + E` / `I` | exportar / importar `.glb` |
| `Ctrl/Cmd + D` · `Delete` | duplicar · eliminar |
| `B` (+ `Shift`) | pincel: elevar (baixar) terreno |
| `W` / `E` / `T` | gizmo: mover / rodar / escalar |
| `↑` / `↓` (+ `Shift`, `Alt`) | ajustar o spinner focado (×10, ÷10) |
| `F` · `1` / `2` / `3` · `Home` | focar selecção · vistas topo / frente / iso · repor câmara |
| `G` | mostrar/esconder grelha |
| `Esc` | limpar selecção |
