# Harness Hollow em bonusdiario.com.br

O jogo roda em Node.js 24 ou superior e usa WebSocket para a partida em dupla. Esta configuração usa Nginx na frente da aplicação, Certbot para emitir o certificado e systemd para manter o serviço rodando. O Node escuta apenas em `127.0.0.1:3300`.

## Preparar a VPS

Os comandos abaixo são para Debian ou Ubuntu com systemd. Antes de percorrê-los, confirme no SSH a versão do Node, a porta disponível para a aplicação e a configuração do servidor web.

```bash
cat /etc/os-release
node --version
command -v node
sudo ss -ltnp | awk 'NR == 1 || $4 ~ /:(80|443|3300)$/'
getent ahosts bonusdiario.com.br
```

O DNS de `bonusdiario.com.br` deve apontar para a VPS. Se o domínio tiver um registro AAAA, confirme também o IPv6. O Let's Encrypt precisa alcançar a porta 80 para a emissão e a renovação com o plugin Nginx. A porta 443 serve o HTTPS. Revise o virtual host do domínio se Apache, Nginx, um painel de hospedagem ou outro serviço já estiver usando essas portas.

## Instalar o pacote

Baixe o ZIP da branch `bonusdiario-pt-br` no GitHub e envie o arquivo para a VPS, preferencialmente por SFTP. Descubra o caminho do arquivo no SSH. O diretório inicial do cliente FTP pode corresponder a um caminho diferente no Linux.

Exemplo de instalação nova. Ajuste a primeira linha ao local do arquivo e execute o bloco com Node 24 ou superior disponível em `/usr/local/bin` ou `/usr/bin`.

```bash
ARQUIVO=/root/harvest-hollowBR-bonusdiario-pt-br.zip
set -e
sudo apt-get update
sudo apt-get install -y unzip nginx certbot python3-certbot-nginx
sudo unzip -t "$ARQUIVO"
sudo install -d -m 0755 /opt/bonusdiario
sudo test ! -e /opt/bonusdiario/app
EXTRACAO=$(mktemp -d)
sudo unzip -q "$ARQUIVO" -d "$EXTRACAO"
set -- "$EXTRACAO"/*
test "$#" -eq 1
test -f "$1/package.json"
sudo mv -- "$1" /opt/bonusdiario/app
rmdir -- "$EXTRACAO"
sudo -H sh -c 'cd /opt/bonusdiario/app && npm ci --omit=dev --ignore-scripts'
sudo install -m 0644 /opt/bonusdiario/app/deploy/bonusdiario.service /etc/systemd/system/bonusdiario.service
sudo systemctl daemon-reload
sudo systemctl enable --now bonusdiario
curl --fail --show-error http://127.0.0.1:3300/api/status
```

O arquivo compactado contém a aplicação, as imagens, os modelos e os áudios. O servidor instala as dependências com o `package-lock.json`. O serviço armazena as fazendas em `/var/lib/bonusdiario`. Preserve esse diretório e faça cópias de segurança dele antes de uma atualização. As configurações específicas da VPS podem ficar em `/etc/bonusdiario.env`, com permissão `0600`.

## Ativar o domínio e o certificado

Em uma instalação padrão de Nginx para Debian ou Ubuntu, instale o arquivo do domínio após conferir que outro virtual host não declara o mesmo nome. Se o domínio já tiver um site, preserve a configuração atual e integre o proxy no virtual host existente.

```bash
sudo nginx -T 2>&1 | grep -E 'server_name.*bonusdiario\.com\.br'
```

Se for um domínio novo no Nginx, execute o bloco abaixo após validar o DNS. O Certbot pede um e-mail para os avisos da conta Let's Encrypt e a aceitação dos termos do serviço.

```bash
set -e
sudo test ! -e /etc/nginx/sites-available/bonusdiario.conf
sudo test ! -e /etc/nginx/sites-enabled/bonusdiario.conf
sudo install -m 0644 /opt/bonusdiario/app/deploy/bonusdiario.nginx.conf /etc/nginx/sites-available/bonusdiario.conf
sudo ln -s ../sites-available/bonusdiario.conf /etc/nginx/sites-enabled/bonusdiario.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --redirect -d bonusdiario.com.br
sudo certbot renew --dry-run
curl --fail --show-error https://bonusdiario.com.br/api/status
curl --fail --show-error https://bonusdiario.com.br/manifest.pt-BR.webmanifest
```

Abra `https://bonusdiario.com.br` e crie uma fazenda de teste. Entre com o link de convite em outro navegador para conferir o WebSocket e a partida em dupla. Os logs do jogo ficam disponíveis em `sudo journalctl -u bonusdiario -n 80 --no-pager`.

O modo público permite uma fazenda privada por partida, com até duas pessoas. Por padrão, fazendas sem visitas por sete dias são excluídas. Esta unidade inicia com o ajudante de IA e o envio de telemetria desabilitados. Antes de publicar, confirme se o aviso de privacidade descreve a administração e os registros da VPS.
