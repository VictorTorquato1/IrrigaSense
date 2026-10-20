# IrrigaSense

## Integração Supabase

O projeto continua sendo um frontend estático e usa `@supabase/supabase-js` e
Chart.js por CDN. O navegador não consegue ler um arquivo `.env` sozinho. Em
produção, injete as variáveis públicas no HTML antes de `JS/script.js`:

```html
<script>
  window.IRRIGASENSE_CONFIG = {
    url: "https://SEU_PROJETO.supabase.co",
    anonKey: "SUA_ANON_KEY_PUBLICA"
  };
</script>
```

Os nomes equivalentes no ambiente de hospedagem são `SUPABASE_URL` e
`SUPABASE_ANON_KEY`. A chave pública `anon` pode aparecer no frontend quando o
RLS está configurado corretamente. Nunca use `SUPABASE_SERVICE_ROLE_KEY` no
navegador.

Também é possível usar o arquivo de exemplo `config.example.js` como ponto de
partida. Sem essa configuração, o dashboard local e a Web Serial continuam
funcionando, porém histórico e persistência remotos ficam desativados.

### Banco e RLS

O SQL necessário foi adicionado em `supabase/schema.sql` para criar as tabelas
mínimas do projeto e habilitar RLS de forma segura para um protótipo
acadêmico. Ajuste as políticas do Supabase conforme o acesso real do ambiente.

### Executar localmente

Abra o projeto por um servidor HTTP local, pois Web Serial exige contexto seguro
(localhost é aceito). Por exemplo, com Python instalado:

```powershell
py -m http.server 8000
```

Depois acesse `http://localhost:8000` em um navegador Chromium compatível com
Web Serial. Configure `window.IRRIGASENSE_CONFIG` antes de abrir a página para
habilitar Supabase.

### Usar pelo Live Share

O Live Share não inicia um servidor web automaticamente. No terminal do
workspace anfitrião, inicie o servidor na pasta do projeto:

```bash
python3 -m http.server 8000
```

No Live Share, compartilhe a porta `8000` (comando **Live Share: Share Server**).
Abra a URL do servidor compartilhado no navegador. Não abra o arquivo
`index.html` diretamente nem use o endereço `localhost` da máquina convidada.

### Controle da bomba pelo ESP32

Conecte o ESP32 pela porta serial a `115200` baud. No protocolo textual, o
dispositivo deve responder a `PING` com `IRRIGASENSE_OK`; depois, o site envia
`LIGAR`, `DESLIGAR` ou `STATUS` e interpreta `STATUS:LIGADA` e
`STATUS:DESLIGADA`. A cada segundo, também recebe `VAZAO:<L/min>;TOTAL:<litros>`
e atualiza as leituras e o gráfico. Os controles da bomba só são liberados após
o reconhecimento do dispositivo. A comunicação JSON existente continua aceita.