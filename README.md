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