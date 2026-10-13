# 04 — Grades, cruzamentos e desenho de vias: como o Cities: Skylines faz e o que o Mayor deve fazer

Atualizado em 2026-10-12. Responde ao pedido "precisa detectar melhor; pesquisar como o Cities: Skylines monta essas grades,
desenhar melhor, talvez uma versão mais compatível do mapa via Blender, mais pixels". Não repete `01-pesquisa.md`
(escala 8 m, nós/segmentos, 5 elevações, limites do jogo); complementa com o que faltava: o **algoritmo** da grade de zona,
as **regras de cruzamento × separação de nível**, o **render** da via e o **fluxo Blender → Three.js**.

Convenções: **[fonte]** = o que a fonte afirma, com os números como estão lá. **[código]** = lido no código do jogo copiado pelo mod
Zoning Adjuster (cópia 1:1 de `RoadAI.CreateZoneBlock`, `ZoneBlock.CalculateBlock1` e `CalculateImplementation2` do CS1, com os
trechos do mod marcados). **[inferência]** = conclusão minha, não escrita na fonte. **Não verificado** = tentei e não achei fonte.

## 0. Estado das fontes

| Fonte | Resultado |
|---|---|
| Código do CS1 (via `algernon-A/ZoningAdjuster`, `Code/Patches/CreateZoneBlocks.cs`, `CalcBlock1Patch.cs`, `CalcImpl2Patch.cs`) | **Obtido** pela API do GitHub. É a fonte mais sólida deste documento: contém constantes e regras exatas da grade de zona. |
| https://cs2.paradoxwikis.com/Roads e /Zoning | **Obtido.** Modos da ferramenta, snapping, passos de elevação, offsets paralelos, tamanhos de lote por zona. A wiki marca ambas como "verificado para 1.0, possivelmente desatualizado". |
| https://skylines.paradoxwikis.com/Roads, /Zoning, /Road_Editor | **Obtido.** Passos de elevação, larguras em células, como a malha de via é construída e texturizada. |
| Dev diary CS2 #1 "Road Tools" (https://colossalorder.fi/?p=1547) | **Obtido** (versão no site da Colossal Order; o fórum Paradox devolve HTTP 500 / validação de navegador). |
| Dev diaries CS1 #1 Roads e #2 Zoning (fórum Paradox) | **Não obtidos** (HTTP 500 e validação de navegador). O trecho do DD2 sobre "fatias de 2 células" veio só do resumo do buscador. |
| Reddit | **Não obtido** (domínio bloqueado para o buscador e para o fetch; nenhum espelho acessível). Fóruns Steam e guias usados no lugar. |
| Página Steam do mod Tiny Segments (comprimento mínimo de segmento) | **Não obtido** (HTTP 429); só o trecho do buscador. |
| Manual do Blender (docs.blender.org) | **Não obtido** direto (desafio anti-bot); li a mesma página no repositório Khronos `glTF-Blender-IO/docs/blender_docs/scene_gltf2.rst`. |
| Código-fonte do three.js (`src/textures/Texture.js`, `examples/jsm/loaders/KTX2Loader.js`) | **Obtido** do GitHub (branch dev). |
| Render interno do CS2 (shaders de via, decals) | **Não verificado.** Nenhuma fonte técnica; só o diário de modding (ECS/Burst) e ferramentas de decal da comunidade. |

---

## 1. GRADES: como a rua vira grade de zona e quadra

### 1.1 Ferramentas e snapping

