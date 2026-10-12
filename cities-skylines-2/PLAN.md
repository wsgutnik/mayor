# Mayor — plano (city builder inspirado em Cities: Skylines II; Mac, Windows, iPad)

Referência visual: `screenshots/` (local, fora do git). Fontes em `SOURCES.md`.

## Decisão de stack

**TypeScript + Three.js (WebGL) + Vite**, simulação em TS puro e testável.

| Plataforma | Entrega |
|---|---|
| iPad | PWA (Add to Home Screen, fullscreen) → depois Capacitor/App Store se quiser |
| Mac | Tauri (Rust já instalado) ou o próprio navegador |
| Windows | Tauri (build .msi/.exe; precisa compilar no Windows ou CI) |

Por quê: uma base de código só, roda nas 3 plataformas, toque + mouse, e dá para
verificar visualmente aqui no browser embutido. Godot/Unity exigiriam editor e
export por plataforma. Custo: teto de performance menor que engine nativa
(milhares de prédios OK; centenas de milhares de agentes, não).

## Escopo honesto

CS2 é um jogo de ~100 pessoas e anos de trabalho. Meta: **núcleo jogável** que
reproduz o loop (terreno → estradas → zonas → cidade cresce → economia) e a
linguagem visual da UI. Não é paridade de features.

## Marcos

| # | Marco | Entrega |
|---|---|---|
| M1 | **Núcleo jogável** ✅ feito | Terreno, câmera mouse+toque, estradas, zonas R/C/I, bulldoze, crescimento, demanda RCI, orçamento/impostos, HUD, testes |
| M2 | ✅ Serviços | Energia, água, esgoto, coleta de lixo; cobertura por raio; overlays de infoview |
| M3 | ✅ Serviços cívicos | Polícia, bombeiros, saúde, educação, parques; felicidade e valor do solo |
| M4 | ✅ Estradas livres | Curvas/Bézier, tipos de via, interseções, cruzamentos, terreno cortado |
| M5 | ✅ Agentes | Cidadãos/veículos com pathfinding (A*/flow), tráfego, congestionamento |
| M6 | ✅ Transporte público | Ônibus, metrô, linhas e paradas |
| M7 | ✅ Persistência e meta | Salvar/carregar, mapas, conquistas leves, ciclo dia/noite, clima |
| M8 | Empacotamento | PWA offline, Tauri Mac/Win, ícones, perf no iPad |

## Arquitetura

```
src/sim/      lógica pura (sem DOM/three): mundo, regras, tick  → vitest
src/render/   three.js: terreno, instâncias, câmera, picking
src/ui/       HUD em DOM/CSS (barra superior, toolbar, RCI, orçamento)
src/input.ts  mouse/teclado/toque → intenções (pan, zoom, rotate, paint)
src/main.ts   loop: input → sim (ticks por velocidade) → render → HUD
```

Princípios: sim determinística (RNG com seed), render só lê estado e reconstrói
quando `world.revision` muda, UI nunca altera o mundo direto — usa `applyTool`.

## Verificação

- `npm test`: regras da sim (conectividade, crescimento, economia, determinismo).
- `npm run build`: tipos + bundle.
- Browser: screenshots do jogo comparadas com `screenshots/` para o visual de UI.

## Ritual a cada etapa

Ao fechar um marco: editar o objeto `DATA` em `docs/mayor-status.html` (status dos marcos,
checks, log, screenshot em `docs/img/`) e republicar o mesmo arquivo no Artifact
https://claude.ai/artifact/VdToX8pcS7bZcKx1m65Abu (passando `files` com as imagens).
