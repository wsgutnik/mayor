# 02 — Lacunas: Mayor (M15) × referência

Atualizado em 2026-10-12. Cada item diz o que o código faz hoje (lido, não suposto; arquivo:linha de `src/`),
o que a referência faz (ver `01-pesquisa.md`) e o conserto. Prioridade: alta = explica uma das cinco queixas da revisão.

## As cinco queixas e as lacunas que as explicam

| Queixa | Lacunas |
|---|---|
| Ruas sem esquinas (cruzamentos, curvas, calçadas) | G1, G2, G3, G4 |
| Quadras mal estruturadas | G5, G6, G7 |
| Render pobre | G11, G12, G13, G14, G15 |
| Sem vista subterrânea | G8, G9, G10 |
| Água estranha | G16, G17, G18 |

## Vias

**G1 — Não existe nó; só segmentos sobrepostos** (alta)
- Observado: `World.segments: RoadSegment[]` com `pts` (2 ou 3 pontos) e `tiles` (`src/sim/world.ts:82-91`); `rebuildRoadRaster` grava só a classe por tile (`world.ts:432`). Conectividade é BFS 4-vizinhos sobre tiles (`world.ts:253`). Um segmento que encosta noutro não é dividido nem ganha um nó; `placeRoad` só empurra o segmento na lista (`src/sim/sim.ts:221`).
- Referência: rede = segmentos ligados por nós; nó em cada ponta; o nó é onde moram cruzamento, semáforo, transição de tipo e fim de via (TM:PE, Road Editor).
- Conserto: grafo `nodes[] / segments[a,b]`, split de segmento ao encostar, nó com lista de braços ordenados por ângulo.

**G2 — Geometria de cruzamento inexistente; fitas se cruzam com z-fighting disfarçado** (alta)
- Observado: `buildRoadGeometry` desenha cada segmento como fitas independentes (asfalto, meio-fio, faixa) e dá a cada segmento um `lift = 0.07 + (n % 7) * 0.002` para que não briguem na GPU (`src/render/scene.ts:650-673`). Em um T ou cruz, as fitas simplesmente passam uma por cima da outra; o meio-fio do segmento que continua atravessa a boca do que chega (visível na captura). Pontas de rua morrem retas, sem cul-de-sac.
- Referência: nó tem malha própria ("straight stub" dobrado), uma aresta por lado entre calçadas, calçada 0,3 u acima do asfalto, `Min Corner Offset` para o raio da esquina (Road Editor).
- Conserto: malha de nó: polígono de asfalto entre os braços, meio-fio contínuo com arco (fillet) entre braços vizinhos, calçada que vira a esquina; segmentos encurtados até a borda do nó; um único `lift` para toda a rede.

**G3 — Faixa de pedestres por heurística, não por nó** (alta)
- Observado: `touches()` procura segmentos a ±1 tile da ponta e desenha zebra a 0,8 do fim do segmento (`scene.ts:674-731`). Em T a zebra do braço que continua não existe; em cruzamento de via pintada tile a tile (modo Pintar cria segmentos de 1 tile, `sim.ts:310`) aparecem zebras repetidas.
- Referência: zebra/linha de retenção são parte do nó; semáforo só onde a classe pede (2 faixas nunca; 4 faixas quase sempre) (wiki Roads).
- Conserto: zebra e retenção geradas por braço do nó, na linha do meio-fio; semáforo/pare como prop do nó por regra de classe.

**G4 — Vias sem mão única, sem faixas, sem props de via** (média)
- Observado: `ROAD = {STREET, AVENUE, HIGHWAY}` (`world.ts:70`); nenhuma direção; tráfego usa offset fixo de 0,12 para "faixa" só no render (`scene.ts:910`). Postes a cada 4 tiles de rua por hash (`scene.ts:549-570`); sem semáforo, placa, hidrante, árvore de calçada, estacionamento.
- Referência: faixas com tipo (Vehicle/Pedestrian/Parking), props de faixa com `Repeat Distance`; mão única definida pela direção do traçado; estacionamento em vias sem decoração; rotatórias (wiki Roads, Road Editor, CS2).
- Conserto: `lanes` por classe no segmento; mão única; props por faixa (Muse já produz); rotatória como ferramenta.

## Quadras e lotes

**G5 — Zona pode ser pintada em qualquer tile, sem profundidade** (alta)
- Observado: `applyTool` só exige terra, sem via e sem instalação no tile (`sim.ts:311-319`); crescimento exige `isServed` = tile 4-vizinho de uma rua conectada (`world.ts:276`, `sim.ts:439`). Resultado: uma faixa de zona a 1 tile da via cresce, mas o jogador pode pintar um tapete verde a 10 tiles (como na captura, à direita), que nunca cresce e não é uma quadra.
- Referência: grade de zona aparece com a via, só até 4 células (32 m) da via, alinhada ao segmento (wiki Zoning, manual).
- Conserto: máscara `zoneable` (distância ≤ 4 de via zoneável, por lado de segmento); ferramenta só pinta dentro dela; render da grade por segmento.

