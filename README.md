# Terra_Map

Aplicação **desktop** para criar **maquetes 3D** de uma área: modelar o **terreno** (plano, montanhas, vale), colocar **infraestruturas** (casas, prédios, lotes) por arrastar e largar, montar **redes de telecomunicação** (antenas, OLT, splitters, ONU, cabos de fibra, cobre e coaxial) e **simular** a rede — caminho óptimo por cabo com o **algoritmo de Dijkstra**, latência, débito, cobertura de antena e link budget.

> Estado: **fases 0–13 feitas** (layout, viewport 3D, terrenos, infraestruturas, import/export `.glb`, redes e telecomunicação, simulador de redes, projecto `.json`, polish e qualidade, produtividade, ambiente, medição e relatórios, experiência e robustez); frontend em **React**; build de produção para macOS (`.app`/`.dmg`). Próximas ideias no backlog do roadmap.

## Funcionalidades

### Feito

- **Interface** estilo Apple: navbar superior (Save, Import, Export, Open), catálogo à esquerda, propriedades à direita, botão circular de atalhos e guia, painéis com efeito de vidro.
- **Viewport 3D** (three.js): órbita, pan e zoom com amortecimento; vistas topo, frente e isométrica (`1`/`2`/`3`, `Home`, `F`); selecção por clique; grelha (`G`); minimap de cima com clique para mover a câmara.
- **Terrenos**: presets plano, montanhas, vale e personalizado (seed, amplitude, frequência), gerados no núcleo Rust por ruído Perlin; pincel de escultura (`B`, `Shift` para baixar) com falloff gaussiano; gradiente de cor por altitude; guardar e carregar presets; importar heightmap PNG.
- **Infraestruturas**: casa, prédio (pisos ajustáveis) e lote; arrastar e largar com encaixe no relevo; fases de construção (fundações, estrutura, acabamento); posição, rotação e escala por spinners e setas (`Shift` ×10, `Alt` ÷10); gizmo de transformação; duplicar e eliminar; aviso de colisão.
- **Modelos `.glb`**: exportar a maquete ou a selecção, importar com validação; o modelo importado entra no catálogo como reutilizável.
- **Redes e telecomunicação**: antenas, routers, switches, OLT, ONU, splitters, postes e caixas de distribuição por arrastar e largar; ferramenta Cabo (`C`) com percursos subterrâneo (segue o relevo), aéreo (catenária) ou directo, em fibra, cobre ou coaxial; marcadores (`M`) com etiqueta e nota; propriedades dinâmicas chave-valor por elemento e por cabo; grafo da rede em memória.
- **Simulador de redes**: caminho óptimo por cabo com Dijkstra no núcleo Rust, por distância, custo, latência ou atenuação; latência, débito de gargalo, custo e atenuação ponta-a-ponta; link budget óptico com semáforo; simular falha de um elemento ou cabo e ver a rota alternativa; cobertura de antena com atenuação pelo relevo (heatmap); exportar resultados em CSV.
- **Produtividade**: desfazer/refazer até 100 acções (com histórico clicável), selecção múltipla (`Shift`+clique ou rectângulo com `Shift`+arrastar) com mover, alinhar, distribuir e eliminar em lote, copiar/colar, camadas (terreno, infraestruturas, redes, marcadores) com visibilidade e bloqueio, snap à grelha e a objectos, pesquisa no catálogo.
- **Ambiente**: ciclo dia/noite com sombras e céu em gradiente, névoa, lagos (plano de água), pincel de materiais (relva, terra, areia, rocha, neve), vegetação (árvores e arbustos com instancing), estradas desenhadas sobre o relevo, modo apresentação com voo de câmara.
- **Medição e relatórios**: régua (`R`) com distância 3D, horizontal e desnível; perfil do terreno entre os dois pontos (gráfico); relatório com estatísticas do projecto, lista de materiais (BOM com preços e mão de obra simbólicos) e a última simulação; comparador de cenários guardado no projecto; exportar o relatório em PDF (com imagem da maquete, gerado no núcleo Rust) e a BOM em CSV.
- **Experiência**: tema claro e escuro (contraste AA nos dois), português e inglês em toda a interface e no relatório, a app toda pelo teclado (viewport focável com mira — setas movem a câmara, `Espaço` clica, `N` salta para o elemento seguinte; catálogo por `Enter`), introdução de 3 passos na primeira execução, guia do programa actualizado.
- **Projecto**: guardar e abrir `.json` versionado (com os modelos `.glb` incluídos), guardar como, autosave a cada minuto com recuperação depois de um crash, aviso de alterações por guardar ao fechar ou abrir outro projecto; menus de atalhos e guia do programa.

