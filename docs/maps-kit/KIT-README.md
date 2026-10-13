# MAYOR — Starter Map Kit

Quatro mapas de terreno, gerados proceduralmente e originais, para prototipagem do jogo MAYOR.

## Pastas
Cada mapa inclui:
- `heightmap_16bit.png`: **imagem real de 16 bits em tons de cinza**, 1024x1024. Pixels altos = elevação alta. PNG modo `I;16`, sem dados RGB.
- `heightmap_preview_8bit.png`: versão apenas para INSPEÇÃO visual do relevo, com gama para visualização. Não substitui o heightmap de 16 bits.
- `terrain_preview.png`: visualização colorida top-down para designers, **não** é um heightmap.
- `water_mask.png`: imagem 8 bits, branco indica água (oceano/rios) e preto indica terra.
- `buildable_mask.png`: imagem 8 bits, branco indica terreno preliminarmente construível (restrição por declive/água).
- `development_guide.png`: indicação ilustrativa para colocar bairros e zonas, **não** é malha de vias.
- `map.json`: seed, tamanho sugerido, escala e notas técnicas.

## Escala e integração
Resolução base: 1024x1024 pixels. Mundo sugerido: 8192x8192 metros (8m/pixel). Altura máxima de referência: 600 m. Nível do mar normalizado: 0.23 (16-bit ≈ 15073; 138 m na escala de referência).

Pipeline sugerido (Unity/Godot/Unreal ou engine própria): (1) importar heightmap 16-bit, (2) dimensionar o terreno para 8192 x 8192 m / 600 m verticais, (3) configurar água com base em máscara e canais, (4) gerar texturas, árvores e estradas, (5) reservar vias e zonas usando máscara de terreno plano. Os motores diferem nos formatos e ajustes, portanto pode ser necessária conversão para RAW/R16 e recalibração do eixo vertical.

Importante: água de rio é uma camada separada; cada motor terá de gerar o fluxo/superfície aquática corretamente. A máscara de construção é indicativa; não há simulação real do jogo.

## As opções
01 — Baía Metropolitana: comércio, turismo, porto e ilhas.
02 — Vale Verde: rio central, serras e barragens.
03 — Arquipélago Azul: ilhas, travessias e portos.
04 — Planície Central: fácil começar, terrenos amplos.