**G6 — Lote = 1 tile; sem frentes, fundos, esquinas nem tamanhos** (alta)
- Observado: `zone/level` por tile (`world.ts:108-110`); render coloca um modelo por tile no centro, escala 0.92–1.12 por hash, `facing()` vira para a primeira via adjacente na ordem +z, +x, −z, −x (`scene.ts:588-610`). Catálogo não tem footprint (`src/sim/catalog.ts`). Modelos Blender são "inside the tile" (`blender/README.md`).
- Referência: prédios 1×1 a 4×4 células com frente na via; esquinas ficam com o bloco do segmento dono; domicílios por célula (wiki Zoning, Asset Editor).
- Conserto: entidade `Lot {x,y,w,d,front,zone,level}` montada a partir de tiles zoneados contíguos do mesmo bloco; crescimento por lote; catálogo com `footprint`; Muse produz 2×2 e peças de lote (gramado, cerca, garagem, estacionamento).

**G7 — Render da zona é um quadrado flutuante por tile** (média)
- Observado: `zones` = `InstancedMesh` de caixas 0.97 com cor chapada, a `h + 0.04 - 0.5` (`scene.ts:526-532`); não mostra a grade, não distingue lote vazio de lote em construção, não respeita a via curva.
- Referência: grade de células translúcida ao lado da via, cor por tipo/densidade, que some quando o prédio nasce.
- Conserto: malha de grade por bloco (linhas + preenchimento alpha), gerada com a grade do G5.

## Subsolo e utilidades

**G8 — Serviços por raio; não existe rede de canos nem cabos** (alta)
- Observado: `updateCoverage` pinta bit por raio euclidiano (`world.ts:308-338`); bomba/esgoto só exigem água a ≤ 3 tiles (`sim.ts:291`). Nada liga bomba → prédio.
- Referência: rede única de canos (₡20/célula), prédio atendido a ≤ 11 células de cano; energia prédio-a-prédio em curta distância + linhas; CS2 traz canos/cabos com a via (wiki Water_and_sewage, Electricity, CS2 Roads).
- Conserto: `pipes: Uint8Array` por tile (bits água/esgoto/energia), automático sob vias (modelo CS2) + ferramenta de cano/linha para ligar instalação à rede; cobertura por distância ao cano (BFS) em vez de raio.

**G9 — Não há vista subterrânea** (alta)
- Observado: `setOverlay` só liga a `overlay` (caixas translúcidas 0.02 de altura a `h + 0.12`) (`scene.ts:956-1001`); terreno e prédios continuam opacos; não existe nada abaixo do solo para mostrar. Sem tecla/botão.
- Referência: Page Down / V / botão ao lado do bulldozer; a info view Water mostra canos e correntes; terreno translúcido com vias como referência.
- Conserto: modo `underground`: terreno com material translúcido escuro, prédios ocultos ou fantasma, vias mantidas em 40 % de alpha, canos/cabos como tubos instanciados coloridos, bombas/saídas em destaque; atalho V e botão no HUD; infoviews de água/energia abrem o modo.

**G10 — Infoviews pintam tiles, não vias/prédios** (média)
- Observado: overlay de cobertura é um tapete de tiles (`rebuildOverlay`), inclusive sobre mato.
- Referência: cobertura pintada nas vias (verde/cinza/vermelho) e nos prédios (azul = ligado) (manual, Info_views).
- Conserto: cor por via (instância de malha de via) e por prédio (`instanceColor`) no infoview; tapete só para valor do solo/poluição.

## Render

**G11 — Sem sombras, sem tone mapping, Lambert** (alta)
- Observado: nenhum `castShadow`/`shadowMap` em `src/render`; `renderer.toneMapping` não é definido (fica `NoToneMapping`); terreno e vias são `MeshLambertMaterial` com cor multiplicada 1.3/1.35 para compensar (`scene.ts:177, 450`); apenas `HemisphereLight` + `DirectionalLight` (`scene.ts:164-168`). Céu é uma cor chapada (`scene.background`).
- Referência: CS tem sombras direcionais, LOD, AA, DoF opcional; iluminação física com mapa de iluminação por prédio (Asset Editor, guia de opções do CS2).
- Conserto: sombra direcional de uma cascata que segue o alvo da câmera (1024/2048 por tier), `MeshStandardMaterial` em terreno e vias, `ACESFilmic` + `SRGBColorSpace`, domo de céu com gradiente e sol, tier `low` sem sombra.

**G12 — Texturas em 128 px e janelas em 64 px** (alta)
- Observado: `public/textures/asphalt.png` e `grass.png` 128 × 128, `brick.png` 256 × 256 (geradas por `blender/make_textures.py`); atlas de janelas 64 × 64 (`src/render/models.ts:279`); grama repetida a cada 3 tiles (`scene.ts:453`); asfalto a cada 0,6 u (`scene.ts:645`).
- Referência: 1024² por prédio, 2048 × 1024 para grandes, LOD 128² (Asset Editor). O usuário pediu "alta densidade de pixels".
- Conserto: Muse entrega detail maps 512–1024 (albedo + normal + roughness) e atlas de janelas 512; `anisotropy` = máximo do dispositivo; mipmaps; repetição por metro coerente (tile = 8 m).

