# Instalar o Mayor

## iPad (PWA)

1. Publique a pasta `dist/` em qualquer hospedagem estática com **HTTPS** (Cloudflare Pages, Netlify, GitHub Pages).
   `npm run build` gera `dist/`.
2. No Safari do iPad, abra o endereço, toque em Compartilhar e em **Adicionar à Tela de Início**.
3. Abra pelo ícone: roda em tela cheia e, depois da primeira abertura, funciona sem internet.

Para testar sem hospedar: `npm run dev` e abra `http://<ip-do-mac>:5173` no Safari do iPad.
Funciona, mas sem modo offline (service workers exigem HTTPS ou localhost).

Atualizações: ao publicar uma versão nova, aumente `VERSION` em `public/sw.js`.

Salvamento: fica no armazenamento do Safari, que o iOS pode limpar. Use **Menu → Export** para guardar um arquivo.

## Mac

```bash
npm run desktop:build
```

Gera `src-tauri/target/release/bundle/macos/Mayor.app` e o `.dmg`.
O app não é assinado nem notarizado: na primeira vez, abra com clique direito → Abrir.

## Windows

Precisa de uma máquina Windows (o empacotamento é sempre local, sem GitHub Actions):

```bash
npm ci
npm run desktop:build
```

Pré-requisitos: Node 22, Rust (stable) e o WebView2 (já vem no Windows 11). Gera `.msi` e `.exe` em `src-tauri/target/release/bundle/`.

## Mac (dmg pronto)

O instalador mais recente fica nas Releases do repositório privado: https://github.com/wsgutnik/mayor/releases (arquivo `Mayor-*-aarch64.dmg`, Apple Silicon). Abra o dmg, arraste Mayor para Aplicativos e, na primeira abertura, use clique direito > Abrir (o app não é assinado). Gerado localmente com `npm run package`.
