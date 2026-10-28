# FluxVideo — Pipeline de vídeo IA via MCP (Claude Desktop)

Servidor MCP local (Node/TypeScript, STDIO) que dá ao Claude as ferramentas para criar
vídeos verticais 9:16 de ponta a ponta:

```
[ Claude Desktop ] ──MCP/STDIO──► [ FluxVideo ]
                                     ├─ generate_image      → OpenAI (gpt-image-1 / dall-e-3) → scene_XX.png
                                     ├─ generate_video_i2v  → Fal.ai / Replicate / genérico   → scene_XX.mp4
                                     ├─ assemble_video      → ffmpeg (embutido)               → final.mp4
                                     └─ list_outputs
```

Arquivos ficam em `output/<project>/`.

## Instalação

```bash
npm install
npm install-scripts approve ffmpeg-static   # npm 11+: libera o download do binário ffmpeg
npm run build
cp .env.example .env   # preencha as chaves (ou passe via "env" no Claude Desktop)
```

## Claude Desktop

Edite `~/.config/Claude/claude_desktop_config.json` (Linux) ou
`%APPDATA%\Claude\claude_desktop_config.json` (Windows) — modelo em
[`claude_desktop_config.example.json`](./claude_desktop_config.example.json):

```json
{
  "mcpServers": {
    "flux-video": {
      "command": "node",
      "args": ["/home/luzia-tpv/FluxVideo/dist/server.js"],
      "env": { "OPENAI_API_KEY": "sk-...", "VIDEO_PROVIDER": "fal", "VIDEO_API_KEY": "..." }
    }
  }
}
```

Reinicie o Claude Desktop. Variáveis do bloco `env` têm prioridade sobre o `.env`.

## Uso

> Crie um vídeo vertical de 3 cenas sobre **[tema]**, projeto "meu-video". Para cada cena gere o
> keyframe com `generate_image`, anime com `generate_video_i2v` usando o `image_path` retornado e
> um movimento de câmera adequado, e no final junte tudo com `assemble_video`.

## Provedores de vídeo

| `VIDEO_PROVIDER` | `VIDEO_MODEL` (exemplo)                              | Como funciona                                    |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `fal` (padrão)   | `fal-ai/kling-video/v2.1/standard/image-to-video`    | Fila `queue.fal.run`: envia → consulta → baixa   |
| `replicate`      | `kwaivgi/kling-v2.1` ou `owner/name:versionhash`     | `predictions` com polling                        |
| `generic`        | — (usa `VIDEO_API_ENDPOINT`)                         | POST síncrono que devolve a URL do vídeo         |

Campos específicos de cada modelo (ex.: `aspect_ratio`, `cfg_scale`, nome do campo de imagem)
podem ser injetados com `VIDEO_EXTRA_INPUT='{"cfg_scale":0.5}'`.

A imagem é enviada como data URI a partir do arquivo local, então não depende de URLs
temporárias da OpenAI.

## Depuração

```bash
npm run inspect     # abre o MCP Inspector no navegador
```

Logs do servidor vão para stderr (o stdout é reservado ao protocolo). No Claude Desktop:
`~/.config/Claude/logs/mcp-server-flux-video.log`.
