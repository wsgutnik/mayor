# 03 — Plano de execução: M16 a M22

Atualizado em 2026-10-12. Ordem pensada para que cada marco deixe o jogo melhor sozinho e abra o seguinte:
primeiro a rede viária ganha nós (tudo o mais pendura neles), depois quadras/lotes (dependem dos lados dos
segmentos), depois subsolo (depende da rede e dos lotes para saber quem está ligado), depois água, render e
tipos de via/props. Donos: **lead** = Claude (código), **Muse** = assets Blender/texturas, **Codex** = testes e revisão.

Regras para todos os marcos: a sim continua pura e determinística (`src/sim`, vitest); o render só lê estado;
iPad é o alvo mínimo (instancing, sem pós-processamento fora do tier `high`); cada marco fecha com screenshot em
`docs/img/` e republicação de `docs/mayor-status.html` (ritual do PLAN.md).

---

## M16 — Rede viária com nós e geometria de cruzamento

**Objetivo.** Esquinas, cruzamentos e pontas de via com malha própria: asfalto contínuo, meio-fio que vira a esquina
com raio, calçada contínua, zebra e linha de retenção na linha do meio-fio, sem z-fighting. Resolve G1, G2, G3, G20.

**Abordagem técnica.**
1. `src/sim/roads.ts` (novo): `RoadNode { id, x, z, segs: number[] }`; `RoadSegment` ganha `a: nodeId, b: nodeId`
   (mantém `pts` e `tiles`). `addSegment(w, type, pts)`: snap das pontas a nó existente (raio 0,6) ou a ponto de um
   segmento (split em dois segmentos no ponto mais próximo da curva, nó novo); `removeSegment` funde nós de grau 2
   quando os dois lados têm a mesma classe. `nodeArms(w, node)` devolve os braços ordenados por ângulo com
   `halfWidth` por classe (`ROAD_DRAW_WIDTH/2`) e a tangente na ponta (derivada da Bézier).
2. Modo Pintar (`applyTool("road")`) passa a acumular tiles arrastados e, no `pointerup`, chama `placeRoad` com uma
   polilinha simplificada (Douglas–Peucker, tolerância 0,3) em vez de um segmento por tile.
3. `src/render/roads.ts` (novo, extraído de `buildRoadGeometry`): para cada segmento, fita encurtada até
   `cornerOffset = max(halfWidth dos braços vizinhos) + raio`; para cada nó com grau ≥ 2, polígono de asfalto a
   partir das interseções das bordas dos braços; fillet de meio-fio entre braços consecutivos com `r = 0.25` (rua)
   / `0.4` (avenida), 6 segmentos; calçada como faixa paralela ao fillet; grau 1 = cul-de-sac (semicírculo); grau 2
   com classes diferentes = transição. Zebra e retenção por braço, a `halfWidth` do centro do nó, só em nós de
   grau ≥ 3 e em braços de rua/avenida. Um único `lift = 0.06` para toda a rede; marcas a `+0.004`.
4. Materiais: asfalto e calçada em `MeshStandardMaterial` com `map` + `normalMap` (Muse), UV por metro ao longo da
   fita (`u = distância / 8`, `v` transversal 0..1) para o asfalto não "nadar" em curvas.
5. `connected`/tráfego continuam por tiles neste marco (sem mudança de regra); `traffic.ts` lê `segment.a/b` só
   para orientar carros no nó (heading suavizado).

**Critérios de aceitação (no jogo rodando).**
- Uma cruz, um T e uma curva de 90° de ruas mostram asfalto contínuo, meio-fio curvo nos quatro cantos e calçada
  sem buraco; ao girar a câmera não há cintilação em nenhum cruzamento.
- A zebra fica exatamente entre os dois meios-fios do braço, a ≤ 0,1 u da linha do nó; em um T há três zebras.
- Ponta de rua solta termina em cul-de-sac; rua que encontra avenida tem a transição sem degrau.
- Pintar 12 tiles arrastando cria 1 segmento (inspecionar `world.segments.length`), não 12.
- `npm test`: snap/split/merge determinísticos; segmentos removidos não deixam nó órfão.