**G13 — Terreno: 1 vértice por tile, cor por altura, sem splat** (alta)
- Observado: `PlaneGeometry(n, n, n, n)` (`scene.ts:441`), cor por faixa de altura (`updateTerrain`, `scene.ts:456-476`), uma textura de grama; areia é só "h < 0.3". Sem normal map, sem transição de material por inclinação, sem calçada/pavimento sob prédios.
- Referência: relevo a 16 m, mas texturas de superfície por tipo (grama, pavimento, cascalho, "ruining") com máscaras `_p`/`_r` da via pintando o chão em volta (Road Editor).
- Conserto: shader de terreno com 3–4 camadas (grama, areia, rocha, pavimento) misturadas por altura/inclinação + máscara pintada por vias e lotes; subdivisão 2× perto da câmera (ou simplesmente n×2 na malha, 128² → 256² vértices é barato).

**G14 — Sem LOD nem orçamento de triângulos** (média)
- Observado: um `InstancedMesh` por modelo, capacidade `size² × 0.6` (`scene.ts:258`); todo modelo é desenhado inteiro em qualquer distância; árvores idem; `frustumCulled = false` em tudo.
- Referência: LOD ≈ 100 tris por growable, billboard para árvores, "Level of Detail" como opção (Asset Editor, opções CS2).
- Conserto: dois `InstancedMesh` por modelo (LOD0/LOD1), partição por distância ao alvo da câmera a cada rebuild/zoom; billboard de árvore; culling por chunk 16 × 16.

**G15 — Qualidade = só pixel ratio** (média)
- Observado: `QUALITY_PIXEL_CAP = {low: 1, medium: 1.5, high: 2}` (`src/prefs.ts:20`) e adaptação por tempo de quadro (`scene.ts:1046`). Nada mais muda entre tiers.
- Conserto: tier controla sombra (off/1024/2048), AA (MSAA 0/2/4), LOD distance, SSAO/bloom (só high em desktop), densidade de vegetação.

## Água

**G16 — Margem na resolução do tile** (alta)
- Observado: `buildWaterInfo` gera uma textura `size × size` com máscara `wet` por tile e profundidade `max(0,-h)/2.5` (`src/render/water.ts:5-46`); o shader faz `smoothstep(0.2, 0.6, info.a)` e `discard` (`water.ts:108-109`). Com `LinearFilter` a borda vira um degrau borrado de 1 tile; a captura mostra lagos com contorno serrilhado.
- Referência: a margem é a interseção da lâmina com o relevo (CS usa o relevo a 16 m e a água a resolução de simulação própria; visualmente a linha é contínua).
- Conserto: shader lê o heightmap de cantos `(size+1)²` bilinear e calcula `depth = waterLevel − h(x,z)` por fragmento; alpha e espuma vêm dessa profundidade, não da máscara.

**G17 — Sem normais, sem reflexo, "glint" sem direção do sol** (alta)
- Observado: cor = mistura raso/fundo + ruído de valor; "glint" é limiar do ruído vezes `uSun` (`water.ts:125-135`); sem normal, sem Fresnel, sem reflexo do céu/prédios; plano opaco a 0,9.
- Conserto: duas normal maps roladas pelo campo de fluxo (Muse), Fresnel com cor do céu, especular Blinn-Phong com a direção real de `sun`, reflexo planar só no tier high (desktop); profundidade controla transparência (0.55 raso → 0.95 fundo).

**G18 — Terreno sob a água e margem molhada** (média)
- Observado: terreno continua com grama/areia por altura até qualquer profundidade; não há escurecimento nem faixa molhada; `isLand` exige cantos ≥ 0.05, então existe uma borda de "quase terra" com areia clara e água rasa sem espuma suficiente.
- Conserto: no shader do terreno, tint por profundidade (areia → verde-escuro) e faixa molhada 0,3 u acima do nível; espuma de margem concentrada em `depth < 0.15`.

## Outras lacunas vistas no código (não ligadas diretamente às queixas)

- **G19 — Rebuild total a cada revisão** (média): `rebuild()` refaz terreno, vias e todas as instâncias (`scene.ts:478-585`) a cada `revision`. Com nó/lote/subsolo isso fica mais caro; precisa de revisões separadas (terreno, vias, lotes, subsolo). Já apontado em `docs/REVIEW-codex.md` item 10.
- **G20 — Modo Pintar cria segmentos de 1 tile** (média): `applyTool("road")` chama `placeRoad` com dois pontos iguais (`sim.ts:310`); com nós, cada tile pintado viraria um nó. Pintar deve virar "linha com snapping à grade" ou agregar tiles contíguos num segmento.
- **G21 — Vegetação sem variação de chão** (baixa): árvores por hash em tile livre (`scene.ts:500-525`); sem grama alta, sem canteiros de calçada, sem árvores de rua ligadas à via.
