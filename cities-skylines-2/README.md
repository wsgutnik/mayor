# Skyline

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
| Usar ferramenta | botão esquerdo (arrastar pinta) | um dedo |
| Mover câmera | botão direito, WASD/setas | ferramenta Move, ou dois dedos |
| Girar | botão do meio, Q/E | dois dedos (torcer) |
| Zoom | roda | pinça |

## Status

M1 (núcleo jogável): terreno, estradas, zonas R/C/I, bulldoze, crescimento por demanda,
impostos e orçamento. Próximo: M2 (energia, água, esgoto).
