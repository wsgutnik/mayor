# PROGRESS — Mayor

Atualizado em 2026-10-12. Status vivo com capturas: artefato de status (fonte em [docs/mayor-status.html](docs/mayor-status.html)).

## Estado

| Marco | Estado | Notas |
|---|---|---|
| M1 a M14 | feito | núcleo, serviços, estradas livres, tráfego, transporte, saves, empacotamento, identidade, kit visual, modelos, mapas, kit de prédios, Blender |
| M15 Detalhe | feito | texturas, AO, faixas, nuvens, fumaça, 12 prédios redesenhados |
| M16 Rede viária com nós | feito | grafo de nós, esquinas, zebras, dados de semáforo; estradas só por Linha e Curva |
| M17 Quadras e lotes | feito | lotes persistidos, um prédio por lote, lotes vazios desenhados |
| M18 Redes e subsolo | feito | água, esgoto, energia por fluxo; vista Subsolo; avisos |
| M19 Água | feito | margem contínua, normais, reflexo, espuma, níveis de qualidade |
| M20 Render | feito | terreno em camadas, texturas HD, sombras, tone mapping, LOD, níveis de qualidade |
| M21 Vias e sinalização | feito | mão única, rotatória, semáforos com fases, props de calçada |
| Frota de veículos | feito | 23 variantes paramétricas: carros (táxi, polícia, minivan, picape…), vans, caminhões (baú, lixo, utilitário, betoneira, prancha, tanque), semis (baú, contêiner), ônibus (urbano, articulado, escolar, dois andares, rodoviário, mini) |
| M22 Acabamento | pendente | pedestres, polimento, Windows e iPad reais |
| M23 Pontes e túneis | feito | custo 3× e 4×, tabuleiro, pilares, portais |
| M26 Regras da grade de zona do CS1 | parcial | vencedor por distância e segmento mais antigo, limite de declive, fileira cortada atrás de obstáculo; blocos por segmento não feitos |
| M25 Detecção de cruzamentos e estradas em textura | feito | regras automáticas para rodovias, prévia com marcadores, trevo; atlas de estrada em Blender/python |
| M24 Separação de níveis | feito | viaduto e passagem inferior sem nó, botões Solo / Elevado / Subterrâneo e tecla E, tráfego por camada |

Testes: 299 passando (`npx vitest run`). Build de Mac verificado; Windows e iPad reais ainda não testados.

## Quem fez o quê

- **Claude (lead):** arquitetura, junções, água v1, vista Subsolo v1, sombras, merges, correções da revisão, documentação e artefato.
- **Muse:** M16 nós, M17 ligação de lotes, M18 redes, M19 água, M23 pontes e túneis; assets Blender (texturas HD, props, kits); props Kenney.
- **Codex:** módulo de blocos e lotes, mapas, modelos de prédios, revisões de código.
- **Fable:** pesquisa e plano (`docs/process/`).

## Achados da revisão do Codex (2026-10-12)

Corrigidos: demolir rua não invalidava lotes; ids de segmento duplicados e contadores atrasados; água não reconstruída em troca de cidade do mesmo
tamanho; vazamento de texturas de água; base64 inválido e NaN em alturas; lotes sobrepostos em saves.
Abertos: buscas lineares no grafo de estradas (O(S²) na reconstrução), verificação de semáforo por veículo (vehículos × junções),
lotes validados só no tile âncora ao sincronizar.

## Limitações conhecidas

- O Muse parou por cota esgotada (renova em 2026-10-13 04:17 UTC); a parte de blocos por segmento do M26 fica para depois.


- Separação de níveis só pelos botões Elevado/Subterrâneo; sem detecção automática de cruzamento.
- A mediana da avenida para antes do canto em curvas fechadas.
- Regiões alcançáveis só por ponte ou túnel precisam de energia e água locais.
- A rede de utilidades usa um pool por rede ordenado por proximidade, não orçamento por instalação.
- Sem pedestres, sem faixas direcionais por pista; tráfego ainda em grade de tiles.

## Processo

CI e empacotamento são locais: `npm run ci` (tipos, testes, build) antes de cada merge e `npm run package` para o app. O workflow do GitHub Actions foi removido.

## Distribuição Mac

- Assinatura ad hoc coerente pronta (`npm run package:adhoc`); assinatura Developer ID e notarização prontas como script (`npm run package:signed`) mas **dependem de certificado e credenciais da Apple**, que não existem neste Mac (nenhuma identidade no chaveiro). Passo a passo em `docs/SIGNING.md`.

## Pendências de assets

- Kit de subsolo em GLB (tubos, bombas, válvulas) e peças de lote (jardim, estacionamento, praça, calçada de esquina): o `muse-world` não terminou; o jogo usa geometria procedural.
- Props a partir do Kenney City Kit Roads (semáforos, postes, placas, barreiras): fontes em `third_party/`, conversão não feita.
- Mobiliário convertido do pacote de transporte (abrigos, banco, jardineira, poste, quiosque, máquina de bilhetes, placa) está em `blender/props_fleet.py`, mas ainda não ligado aos props de calçada.
- Entradas 31 (estação de ônibus) e 33 (terminal de carga) têm modelo mas nenhuma função no jogo; 32 (estação de trem) é o modelo das estações de metrô.

## Pesquisa aplicável (docs/process/04-*)

- Grade de zona do CS1: implementado em parte (M26): célula mais próxima da via vence, empate para o segmento mais antigo, célula inválida acima do limite de declive (1,0), fileira cortada atrás de célula inválida. Falta o bloco por segmento de até 8 tiles no referencial do segmento (exige zona fora da grade de tiles).
- Decisão de cruzamento por diferença de altura interpolada (≥ 6 m separa) e declive máximo de 12,5 %: hoje o Mayor decide por nível escolhido e por rodovia.
- Marcações em SDF e KTX2/ASTC: hoje PNG; possível ganho de memória.

## Próximos passos

1. Tráfego por pista (referência: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, fases C e E).
2. Desempenho do grafo e dos semáforos (achados abertos).
3. M22: pedestres em movimento, polimento, validação em Windows e iPad.
4. Tráfego por pista (referência: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, fases C e E).