**O que a fonte afirma**
- **[fonte] CS1:** as vias "automatically snap to other roads, angles, the zoning grid, and road guidelines"; ferramentas Straight, Curved, Freeform, Upgrade. — https://skylines.paradoxwikis.com/Roads
- **[fonte] CS1:** "When two roads cross they create an intersection." — idem
- **[fonte] CS2:** seis modos: Straight (2 cliques), Simple Curve (3), Complex Curve (4), Continuous, Grid ("Create two initial points and then drag sideways to create a perfect grid"), Replace. Parallel: "The offset determines the distance in zone cells between the two roads and can be set from 0.25 to 12". — https://cs2.paradoxwikis.com/Roads
- **[fonte] CS2:** snapping a "zoning cell length ... snaps every 8 meters", a ângulos de 90°, a geometria existente, a lados de prédios, a guias e à grade de zona. Nenhuma distância de snapping em metros é dada. — idem
- **[fonte] CS2 (dev diary #1):** "the Grid mode allows you to create seamless city blocks with just three clicks" (canto, largura, comprimento); "Intersections are automatically created where roads intersect". — https://colossalorder.fi/?p=1547
- **[fonte] Comunidade CS2:** a combinação que dá grade perfeita é "Snap to zoning cell length, Snap to existing geometry, Snap to 90 degree angles"; "snap to guide lines ... will instantly start causing issues"; o snapping de ângulo "snaps at 90 degree if you have it switched on, but it's not very snappy". — https://steamcommunity.com/app/949230/discussions/0/4333105589465814156, https://steamcommunity.com/app/949230/discussions/0/3937895062998876459
- **[fonte] Comprimento de segmento:** mod Maximum Segment Length: "instead of the default 96m (12u) long segments, you can build a bridge with 48m (6u) segments" (1 u = 8 m); comentário no Tiny Segments: comprimento mínimo de segmento "about one cell (8 m)". — trechos via busca (https://steamcommunity.com/sharedfiles/filedetails/comments/1586027591)
- **Não verificado:** snapping a 15°/45°. Nenhuma fonte oficial CS1 ou CS2 cita 15° ou 45°; a CS2 só documenta 90°. Distância de fusão de nós (node merge) também não aparece em nenhuma fonte.

**Inferência**
- A grade "perfeita" do CS2 sai de três regras combinadas: comprimento múltiplo de 8 m, ângulo 90° e encaixe na geometria existente. Guias (guidelines) são o que quebra a grade porque introduzem deslocamentos sub-célula.
- O "Grid mode" é só um atalho: gera um retângulo de segmentos retos com espaçamento múltiplo de 8 m; o resto é a regra de zona por segmento (1.2).

**O que fazer no Mayor**
- `SNAP_RADIUS` hoje é 0,6 tile (`src/sim/roads.ts:16`). Adicionar três snaps opcionais, ligados por padrão na ferramenta Linha: (a) **comprimento múltiplo de 1 tile** (8 m), (b) **ângulo 90°** em relação ao segmento de origem (tolerância ±7°), (c) **geometria existente** (já há). Oferecer 45° como opção, não 15° (sem respaldo).
- **Ferramenta Grade** (3 toques: canto, largura, comprimento) gerando N×M segmentos retos; passo padrão 12 tiles (ver 1.3). Boa para iPad: menos toques que desenhar rua a rua.
- **Paralela**: offset em tiles (0,25–12), gera cópia deslocada do traçado.
- Comprimento mínimo de segmento 1 tile; recusar (ou fundir no nó) quando `len < 1`.

### 1.2 Como a grade de zona é gerada por segmento (CS1, do código)

**O que a fonte afirma**
- **[código]** `CellSize = 8f`; `MaxExtent = 32f` (4 células). Meia-largura usada: `≤4 → 4`, `4..8 → 8`, senão arredondada. `maxDistance = halfWidth + 32 + setback` (setback é do mod; vanilla 0). — `CreateZoneBlocks.cs:325-360`
- **[código]** Deslocamento inicial ao longo do segmento: se `halfWidth % 8 != 0`, começa 4 m antes do nó; se múltiplo de 8, começa no nó. — `:362-381`. (Isto é o que mantém as células casadas com a grade de 8 m do eixo da via.)
- **[código]** `rows = floor(comprimento / 8 + 0.1)`; "zoning manager will only do blocks of up to 8 length": um bloco por lado se `rows ≤ 8`, senão dois blocos (`(rows+1)>>1` no início, `rows>>1` no fim). Cada segmento tem até 4 blocos: `m_blockStartLeft/Right`, `m_blockEndLeft/Right`. Lado esquerdo/direito respeita flags `ZoneLeft/ZoneRight` e `Invert`. — `:396-445`
- **[código]** Via curva usa rotina própria (`CurvedZoneBlocks`): meia-largura mínima 6 m, tangente da Bézier (ex. em t = 0,14) dá o ângulo do bloco, curvas longas (> 50 m) ou fechadas são partidas em dois blocos por lado. — `:72-310`
- **[código] Máscara `valid` do bloco** (`CalculateBlock1`): um `ulong` de 8 linhas × 4 colunas (coluna = profundidade; "This mask limits the maximum size of a zone block to 64 cells (e.g. 8x8)"). Célula inválida se: (a) `|altura da célula − altura da linha junto à via| > 8 m`; (b) fora da área comprada; (c) coberta por um segmento de rede da camada `Default`; (d) **atrás de uma célula inválida** ("so that there are no cells with no road access", laço de 7 iterações que propaga a invalidade para o fundo). — `CalcBlock1Patch.cs:141-255`
- **[código] Sobreposição entre blocos** (`CalculateImplementation2`): só blocos a < 92 m; duas células "se tocam" se `dist² < 144` (12 m). Se `dist² < 0,01` **e** a diferença de ângulo for múltipla de 90° (tolerância 1 %), a célula é **compartilhada**: fica a mais próxima da via (coluna menor); empate → a do bloco mais antigo (`m_buildIndex` menor). Senão, se os quadriláteros se intersectam: a célula nas **duas primeiras colunas** (profundidade 0–1) vence uma célula mais profunda; mesma faixa de profundidade → o bloco mais antigo vence. Se `dist² < 36` (6 m), ambas nas 4 primeiras colunas e esta célula sem zona, ela **herda o tipo de zona** da outra. — `CalcImpl2Patch.cs:39-293`

**Inferência**
- A grade de zona do CS1 não é uma grade do mundo: é um **retângulo de 8 × 4 células por lado e por segmento**, girado pelo ângulo do segmento, ancorado no nó inicial e no eixo da via. Quadras "perfeitas" aparecem porque segmentos ortogonais com comprimento múltiplo de 8 m geram blocos cujos quadriláteros coincidem a menos de 10 cm e com ângulo múltiplo de 90°, e aí a regra de compartilhamento fica determinística (mais perto da via, depois mais antigo).
- **Esquina**: não há lote de esquina. A célula do canto pertence ao bloco cuja célula está mais perto da sua via (coluna menor); em empate, à via construída primeiro. Isso explica por que no CS1 o prédio de esquina "escolhe" uma das ruas, e por que redesenhar a rua (novo `buildIndex`) muda a esquina.
- A regra (d) (sem célula atrás de célula inválida) é o que impede lotes "ilha" sem acesso à rua.

**O que fazer no Mayor**
- Hoje `findFrontage` (`src/sim/blocks.ts:55-86`) atribui cada tile ao tile de via mais próximo em distância Manhattan ≤ 4, com desempate por classe e índice. Reescrever como **blocos por segmento e lado**, à moda do CS1:
  1. Para cada `RoadSegment` com `type` zoneável, para cada lado: `rows = floor(len / 1 + 0.1)` (tile = célula), partir em blocos de ≤ 8; origem no nó A deslocada de 0,5 tile se a meia-largura não for múltipla de 1 tile.
  2. Bloco = 8 × 4 células no referencial do segmento; rasterizar cada célula no `World` (centro da célula → tile). Em segmentos retos e ortogonais isso cai exatamente em tiles; em curvas e diagonais, usar o centro da célula e aceitar que o tile fica "levemente fora" (o CS1 faz o mesmo e desenha a grade girada).
  3. Máscara `valid` por bloco: tile ocupado por via/instalação/água → inválido; `|h − h_via| > 1 unidade` (8 m) → inválido; propagar invalidade para o fundo (coluna k inválida se k−1 inválida).
  4. Conflito entre blocos no mesmo tile: **menor profundidade vence; empate → segmento mais antigo (`id` menor)**. Guardar em `frontage.road/depth/dx/dy` como hoje, para que `planLots` continue funcionando.
- Com isso a quadra deixa de ser "banda ao longo da rua" e vira **quatro blocos 8 × 4 de quatro segmentos**, com o miolo livre quando o espaçamento passa de 8 tiles — exatamente o que o jogador reconhece como quadra.

### 1.3 Tamanhos de lote e escolha do prédio

**O que a fonte afirma**
- **[fonte] CS1:** tabelas de domicílios/empregos listam footprints de 1×1 a 4×4; "the front of all buildings must be immediately adjacent to the road". — https://skylines.paradoxwikis.com/Zoning
- **[fonte] CS1 (dev diary #2, via busca):** "Instead of zoning the full depth of the zone grid (4 cells) the player can zone thinner slices, like 2 cell deep areas, that spawn smaller building fitting the 2 cell deep restriction". — https://admin-forum.paradoxplaza.com/forum/developer-diary/cities-skylines-dev-diary-2-zoning.804803 (não aberto; trecho do buscador)
- **[fonte] CS1 (dev do mod District Styles Plus):** o spawner vanilla "tries to place 4-unit-wide or 2-unit-wide buildings"; um bloco 17×7 deixou um buraco 6×4 que nunca cresceu; corte de 1 ou 2 células resolveu. — https://steamcommunity.com/workshop/filedetails/discussion/2852723058/3550553789954178305
- **[fonte] Comunidade CS1:** quadra 8×8 células = quatro prédios 4×4; alargar a via encolhe para 6×6; recomendam 10×10 se for alargar. — https://steamcommunity.com/app/255710/discussions/0/611701360840502796 (já em 01)
- **[fonte] CS2:** lotes em células (largura ao longo da via × profundidade): Low Density Housing 2×2 a 4×6; Medium Row Housing 1×2 a 1×6; Medium/High/Mixed Housing, Low Rent, Industrial, Offices 2×2 a 6×6; Low Density Business 2×2 a 5×6; "No apparent in-game difference between themes in terms of available sizes". — https://cs2.paradoxwikis.com/Zoning
- **[fonte] CS2 (comunidade):** zonear 6×6 de baixa densidade "tends to get split into two 3×6 houses"; espaçamento de 112 m = 12 células entre vias "the most you can get without leaving a gap"; XP a cada "112m / 14 cells" (nota da wiki). — https://steamcommunity.com/app/949230/discussions/0/3951406499785218787, https://steamah.com/cities-skylines-ii-practical-engineering-efficient-grids-guide/, https://cs2.paradoxwikis.com/Roads

**Inferência**
- CS2 tem profundidade de zona de **6 células** (lotes de 6 de fundo; 12 células entre vias = 6 + 6 sem buraco). CS1 tem 4. As larguras preferidas são **4 e 2** (CS1) e **2 a 6** (CS2); 1 de largura só em row housing.
- O algoritmo de escolha do CS1 é guloso por largura: tenta o maior footprint que cabe na frente contígua zoneada do mesmo tipo, depois menores; não há "lote" persistente, o prédio é o lote.

**O que fazer no Mayor**
- Manter profundidade 4 (CS1) por enquanto; `ZONE_DEPTH` já é 4. Documentar 6 como opção "CS2" para quando houver prédios de 6 de fundo.
- `planLots` (`blocks.ts:145-180`) já tenta formas `[4,4] [3,3] [2,2] [2,1] [1,2] [1,1]`; mudar a preferência para **largura 4, depois 2, depois 1** e profundidade = min(zona pintada, 4), sempre encostado na frente (profundidade 0) — igual ao spawner vanilla. Remover a rotação aleatória da lista de formas (hoje `rotate` embaralha a ordem de tentativa), que gera mistura 1×1/2×2 sem padrão; manter o embaralhamento só na **ordem das frentes**.
- Esquina: não criar tipo especial; o tile pertence ao bloco que venceu em 1.2. O modelo vira para a via do bloco (`lotYaw`, `src/render/lots.ts`).
- Quadra recomendada no gerador/tutorial: **12 tiles entre eixos de rua** (4 + 4 de zona + 4 de miolo livre, ou 6 + 6 no modo CS2) e 8 para blocos sem miolo.

---

## 2. DETECÇÃO: cruzamento em nível × separação de nível

**O que a fonte afirma**
- **[fonte] CS1:** elevação com Page Up/Down; passo padrão "12 meters, but it can be adjusted to 3, 6, or 12 meters"; "There is a limit to how steep a road incline/decline can be"; túneis têm limite de profundidade; a altura é "the primary way to achieve grade separation". — https://skylines.paradoxwikis.com/Roads
- **[fonte] CS1 (guia):** máximo "60m in the air and 36m underground"; vias mais altas "need more length to make the change". — https://www.ggrecon.com/guides/cities-skylines-elevate-roads/
- **[fonte] CS1 (Road Editor):** `Min/Max Height` da via definem os limites verticais usados "for water blocking and for keeping other nets from being built too low above the road". — https://skylines.paradoxwikis.com/Road_Editor
- **[fonte] CS1 (fórum Steam):** um nó extra aparece onde a ponte volta ao chão e faz os carros parar; "the node that separates elevation is the key here"; a solução foi manter a via elevada até o T. — https://steamcommunity.com/app/255710/discussions/0/3151934575302426853
- **[fonte] CS1 (mod Fine Road Tool):** modos forçados Ground / Elevated / Bridge / Tunnel; passos de elevação menores; "Follow terrain / level terrain" e "Absolute elevation". — https://steamcommunity.com/sharedfiles/filedetails/changelog/1625704117 e discussões ligadas
- **[fonte] CS2:** passos "1.25, 2.50, 5.00, 10.00 meters"; coluna Elevation das vias comuns = −50 a 50 (sem unidade na tabela); pontes 0–200 (suspensa), 0–100 (Grand), 0–40 (basculante); custo "+ ₡4.5K per elevation level" por km. A elevação permite que vias passem "above and underneath each other without creating intersections". — https://cs2.paradoxwikis.com/Roads
- **[fonte] CS2 (dev diary #1):** "the first negative values create cut roads before the road turns into a tunnel"; "elevated roads on the other hand require sufficient clearance below them"; o guia de via mostra "a numerical value of the slope steepness"; "Intersections are automatically created where roads intersect"; rampas de rodovia são feitas adicionando uma faixa a um trecho e ligando-a a uma rodovia de uma faixa, com "proper acceleration and deceleration lanes". — https://colossalorder.fi/?p=1547
- **[fonte] CS2 (guia):** "6.25m is the lowest your bridge can be while still crossing the road" (passarela construída com a ferramenta de vias, pilares a uma célula do vão), rampa desce para 3,75 m e 1,25 m antes do chão. — https://gamepretty.com/cities-skylines-ii-how-to-building-a-pedestrian-overpass/
- **[fonte] CS2 (fórum Steam):** para passarelas "the most reliable height was 7.5M above the road". — https://steamcommunity.com/app/949230/discussions/0/3877095833475404466
- **[fonte] CS2:** existe o erro "Slope Too Steep"; guias mandam aplainar o terreno ou usar curva. Valor do limite: **não verificado** (nenhuma fonte dá % ou graus, nem para CS1 nem CS2). — https://progameguides.com/cities-skylines-2/how-to-fix-slope-too-steep-in-cities-skylines-2/
- **[fonte] CS1:** rodovias e rampas são de mão única e não zoneiam; semáforo não nasce em via de 2 faixas (já em 01). — https://skylines.paradoxwikis.com/Roads

**Inferência**
- Nos dois jogos a decisão é **geométrica, não por "modo"**: um cruzamento vira nó quando as duas vias ocupam o mesmo volume; passa por cima quando a de cima está acima do `Max Height` da de baixo (CS1: Min/Max Height da via; CS2: "clearance suficiente"). O menor valor observado que funciona é **6,25 m** (CS2, 5 passos de 1,25); a comunidade usa **7,5 m** como seguro; no CS1 o passo padrão é **12 m**, e 6 m é o mínimo prático. Em metros reais, 5–6 m de gabarito é o que uma via urbana precisa.
- Os modos "Ground / Elevated / Tunnel" do Fine Road Tool são um atalho de UI para o mesmo mecanismo: forçam a elevação do segmento em vez de deixar o jogo escolher pela altura.
- Um nó **só** de mudança de elevação (onde a rampa toca o chão) é indesejado para o tráfego (o thread do Steam mostra isso): a rampa deve pertencer ao mesmo segmento ou o nó de grau 2 não pode parar carros.
- Rampa automática: nenhum dos jogos gera a rampa sozinho; o jogador define a altura e o jogo interpola ("the road will create an incline from the original height to the new height") e recusa se a inclinação passar do limite.

**O que fazer no Mayor** (hoje: níveis discretos Solo / Elevado / Subterrâneo por botão, sem detecção; `addSegment` só evita nó quando os níveis diferem — `roads.ts:401`)
1. **Altura por nó em metros**, não só nível: `RoadNode.y` (unidade = 8 m; guardar em metros ou em oitavos). Solo = relevo; Elevado = relevo + 6 m por padrão (passo 3 m); Subterrâneo = relevo − 6 m.
2. **Regra de cruzamento** ao inserir segmento, em cada interseção geométrica P com um segmento existente: calcular `hA(P)` e `hB(P)` por interpolação linear entre os nós; se `|hA − hB| ≥ CLEARANCE` (padrão **6 m**, ajustável 5–7,5) → **sem nó**; senão → nó (split dos dois). Isso substitui a comparação de "nível" por comparação de altura e passa a funcionar para pontes/túneis já existentes (`elevation.ts`) e para a avenida que sobe gradualmente.
3. **Limite de inclinação**: `MAX_SLOPE = 0,125` (12,5 %, 1:8); rampa de 6 m exige **≥ 48 m = 6 tiles**; manter a rampa atual de 3 tiles (25 %) só como "modo arcade" em preferências. Recusar segmento com `|Δh| / len > MAX_SLOPE` com aviso "muito íngreme" (i18n).
4. **Rampa dentro do segmento**: a transição de altura é propriedade do segmento (perfil linear entre nós), não um nó extra; um nó de grau 2 só por mudança de altura não deve ter semáforo/zebra nem parar tráfego.
5. **Distância mínima entre nós**: 1 tile (CS1 ≈ 1 célula). Nó novo a < 1 tile de um existente funde no existente (`SNAP_RADIUS` 0,6 hoje; subir para 1,0 só para nós de cruzamento).
6. **Rodovia**: nunca cria nó com rua/avenida — só com rampa; rampa é segmento de mão única que **tem** nó com os dois lados. Rodovia × rodovia em nível → nó só se uma delas for de mão única entrando (merge); duas de mão dupla cruzando em nível → recusar ("use viaduto"), como o CS2 faz na prática por não oferecer cruzamentos de rodovia zoneáveis.
7. **Detecção visual**: ao arrastar a via, pintar o ponto P em verde (vai passar por cima/baixo, mostrar Δh) ou laranja (vai criar cruzamento), como o guia de inclinação do CS2 mostra o ângulo.

---

## 3. DESENHO: como a via é renderizada e o que o Mayor deve fazer no iPad

### 3.1 O que o CS1 faz (Road Editor)

**O que a fonte afirma**
- **[fonte]** "Roads are usually modeled as straight 64 units long and 16-32 units wide road stubs"; "Segments are used normally on continuous roads, and nodes are used in intersections"; "Both segment and node models are simply straight road stubs, and the game takes care of bending and matching them"; "Wrong sized mesh can result in clipping or z-fighting between the segment meshes when they are tiled". — https://skylines.paradoxwikis.com/Road_Editor
- **[fonte]** "As the mesh is stretched the UV-mappings 'scroll' along the V-axis to avoid stretching the texels"; "Magenta vertex color (255, 0, 255) can be used to disable stretching the UV-mapping"; "Nodes are usually heavily stretched and bent so avoid using diffuse details in those"; texturas divididas horizontalmente, com ilhas de UV estáticas de um lado. — idem
- **[fonte]** Mapas: `_d` difusa, `_n` normal, `_s` especular, `_a` alpha, `_p` pavement, `_r` road; "White areas in pavement and road maps are used to automatically generate texturing" (o chão em volta é pintado pela via). Pavimento 0,3 u acima; "Roads usually consist of 5 elevations" (Basic, Elevated, Bridge, Slope, Tunnel). — idem
- **[fonte]** (de 01) LOD de growable ≈ 100 tris, textura LOD 128²; prédios 1024² por asset. — https://skylines.paradoxwikis.com/Asset_Editor
- **[fonte] CS2:** só impressões: as linhas de via "look more clean than the previous version" (fórum); decals personalizados entram via ExtraAssetsImporter/CS2DecalBuilder; parte do código é Burst/ECS "unmanaged for optimization". — https://forum.quartertothree.com/t/cities-skylines-ii-chirper-strikes-back/159230, https://www.nexusmods.com/citiesskylines2/mods/168, https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding
- **Não verificado:** shader de superfície do CS2, uso de decals para faixas no vanilla, normal maps das vias, estratégia de LOD das vias.

**Inferência**
- A nitidez da via do CS vem de três coisas: (1) **textura repetida por metro** ao longo do eixo (o V "rola", nunca estica), (2) **marcações no mesmo mapa difuso** da pista, em alta resolução por metro, (3) **nó com textura sem detalhe** (só asfalto) para esconder o estiramento, com a zebra/linha como prop ou textura própria. Além disso o asfalto escurece a calçada e o terreno com a máscara `_p/_r`, o que dá a "sombra" que faz a via parecer assentada.
- Por que o Mayor parece "flat": as fitas são cor chapada ou asfalto 128² repetido a cada 0,6 u (ver G12 em 02), sem repetição por metro, sem normal map, sem escurecimento do terreno em volta, e as faixas são geometria/cor em vez de textura.

### 3.2 O que fazer no Mayor (web, iPad)

**O que a fonte afirma (three.js e GPU)**
- **[código] three.js:** `Texture.minFilter` padrão `LinearMipmapLinearFilter`; `generateMipmaps = true`; `anisotropy` padrão `Texture.DEFAULT_ANISOTROPY` (= 1); o máximo vem de `renderer.capabilities.getMaxAnisotropy()`. — `src/textures/Texture.js` (branch dev)
- **[fonte]** Marcações borram à distância "even when trilinear filtered"; filtro anisotrópico mantém a nitidez; um dev relata que "the main problem are the lane markings as the streets look pretty good without markings". — https://research.ncl.ac.uk/game/mastersdegree/graphicsforgames/texturemapping/, https://hub.jmonkeyengine.org/t/solved-texture-looks-blurry/23090
- **[fonte] SDF:** suavização por derivada de tela: `delta = length(vec2(dFdx(d), dFdy(d)))` e `smoothstep` em torno do limiar; artefatos onde duas arestas se encontram. — https://godotshaders.com/shader/sdf-scalable-textures/, https://redblobgames.com/x/2403-distance-field-fonts
- **[código] three.js `KTX2Loader`:** `detectSupport(renderer)` lê `WEBGL_compressed_texture_astc / etc / s3tc / EXT_texture_compression_bptc / pvrtc`; ordem de transcodificação ASTC → BC7 → ETC2 → ETC1 → PVRTC → `RGBA32` (descomprimido) como último recurso. — `examples/jsm/loaders/KTX2Loader.js:230-270, 795-868`
- **[fonte]** ASTC "iOS hardware supports it as of the A8 (iPhone 6)" (WebKit bug 185272); MDN: 512×512 ASTC 4×4 = 262 144 bytes; `getSupportedProfiles()`. — https://bugs.webkit.org/show_bug.cgi?id=185272, https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc
- **[fonte]** Em iPads mais velhos a transcodificação cai em PVRTC e texturas com alpha saem pretas/brancas; recomendação do autor do Basis: "use 4444 or 32-bit instead of PVRTC1". — https://discourse.threejs.org/t/basis-textures-with-alpha-appearing-fully-black-and-white-on-some-ipads-and-older-mobile-devices/22575
- **[fonte]** Safari iOS mata e recarrega abas com muito WebGL por pressão de memória; "the solution is typically to reduce texture sizes, or use less textures". Números de limite (100–150 MB, ~256 MB) circulam mas **não são oficiais**. — https://bugs.webkit.org/show_bug.cgi?id=300782, https://bugnet.io/blog/how-to-fix-ios-safari-killing-your-web-game-a-problem-repeatedly-occurred

**Inferência**
- Para "mais pixels" sem estourar memória no iPad: poucas texturas grandes compartilhadas (atlas), comprimidas em GPU (ASTC via KTX2), com mipmaps e anisotropia máxima, e **marcações em SDF** (resolução independente da textura) em vez de desenhar faixas em alta resolução no atlas.

**O que fazer no Mayor**
1. **UV por metro na fita**: em `buildRibbon` (`src/render/roads.ts`), `v = distância acumulada ao longo do eixo / 8` (1 repetição por tile) e `u = posição lateral em metros / largura da textura`; nunca esticar. Nó: só asfalto (UV plano, sem detalhe) + zebra/retenção como **decal SDF** separado.
2. **Atlas de via** 1024×1024 por tier alto (512 médio, 256 baixo), com: asfalto (albedo + normal + roughness empacotados), meio-fio, calçada, grama de canteiro, e um canal **SDF** com faixa contínua, tracejada, zebra, seta, linha de retenção. Marcação = `smoothstep(0.5 − w, 0.5 + w, sdf)` com `w = fwidth(sdf)`; largura e cor por uniforme; sem aliasing em qualquer zoom.
3. **Filtros**: `minFilter = LinearMipmapLinearFilter` (padrão), `anisotropy = renderer.capabilities.getMaxAnisotropy()` (cap 8 em tier médio, 4 em baixo), `wrapS/T = RepeatWrapping`, `colorSpace = SRGBColorSpace` só no albedo.
4. **Compressão**: KTX2 via `gltf-transform` (UASTC para normal/ORM, ETC1S para albedo; ver 4); fallback PNG/WebP quando `detectSupport` não achar ASTC (iPads antigos) — e **sem alpha em texturas que podem cair em PVRTC**: a máscara SDF vai num canal RGB, não no alpha.
5. **Assentar a via no terreno**: máscara "pavimento" pintada no shader de terreno numa faixa de 0,5 tile em volta de cada via (equivalente ao `_p/_r` do CS1), escurecendo e trocando a grama por terra/concreto. É o que mais faz a via parecer parte do mapa.
6. **LOD**: a > 40 tiles da câmera, descartar meio-fio e marcações (uniforme `uDetail`), manter só asfalto; a > 80, a via vira cor no terreno (já há tiers em `prefs.ts`). Pixel ratio por tier: baixo 1,0; médio 1,5; alto 2,0 (como hoje) — a nitidez vem de SDF + anisotropia, não de pixel ratio.
7. **Orçamento de textura (inferência, iPad 2020+)**: ≤ 64 MB de GPU em texturas no tier médio (≈ 4 atlas 2048² ASTC 4×4 ≈ 4 × 5,6 MB com mips, mais prédios), ≤ 128 MB no alto; medir com `renderer.info.memory.textures`.

---

## 4. MAPA/ASSETS VIA BLENDER → Three.js

**O que a fonte afirma**
- **[fonte] Exportador glTF do Blender:** exporta Principled BSDF (base color, metallic/roughness, normal "tangent space, +Y up", "Baked Ambient Occlusion", emissive); oclusão só via node group `glTF Material Output` com entrada `Occlusion`; "glTF stores occlusion in the red (R) channel, allowing it to optionally share the same image with the roughness and metallic channels" (ORM); Cycles Bake para AO e normal; `KHR_texture_transform` (Mapping node, tipo *Point*); `KHR_materials_emissive_strength` se emissive > 1; **GPU Instances**: "instances are exported using the EXT_mesh_gpu_instancing extension"; Draco e Meshopt; "Apply Modifiers"; vertex color exportado como multiplicador de Base Color (modos Material/Active/Name, `COLOR_1, COLOR_2` adicionais); imagens PNG/JPEG/WebP ("If WebP is chosen, all textures will be saved as WebP, without any png/jpg fallback"); extras (custom properties). — https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst (mesmo texto do manual oficial)
- **[fonte] gltf-transform:** `uastc --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}" --level 4 --rdo --rdo-lambda 4 --zstd 18`, depois `etc1s --quality 255` para o resto; `webp --slots baseColor`; `meshopt --level medium`; `draco --method edgebreaker`; `instance` (EXT_mesh_gpu_instancing), `dedup`, `palette`, `resize`; "Defaults in the optimize command may not be ideal for all scenes", rodar `inspect` antes. — https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/README.md, https://gltf-transform.dev/cli
- **[fonte] Khronos:** ETC1S "can achieve significantly smaller transmission and memory sizes than JPEG and PNG textures"; UASTC "significant memory savings"; Basis combina "selected modes of the Khronos-defined ETC1 and ASTC GPU texture formats". — https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets
- **[fonte] Mayor hoje:** modelos por script em `blender/`, GLB em `public/models/`, instancing no jogo, limite de 450 tris por prédio (`AGENTS.md` regra 7); vias são geradas em runtime (`buildRoadNetworkGeometry`).

**Inferência: peças pré-modeladas × malha gerada**

| | Peças GLB do Blender (reta, curva 90°, T, cruz, rampa) | Malha gerada em runtime (sweep, como hoje) |
|---|---|---|
| Qualidade visual | Alta onde a peça encaixa: AO assada, meio-fio chanfrado, bueiros, normal map por peça | Depende do código; AO só por vértice; detalhes = mais código |
| Ângulos e curvas livres | Ruim: só funciona em 90°/45° e raios fixos; Mayor desenha curvas livres e segmentos de qualquer comprimento | Natural: qualquer ângulo, raio, comprimento, relevo |
| Terreno | A peça não segue o relevo; exige aplainar sob a via (o CS faz terraformar) | Segue `groundY` por vértice |
| Cruzamentos | Explosão combinatória (classe × braços × ângulos) — o CS1 resolve dobrando um "stub" reto por código, não com peças | Polígono do nó + filetes já existem (`nodeLayout`) |
| Custo iPad | Instancing barato (1 draw por peça); mas peças 90° não cobrem a cidade | 1 geometria mesclada por camada (já é 1–2 draws) |
| Autoria | Artista (Muse) controla tudo no Blender | Programador |

- **Conclusão:** o CS1 **não** usa peças de cruzamento: usa um stub reto de segmento e um stub reto de nó e **dobra por código**. O caminho compatível com o Mayor é o mesmo: a geometria continua gerada em runtime, mas **o que vem do Blender são perfis e texturas**, não malhas de via inteiras. Peças GLB pré-modeladas só para o que é realmente repetido e sem deformação: **props de nó** (semáforo, placa, poste, abrigo, bueiro, grelha), **pilares e portais** de viaduto/túnel, **ilhas de rotatória**, **peças de lote** (garagem, jardim, estacionamento, calçada de esquina).

**O que fazer no Mayor (fluxo concreto)**
1. **Perfil de via no Blender** (`blender/roads_profile.py`): uma seção transversal por classe (rua, avenida, rodovia, rampa) como curva 2D com vértices nomeados (asfalto, meio-fio, calçada, canteiro) e **UV u por vértice**; exportar como JSON em `public/roads/profiles.json` (custom properties → `extras`). O sweep em runtime lê o perfil em vez dos números fixos `halfAsphalt/kerbWidth`.
2. **Atlas de via** gerado em Blender (`make_textures_hd.py`): 2048² albedo + 2048² normal/ORM assados de materiais procedurais (Cycles Bake), mais o canal SDF das marcações (gerado por script Python a partir de curvas vetoriais, distância euclidiana em pixels). Exportar PNG e converter com `gltf-transform`/`toktx` para **KTX2 UASTC (normal/ORM) e ETC1S (albedo)**, com `--zstd 18`. Fallback WebP para navegadores sem ASTC.
3. **Props GLB** com `EXT_mesh_gpu_instancing` ou carregados como `InstancedMesh` (já é assim): AO em vertex color (`COLOR_0`) como multiplicador de base color; base em z = 0, frente em −Y, como os prédios. Orçamento por prop ≤ 150 tris; pilar/portal ≤ 300; ilha de rotatória ≤ 400.
4. **Terreno "compatível"**: continuar com heightmap (Map Kit 16 bits, já feito em M12); o que falta é a **máscara de superfície** (pavimento/terra/grama) pintada pelas vias e lotes, em `Uint8Array` por tile e textura `size²` lida no shader de terreno — equivalente ao `_p/_r` do CS1. Não vale modelar o terreno no Blender: perde a edição em jogo.
5. **Orçamentos para iPad (inferência; medir com `renderer.info`)**: cidade 128×128 com ~2 000 segmentos: via ≤ 60 k tris (hoje a fita é ~2 tris/tile por faixa de material; com perfil de 6 vértices fica ~10 tris/tile → 20 k para 2 000 tiles de via), nós ≤ 20 k, props de via ≤ 40 k instanciados, prédios ≤ 450 × ~1 500 lotes = 675 k (já é o maior consumidor — LOD1 de 100 tris necessário, ver G14). Total alvo **< 1 M tris / frame no tier médio**, **< 1,5 M no alto**. Texturas: ver 3.2 item 7. Draw calls < 150.
6. **Pipeline em `npm run assets`**: `blender -b … build_all.py` → `gltf-transform dedup | instance | meshopt | uastc/etc1s` → `public/models/*.glb` + `public/textures/*.ktx2`; teste `glb-assets.test.ts` passa a checar também o tamanho dos KTX2 e a ausência de alpha em texturas que caem em PVRTC.

---

## 5. Fontes (todas as usadas)

- CS1 código (via mod): https://github.com/algernon-A/ZoningAdjuster — `Code/Patches/CreateZoneBlocks.cs`, `CalcBlock1Patch.cs`, `CalcImpl2Patch.cs`
- https://skylines.paradoxwikis.com/Roads · https://skylines.paradoxwikis.com/Zoning · https://skylines.paradoxwikis.com/Road_Editor · https://skylines.paradoxwikis.com/Asset_Editor
- https://cs2.paradoxwikis.com/Roads · https://cs2.paradoxwikis.com/Zoning
- https://colossalorder.fi/?p=1547 (CS2 dev diary #1 Road Tools) · https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding
- Steam: https://steamcommunity.com/app/949230/discussions/0/4333105589465814156 · /3937895062998876459 · /3951406499785218787 · /3877095833475404466 · https://steamcommunity.com/app/255710/discussions/0/3151934575302426853 · /611701360840502796 · https://steamcommunity.com/workshop/filedetails/discussion/2852723058/3550553789954178305 · https://steamcommunity.com/sharedfiles/filedetails/comments/1586027591 · https://steamcommunity.com/sharedfiles/filedetails/changelog/1625704117
- Guias: https://www.ggrecon.com/guides/cities-skylines-elevate-roads/ · https://gamepretty.com/cities-skylines-ii-how-to-building-a-pedestrian-overpass/ · https://progameguides.com/cities-skylines-2/how-to-fix-slope-too-steep-in-cities-skylines-2/ · https://steamah.com/cities-skylines-ii-practical-engineering-efficient-grids-guide/
- three.js: https://github.com/mrdoob/three.js/blob/dev/src/textures/Texture.js · https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/KTX2Loader.js · https://discourse.threejs.org/t/basis-textures-with-alpha-appearing-fully-black-and-white-on-some-ipads-and-older-mobile-devices/22575
- GPU/Safari: https://bugs.webkit.org/show_bug.cgi?id=185272 · https://bugs.webkit.org/show_bug.cgi?id=300782 · https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc · https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets
- Render de marcações: https://research.ncl.ac.uk/game/mastersdegree/graphicsforgames/texturemapping/ · https://hub.jmonkeyengine.org/t/solved-texture-looks-blurry/23090 · https://godotshaders.com/shader/sdf-scalable-textures/ · https://redblobgames.com/x/2403-distance-field-fonts
- Blender/glTF: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst · https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/README.md · https://gltf-transform.dev/cli
