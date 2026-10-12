# clones

Pasta para programas de **engenharia reversa visual**: clonar apps a partir de screenshots, usando IA.

## Processo de referência

[Birkenpapier/ai-app-cloner](https://github.com/Birkenpapier/ai-app-cloner) — entrada: pasta de screenshots de um app. Saída: projeto Expo / React Native rodável que reproduz telas, navegação e design system.

### Como funciona

1. **Captura** — screenshots do app alvo (iOS ou Android), sem jailbreak nem decompilação. Uma pasta de PNGs.
2. **Análise** — agente de código identifica telas, navegação e design system.
3. **Geração** — escreve o projeto Expo / React Native.
4. **Loop de diff** — renderiza cada tela, tira screenshot do próprio output, compara com a referência e corrige as diferenças até casar. Substitui as medidas (padding, fontes, cores) que o DOM entregaria de graça na web.

### Por que screenshots

Site entrega DOM/CSS/assets. App mobile entrega só pixels. Screenshot é a única entrada que funciona em qualquer app sem instalar nada.

## Estrutura

Cada clone vive na própria subpasta:

```
clones/
├── README.md
└── <nome-do-app>/
    ├── screenshots/   # referência capturada
    └── ...            # projeto gerado
```

## Notas

- Uso: estudo, protótipo e engenharia reversa de UI. Não redistribuir assets, marcas ou código de terceiros.
- Clone roda direto no simulador iOS ou `npm run web`.
