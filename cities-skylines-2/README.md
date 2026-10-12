# Mayor

Clone jogável de city builder inspirado em Cities: Skylines II. Mac, Windows e iPad (PWA).
Plano e marcos: [PLAN.md](PLAN.md).

```bash
npm install
npm run dev     # http://localhost:5173 (também na rede local, para abrir no iPad)
npm test        # regras da simulação
npm run build   # tipos + bundle em dist/
```

## Controles

| | Mouse | Toque |
|---|---|---|
| Usar ferramenta | botão esquerdo (arrastar pinta; Linha/Curva: clique) | um dedo (Linha/Curva: toque) |
| Cancelar estrada | Esc | botão Finish road |
| Mover câmera | botão direito, WASD/setas | ferramenta Move, ou dois dedos |
| Girar | botão do meio, Q/E | dois dedos (torcer) |
| Zoom | roda | pinça |

## Status

- M1: terreno, estradas, zonas R/C/I, bulldoze, crescimento por demanda, impostos e orçamento.
- M2: usina, bomba d'água, esgoto e aterro com cobertura por raio, infoviews e painel de serviços.
  Prédios novos precisam de energia e água; nível 2 pede esgoto, nível 3 pede coleta de lixo.
- M3: polícia, bombeiros, clínica, escola e parque; incêndios, felicidade e mapa de valor do solo.
  Sem estação de bombeiros um prédio pode pegar fogo; nível 3 exige escola; valor do solo escala a arrecadação.
- M4: estradas livres. Toque ou clique inicio e fim (Linha) ou inicio, curva e fim (Curva); Pintar continua disponível.
  Rua, avenida e rodovia (a rodovia liga mas não serve lotes); snapping em estradas existentes.
  A simulação continua em grade: cada via é rasterizada em tiles, então zonas, cobertura e conectividade seguem iguais.
- M5: tráfego. Carros de moradores (casa para emprego) e caminhões (indústria para comércio) percorrem a rede
  com A* sensível a congestionamento; cada classe de via tem velocidade e capacidade; infoview de tráfego;
  congestionamento reduz felicidade.
- M6: transporte público. Paradas de ônibus (em ruas e avenidas) e estações de metrô (em qualquer terreno livre);
  linhas circulares criadas tocando as paradas em ordem; ônibus usam as vias e entram no tráfego, trens vão em linha reta.
  Passageiros pagam tarifa, tiram carros da rua, elevam o valor do solo e a felicidade. Painel de linhas com veículos e remoção.
- Próximo: M7 (salvar/carregar, ciclo dia e noite, clima).