**Dono.** lead (dados e geometria), Muse (texturas asfalto/calçada 1024 com normal, props de nó: semáforo, placa
de pare — usados em M21), Codex (testes de `roads.ts` e revisão de `roads.ts` de render). **Depende de:** —.

---

## M17 — Quadras e lotes (zone blocks)

**Objetivo.** Zona só a ≤ 4 células de uma via zoneável, grade alinhada ao segmento, lotes 1×1, 2×1 e 2×2 com
frente para a via, esquinas resolvidas, fundos encontrando no meio da quadra. Resolve G5, G6, G7.

**Abordagem técnica.**
1. `src/sim/zoning.ts` (novo): `buildZoneBlocks(w)` gera, por segmento de rua/avenida e por lado, células
   `(cx, cz, side, depthIdx 0..3, segId)` seguindo a curva (amostras a cada 1 u, normal à tangente). Rasteriza em
   `zoneable: Uint8Array` (bit por tile: lado/segmento dono = o mais próximo; empate = classe maior, depois id
   menor). Recalculado quando `segments` muda. Tile com via ou instalação nunca é zoneável.
2. `applyTool(res|com|ind)` recusa tile fora de `zoneable` ("Zona precisa estar a até 4 quarteirões de uma rua").
   Marquee: arraste pinta o retângulo ∩ `zoneable`.
3. `Lot { id, x, y, w, d, front: 0..3, zone, level, variant }` em `World.lots`; `growLots(w)`: a cada dia, para
   tiles zoneados sem lote, tenta formar 2×2 → 2×1 → 1×1 com a frente no tile de profundidade 0 do bloco dono;
   lote de esquina (tile pertence a dois blocos) escolhe o braço de classe maior. `level`, `CAPACITY`, `USAGE`
   passam a somar por lote × área (domicílios por célula como no CS1: lote 2×2 nível 1 = 4× o 1×1).
   `zone`/`level` por tile ficam como espelho derivado para infoviews, saves e testes existentes.
4. Catálogo (`src/sim/catalog.ts`): campo `footprint: [w, d]`; `zoneEntries(z, l, footprint)`.
5. Render: `zones` vira malha de grade por bloco (linhas 0,03 + preenchimento alpha 0,35, cor por zona) gerada em
   `src/render/zones.ts`; prédio posicionado no centro do lote, rotacionado pela `front`; `placeModel` recebe o
   lote. Peças de lote (gramado, cerca, garagem, vaga) como instâncias por lote.
6. Save: `lots` serializados; saves antigos migram gerando lotes 1×1 dos tiles com `level > 0`.

**Critérios de aceitação.**
- Pintar zona a 6 tiles de qualquer rua é recusado com mensagem; a 4 tiles é aceito.
- Em uma rua reta com 8 tiles de profundidade de cada lado, as células aparecem como grade colada à rua; em uma
  rua curva a grade acompanha a curva (sem escadinha de 1 tile).
- Quadra 10×10 com ruas ao redor: 4 células de cada lado zoneadas, miolo 2×2 não zoneável.
- Após 60 dias com demanda > 0, existem lotes 2×2 (inspecionar `world.lots.filter(l => l.w === 2)`), com o modelo
  virado para a rua da frente; lote de esquina entre rua e avenida vira para a avenida.
- `npm test`: cobertura de `buildZoneBlocks` (reta, curva, T, esquina), `growLots` determinístico, migração de save.

**Dono.** lead+muse (lead: sim/render; Muse: modelos 2×2 para R2/R3/C2/I2 dentro de 2×2 u, peças de lote).
Codex: testes e revisão. **Depende de:** M16.

---

## M18 — Redes de água/esgoto/energia e vista subterrânea

**Objetivo.** Canos e cabos reais sob as vias (modelo CS2), ligação manual da instalação à rede, cobertura por
distância ao cano (≤ 11 tiles, CS1), e um modo subterrâneo (tecla V / botão) que mostra tudo isso. Resolve G8, G9,
G10.

