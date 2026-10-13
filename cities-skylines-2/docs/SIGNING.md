# Assinatura e notarização do Mayor no Mac

Estado: o app é assinado **ad hoc** (sem identidade da Apple). Ele abre no Mac que o gerou, mas em outros Macs o
Gatekeeper pede "Abrir mesmo assim". Para a instalação abrir sem aviso é preciso uma identidade **Developer ID Application**
e a **notarização** da Apple. Isso exige uma conta paga e não dá para gerar sem ela.

## O que é preciso (uma vez)

1. Conta no **Apple Developer Program** (US$ 99/ano), em https://developer.apple.com/programs/.
2. No Xcode (Settings > Accounts > Manage Certificates) ou no portal, criar o certificado **Developer ID Application**.
   Ele fica no Acesso às Chaves (login). Confira com:
   ```bash
   security find-identity -v -p codesigning
   ```
   A linha tem a forma `"Developer ID Application: Seu Nome (TEAMID1234)"`.
3. Guardar as credenciais de notarização no chaveiro (a senha é uma *senha específica de app* de
   https://account.apple.com > Segurança):
   ```bash
   xcrun notarytool store-credentials mayor-notary \
     --apple-id voce@exemplo.com --team-id TEAMID1234 --password <senha-especifica-de-app>
   ```
   Nada disso vai para o git: a senha fica só no chaveiro.

## Gerar o pacote assinado e notarizado

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Seu Nome (TEAMID1234)"
npm run package:signed
```

O script (`scripts/sign-mac.sh`) roda `npm run ci`, constrói com o runtime reforçado e o `entitlements.plist`, envia o
dmg para a Apple (`notarytool submit --wait`), grampeia o ticket (`stapler staple`) e verifica com `codesign` e `spctl`.

Verificar a qualquer momento: `npm run verify:mac`. Esperado depois de notarizar:
`spctl --assess` com `accepted source=Notarized Developer ID` e `stapler validate` com `The validate action worked!`.

## Sem conta paga (o que já está feito)

`npm run package:adhoc` gera o app com assinatura ad hoc coerente (identificador `com.mayor.game`, runtime reforçado,
recursos selados). Não tira o aviso do Gatekeeper em outros Macs. Para abrir:

- clique direito no app > **Abrir** > **Abrir**, ou
- em Ajustes do Sistema > Privacidade e Segurança > **Abrir mesmo assim**, ou
- `xattr -dr com.apple.quarantine /Applications/Mayor.app` (remove a quarentena do arquivo baixado).

## Publicar o dmg

Depois de notarizado:
```bash
gh release create vX.Y.Z src-tauri/target/release/bundle/dmg/Mayor_*.dmg --repo wsgutnik/mayor --prerelease
```
(Sempre a partir do pacote local; sem GitHub Actions.)

## Se o app notarizado não abrir

O runtime reforçado bloqueia JIT e memória não assinada no processo do app. A web view (WKWebView) roda em processo da
Apple, então normalmente nada é preciso. Se o log mostrar bloqueio, acrescente a chave necessária em
`src-tauri/entitlements.plist` e anote o motivo ao lado.
