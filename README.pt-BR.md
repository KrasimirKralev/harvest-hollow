# Harness Hollow em português do Brasil

Harness Hollow é um jogo cooperativo de fazenda em 3D para duas pessoas no navegador. Plante e colha em conjunto, cuide dos animais, complete pedidos e decore a fazenda. Para jogar em dupla, comece sua fazenda e compartilhe o link de convite com a outra pessoa.

## Jogar localmente

Instale o Node.js 24 ou superior. Abra um terminal na pasta do projeto e execute:

```bash
npm ci --ignore-scripts
npm start
```

Abra `http://localhost:3300`. Para abrir a mesma fazenda em outro dispositivo da sua rede, use o endereço local exibido no terminal.

Para testar a página inicial usada no domínio público, execute:

```bash
HH_MODE=multi HH_HOST=127.0.0.1 HH_TZ=America/Sao_Paulo npm start
```

O português do Brasil é o idioma inicial desta edição. A escolha de idioma é salva no navegador. O menu Configurações permite trocar o idioma durante a partida.

## Hospedar em bonusdiario.com.br

O [guia de instalação na VPS](INSTALACAO-VPS.md) cobre Node.js, o serviço systemd, o proxy Nginx e o certificado Let's Encrypt. Os modelos 3D, imagens e áudios já estão incluídos no pacote.

## Código e créditos

O [README original](README.md) reúne os créditos e os detalhes técnicos do projeto. A licença do código está no arquivo [LICENSE](LICENSE). Os recursos de terceiros têm seus próprios créditos em [modelos](public/assets/models/CREDITS.md) e [músicas](public/assets/audio/music/CREDITS.md).