**Abordagem técnica.**
1. `src/sim/utilities.ts` (novo): `pipes: Uint8Array` por tile, bits `PIPE_WATER | PIPE_POWER` (esgoto usa a mesma
   rede de água, como no CS1). Ao construir rua/avenida, os tiles do segmento recebem ambos os bits; rodovia só
   energia. Ferramentas novas "Cano" e "Linha de energia" (₡20/tile) pintam bits em tiles sem via (ligação da
   bomba/usina até a rede; cruzam qualquer coisa, pois são subterrâneos).
2. `updateCoverage`: para POWER/WATER/SEWAGE, BFS sobre tiles com o bit a partir das instalações do tipo (bomba,
   caixa d'água, usina, subestação, saída de esgoto); tiles de rede alcançados ficam `energized/watered`; prédio
   (lote) é coberto se algum tile seu está a distância Chebyshev ≤ 11 (água) / adjacente a tile energizado ou a
   lote energizado (energia prédio-a-prédio, raio 2). Capacidade (`supply/demand`) continua como está. Serviços
   cívicos continuam por raio neste marco.
3. Render `src/render/underground.ts`: modo `underground` em `CityRenderer`: terreno com `MeshStandardMaterial`
   clone `transparent, opacity 0.35, color 0x1b2230, depthWrite false`; prédios/árvores/veículos `visible=false`;
   vias com opacidade 0,4 (material clone). Canos = `InstancedMesh` de cilindro (r 0,08) por tile + junta esférica
   em cruzamentos, cores: água `#2ea8e8`, energia `#f2c230`; tiles alcançados brilham (emissive), não alcançados
   cinza. Instalações de utilidade ficam visíveis e com halo. Peças de Muse (bomba, caixa d'água, poste de alta
   tensão, saída de esgoto, bueiro) substituem os cilindros quando carregadas.
4. HUD: botão "Subsolo" ao lado de Infoview, tecla V; abrir infoview de água ou energia entra no modo
   automaticamente (como o CS1 liga canos à info view); cobertura pintada nas vias (verde/cinza) e nos prédios
   (azul = ligado) em vez do tapete de tiles.
5. Save: `pipes` serializado; saves antigos: bits gerados a partir de `road`.

**Critérios de aceitação.**
- Construir bomba a 6 tiles da rua sem cano: prédios ficam sem água; desenhar o cano até a rua liga todos a ≤ 11
  tiles de qualquer tile da rede (ver cor azul nos prédios no infoview).
- Tecla V: terreno translúcido, canos sob todas as ruas, cano manual visível, prédios ocultos; V de novo volta.
- Cortar uma rua no meio: a metade sem bomba fica cinza no subsolo e os prédios perdem água em ≤ 2 dias.
- 60 fps no iPad com o modo subterrâneo em cidade de 2 000 tiles de rua (instâncias ≤ 4 000).
- `npm test`: BFS de rede, distância 11, migração de save, demanda/suprimento inalterados.

**Dono.** lead (sim/render/HUD), Muse (peças de subsolo e utilidades já em produção), Codex (testes de
`utilities.ts`, revisão). **Depende de:** M16, M17.

---

## M19 — Água com margem contínua, normais e reflexo

**Objetivo.** Margem que segue o relevo (sem serrilhado por tile), cor por profundidade, especular do sol,
reflexo do céu por Fresnel, espuma só nas margens e corredeiras, terreno molhado/escurecido sob a água. Resolve
G16, G17, G18.

**Abordagem técnica.**
1. `src/render/water.ts`: `uHeight` = `DataTexture` `(size+1)²` float (ou RG16 normalizado) com os cantos de
   `heights`, bilinear; no fragment `depth = 0.0 - h(x,z)`; `alpha = smoothstep(0, 0.12, depth) * 0.95`;
   `foam = (1 - smoothstep(0, 0.2, depth)) * noise + strength * crest`. A máscara por tile some.
2. Normais: duas normal maps 512 (Muse, tileáveis) roladas pelo campo de fluxo já existente (`info.gb`) com o
   crossfade de duas fases atual; `N = normalize(n0 + n1)`; Blinn-Phong com `uSunDir` real (vem de
   `setAtmosphere`) e `shininess 160`; Fresnel Schlick misturando `uSky`; tier `high` + desktop: reflexo planar
   (`THREE.Reflector`-like, render target 512) misturado por Fresnel; tiers menores: só céu.
3. Terreno: `MeshStandardMaterial` com `onBeforeCompile` que tinge por `h < 0` (areia → `#2b4a3a` a 2 u) e pinta
   faixa molhada para `0 < h < 0.25`.
4. Correção de `isLand`/margem: nada muda na sim; só o render deixa de depender de `wet` por tile.

**Critérios de aceitação.**
- Captura de um lago em zoom médio: contorno contínuo sem degraus; faixa de espuma só na borda rasa.
- Girar o dia (ciclo): o brilho do sol na água acompanha a posição do sol e some à noite.
- Rio com corredeira (bioma "river"): espuma e normais seguem o fluxo; lago parado não tem espuma no meio.
- iPad: ≥ 55 fps com a água na tela toda em tier `medium`; `high` em Mac liga o reflexo e mostra prédios refletidos.

**Dono.** lead (shaders), Muse (normal maps 512 tileáveis, textura de espuma), Codex (revisão de performance e
de `buildWaterInfo`). **Depende de:** — (pode andar em paralelo a M17/M18).

---

## M20 — Iluminação, materiais, terreno, LOD e tiers de qualidade

**Objetivo.** Render com sombras, tone mapping, texturas de alta densidade, terreno por camadas e LOD, com três
tiers que de fato mudam o custo. Resolve G11–G15, G19.

**Abordagem técnica.**
1. `src/render/lighting.ts` (novo): `renderer.toneMapping = ACESFilmic`, `outputColorSpace = SRGB`;
   `DirectionalLight.castShadow` com uma cascata que segue `rig.target` (ortho ±30 u, mapa 1024 `medium` / 2048
   `high`, `PCFSoft`, bias ajustado); `low` sem sombra. Domo de céu (`SphereGeometry` invertida, gradiente por
   `tod`, sol como disco emissivo) substitui `scene.background`. `HemisphereLight` mantido com intensidade menor.
2. Materiais: terreno e vias para `MeshStandardMaterial` (roughness 0,9/0,8); atlas de janelas 512 e detail maps
   1024 (albedo + normal + roughness) de Muse; `anisotropy = renderer.capabilities.getMaxAnisotropy()`.
3. `src/render/terrain.ts` (extraído): malha `2n × 2n`; shader de 4 camadas (grama, areia, rocha, pavimento) por
   altura/inclinação + `maskTex` pintada por vias (faixa de 0,5 u de pavimento em torno da calçada) e por lotes
   (gramado/pavimento); normal map de detalhe.
4. LOD: para cada modelo, `LOD1` exportado pelo Blender (`--lod`, ≤ 100 tris, textura 128) como segundo
   `InstancedMesh`; a cada rebuild e a cada mudança de zoom > 10 %, instâncias são repartidas por distância ao
   alvo (`dist > 45 u` → LOD1); árvores viram billboard cruzado em LOD1. Chunks 16 × 16 com `frustumCulled`.
5. Rebuild incremental: `revision` vira `{terrain, roads, lots, utilities}`; `rebuild()` só refaz o que mudou.
6. `prefs.ts`: `QUALITY_PROFILE = {low: {shadow: 0, msaa: 0, lod: 30, veg: 0.5}, medium: {1024, 2, 45, 1},
   high: {2048, 4, 70, 1, ssao: desktop}}`; SSAO/bloom (`EffectComposer`) só em `high` em desktop.

**Critérios de aceitação.**
- Ao meio-dia os prédios projetam sombra no chão e na rua; ao entardecer as sombras se alongam; `low` não tem sombra.
- Zoom máximo numa fachada: tijolo/asfalto nítidos (sem blocos visíveis) em iPad 2× DPR.
- Terreno: areia só na margem, rocha nas encostas > 35°, pavimento em volta das calçadas e sob os lotes.
- Afastar a câmera a 80 u: contagem de triângulos (`renderer.info.render.triangles`) cai ≥ 50 % em relação a
  sem LOD; em cidade de 3 000 lotes, iPad `medium` ≥ 45 fps, Mac `high` ≥ 60 fps.
- Pintar 1 zona não refaz vias (medir `rebuildRoads` chamadas = 0).

**Dono.** lead+muse (Muse: detail maps 1024, atlas de janelas, exportação de LOD por modelo em `build_all.py`
`--lod`), Codex (benchmark de `renderer.info`, revisão de `lighting.ts`). **Depende de:** M16 (vias em
`MeshStandard`), M17 (lotes para máscara do terreno).

---

## M21 — Tipos de via, mão única, rotatória, semáforos e props de calçada

**Objetivo.** Vocabulário de vias do CS: rua 2 faixas, avenida 4 faixas com canteiro, rodovia com barreira e
rampas, mão única, rotatória como ferramenta, semáforo/pare por regra de classe, postes, hidrantes, bancos e
árvores de calçada ligados ao segmento. Resolve G4, G21.

**Abordagem técnica.**
1. `RoadSegment.oneWay?: boolean` (direção a→b); `lanes` por classe em `src/sim/roads.ts` (offset lateral e
   sentido); `traffic.ts` respeita `oneWay` no A* (aresta só no sentido) e usa `lanes` para o offset.
2. Nó: `trafficLight` quando ≥ 1 braço é avenida e grau ≥ 3 (regra da wiki: 4 faixas gera, 2 faixas não);
   `stopSign` nos braços de rua que entram em avenida. Ferramenta "Rotatória" (raio 2/3 u): cria 4 segmentos em
   arco de rua mão única em volta do ponto, liga braços existentes.
3. Props por faixa (`laneProps`): poste a cada 6 u alternando lados, árvore a cada 4 u em "rua arborizada",
   hidrante a cada 12 u, banco perto de parque; instanciados em `src/render/props.ts` a partir dos pontos da curva.
4. Upgrade de via: ferramenta troca a classe do segmento mantendo nós.

**Critérios de aceitação.**
- Rua mão única desenhada de A a B: carros só no sentido A→B; A* não usa o sentido inverso (teste).
- Cruzamento rua × avenida: semáforo nos 4 cantos e placa de pare na rua; rua × rua: nada.
- Rotatória de 4 braços funciona com tráfego girando no sentido correto; nenhuma zebra dentro do anel.
- Avenida com canteiro central e postes duplos; rua arborizada com árvores a cada 4 u que viram o lote em 1 tile.

**Dono.** lead, Muse (semáforo, placa, barreira, canteiro, árvores de rua — já em produção), Codex (testes do A*
com mão única). **Depende de:** M16, M20 (materiais).

---

## M22 — Polimento de cena: vegetação, distritos e câmera

**Objetivo.** Fechar a sensação "Cities: Skylines": grama com cards perto da câmera, bordas de distrito, pinos
de câmera (orbit mais baixo com colisão no terreno), chuva molhando o asfalto, e revisão final das capturas de
`docs/img/` contra `screenshots/`.

**Abordagem técnica.** Grama instanciada (cards cruzados, 2 000 instâncias no raio de 20 u do alvo, só `medium+`);
`districts: Uint8Array` + pintura de distrito com borda em linha no terreno; `camera.ts` pitch mínimo 0,15 com
altura mínima acima do relevo; asfalto com `roughness` menor na chuva. Nada novo na sim além de `districts`.

**Critérios de aceitação.** Captura comparável a `screenshots/steam-0x.jpg` em enquadramento baixo; grama visível
só perto; FPS inalterado em `low`.

**Dono.** lead+muse, Codex (revisão). **Depende de:** M20, M21.

---

## Resumo da ordem e do que o usuário vai ver primeiro

| Marco | Entrega visível | Queixa atendida |
|---|---|---|
| M16 | Esquinas e cruzamentos de verdade | ruas sem esquinas |
| M17 | Grade de zona colada à rua, lotes 2×2 virados para a rua | quadras |
| M18 | Canos/cabos e tecla V | vista subterrânea |
| M19 | Água com margem lisa, brilho do sol e reflexo | água |
| M20 | Sombras, texturas 1024, terreno por camadas, LOD | render pobre |
| M21 | Mão única, rotatória, semáforos, postes/árvores | ruas (complemento) |
| M22 | Grama, distritos, câmera baixa | acabamento |