### Ideias (backlog)

- Terreno real (DEM/SRTM), tráfego de rede animado, exportar para web, vista lógica 2D da rede, templates de projecto.

## Tecnologia

| Área | Escolha |
|---|---|
| Núcleo | [Rust](https://www.rust-lang.org) + [Tauri v2](https://v2.tauri.app) (ficheiros, presets, geração de terreno, Dijkstra, relatórios PDF/CSV) |
| Frontend | [React](https://react.dev) + TypeScript strict + [Vite](https://vite.dev) |
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
│   │   ├── project_file.rs # projecto .json versionado, autosave, aviso ao fechar
│   │   ├── glb.rs          # diálogos e leitura/escrita de .glb
│   │   ├── network/        # simulador: grafo, Dijkstra, métricas, cobertura, CSV
│   │   ├── report/         # relatório: estatísticas, BOM, perfil do terreno, CSV, PDF
│   │   └── error.rs        # erros tipados (thiserror)
│   ├── capabilities/
│   ├── icons/
│   └── tauri.conf.json
├── ui/                     # frontend React + TypeScript
│   ├── src/
│   │   ├── main.tsx        # cria a cena 3D e monta <App />
│   │   ├── App.tsx         # layout
│   │   ├── components/     # barra superior, painéis, viewport, simulador, modais (relatório, perfil…), spinner, toasts, menu de atalhos
│   │   ├── scene/          # viewport, câmara, terreno, entidades, cabos, selecção, gizmo, overlay do simulador
│   │   ├── tools/          # pincel, arrastar e largar, cabo, marcador, régua, import/export .glb, simulador, projecto, relatório
│   │   ├── state/          # store, hook useStore, fila de toasts, idioma (t/fmt), tema
│   │   ├── anim/           # animações (GSAP, anime.js, movimento reduzido)
│   │   ├── net/            # ponte para o núcleo Rust
│   │   └── locales/        # textos da interface: pt.json, en.json
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
| `Ctrl/Cmd + S` · `Shift + S` · `O` | guardar · guardar como · abrir projecto |
| `Ctrl/Cmd + E` / `I` | exportar / importar `.glb` |
| `Ctrl/Cmd + Z` · `Shift + Z` | desfazer · refazer |
| `Ctrl/Cmd + C` / `V` · `D` · `Delete` | copiar / colar · duplicar · eliminar (selecção) |
| `L` | camadas e histórico |
| `B` (+ `Shift`) | pincel: elevar (baixar) terreno |
| `C` · `M` · `R` | ferramenta cabo · marcador · régua |
| `N` / `Shift + N` | elemento seguinte / anterior (selecciona e enquadra) |
| `Tab` até ao viewport, depois setas · `Shift` + setas · `+`/`−` · `Espaço` | mover · rodar · zoom · clicar na mira |
| `W` / `E` / `T` | gizmo: mover / rodar / escalar |
| `↑` / `↓` (+ `Shift`, `Alt`) | ajustar o spinner focado (×10, ÷10) |
| `F` · `1` / `2` / `3` · `Home` | focar selecção · vistas topo / frente / iso · repor câmara |
| `G` | mostrar/esconder grelha |
| `Esc` | limpar selecção |
| `?` | menu de atalhos |
