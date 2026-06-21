# StreamEngine 24/7 - YouTube Live Streaming System

Uma solução completa, robusta e pronta para produção para streaming 24 horas em looping contínuo no YouTube Live, hospedada em VPS usando Docker e orquestrada via EasyPanel ou Docker Compose.

O sistema possui uma interface administrativa moderna e responsiva (Next.js), um backend de gerenciamento centralizado (Fastify + Prisma + PostgreSQL) e um motor de transmissão dedicado (Stream Engine Watchdog) que monitora o FFmpeg, garante reinício automático, recupera-se de quedas e reproduz vídeos em loop ou de forma randômica sem derrubar a live.

---

## 🛠️ Arquitetura do Sistema

O projeto é dividido em uma estrutura modular no formato monorepo:

- `/apps/frontend`: Dashboard administrativo em **React / Next.js 14**. Interface glassmorphic premium em dark mode com suporte a drag-and-drop para uploads e ordenação de playlists.
- `/apps/backend`: API em **Node.js + TypeScript (Fastify)** que gerencia a autenticação JWT, uploads de arquivos, banco de dados (Prisma/PostgreSQL) e comunicação com o worker.
- `/apps/worker-stream`: Daemon em **Node.js (FFmpeg Watchdog)** encarregado de rodar e monitorar a transmissão em tempo real. Ele extrai estatísticas (bitrate, fps, tempo) do output do FFmpeg e implementa o ciclo de vida da live.
- `/docker`: Dockerfiles dedicados para cada microsserviço.
- `/storage`: Diretório de persistência compartilhada de arquivos de vídeo.

---

## 🚀 Como Funciona o Encoder Inteligente (Baixo Uso de CPU)

Streaming de vídeo 24/7 pode consumir 100% de CPU de uma VPS pequena se houver re-encode contínuo. Nosso sistema contorna esse problema através de **Normalização Automática na Ingestão**:

1. **Upload de Vídeo**: O usuário faz o upload de qualquer vídeo (`.mp4`, `.mkv`, `.avi`, `.mov`).
2. **Transcodificação em Background**: O backend detecta o upload e executa uma transcodificação assíncrona única usando o FFmpeg, convertendo o vídeo para o padrão da biblioteca: **720p H.264 (AAC 128k de áudio, 30 FPS)**.
3. **Direct Stream Copy**: Como todos os vídeos da biblioteca estão exatamente no mesmo formato, o Stream Engine transmite para o YouTube usando o codec `copy` (`-c:v copy -c:a copy`).
4. **VPS Leve**: No modo `COPY` (padrão), o uso de CPU da VPS cai para **próximo de 0%**, pois o servidor apenas redireciona os pacotes de vídeo pré-processados para o servidor do YouTube, sem decodificar/codificar novamente.

---

## 🛡️ Watchdog & Sistema de Fallback

O sistema foi desenhado para ser resiliente a qualquer falha:

- **Recuperação contra Travamento**: Se o FFmpeg travar, perder conexão ou fechar com erro, o Watchdog reinicia o processo em até 3 segundos.
- **Detecção de Arquivo Corrompido**: Se um vídeo fechar com erro em menos de 3 segundos consecutivos, o sistema o marca como `FAILED` no banco de dados, gera um alerta no painel, pula para o próximo vídeo e evita um loop infinito de falhas.
- **Auto-Resume pós Reboot**: O Worker detecta se a live estava ativa antes do encerramento do container/VPS e inicia a transmissão automaticamente no boot.
- **Vídeo de Fallback**: Caso a playlist ativa termine, seja deletada ou todos os vídeos apresentem falhas de codificação, o sistema gera dinamicamente um arquivo `/storage/videos/fallback/fallback.mp4` (tela preta com áudio silencioso) e transmite em loop contínuo. **A live nunca cai.**

---

## 📋 Requisitos para VPS

- **Sistema Operacional**: Ubuntu 22.04+ (com Docker e Docker Compose instalados) ou EasyPanel instalado.
- **VPS recomendada**: 1 vCPU, 1GB RAM (para o streaming em modo `COPY`). Caso use transcodificação simultânea pesada no upload, recomenda-se 2 vCPU.

---

## 📦 Como Implantar no EasyPanel (VPS)

O **EasyPanel** é um painel de controle moderno baseado em Docker. Você pode implantar esta solução de duas maneiras:

### Opção A: Deploy usando Docker Compose (Recomendado)

1. Acesse o painel do seu **EasyPanel**.
2. Clique em **Create Project** e dê um nome (ex: `stream-engine`).
3. Dentro do projeto, clique em **Templates** ou escolha criar uma aplicação via **Docker Compose**.
4. Copie todo o conteúdo do arquivo [docker-compose.yml](file:///d:/Projetos%20Antigravity/live-get/docker-compose.yml) do projeto e cole no campo de configuração.
5. Configure as seguintes **Variáveis de Ambiente** no painel:
   - `JWT_SECRET`: Uma senha forte para os tokens JWT.
   - `ADMIN_USERNAME`: Nome de usuário do painel admin (padrão: `admin`).
   - `ADMIN_PASSWORD`: Senha de acesso do painel admin (padrão: `adminpassword123`).
   - `NEXT_PUBLIC_API_URL`: A URL pública ou IP do seu backend (ex: `http://ip-da-vps:5000`).
6. Clique em **Deploy**. O EasyPanel irá construir as imagens a partir do repositório, subir o banco de dados PostgreSQL automaticamente e rodar os microsserviços.

### Opção B: Deploy de Serviços Individuais no EasyPanel

Caso prefira configurar os serviços manualmente para melhor roteamento de domínios:

1. **Banco de Dados (PostgreSQL)**:
   - Clique em **Add Service** -> **Database** -> **PostgreSQL**.
   - Defina o nome como `db`.

2. **Backend (Fastify)**:
   - Crie um novo serviço do tipo **App**.
   - Configure o repositório Git do seu projeto.
   - Nas configurações de build, defina o **Build Path** como `/apps/backend` e o **Dockerfile Path** como `/docker/Dockerfile.backend`.
   - Adicione as variáveis de ambiente (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`).
   - Crie um **Volume Persistente** mapeando `/storage` no container para armazenar os vídeos.

3. **Stream Worker (watchdog)**:
   - Crie um novo serviço do tipo **App**.
   - Aponte para o repositório Git do seu projeto.
   - Defina o **Build Path** como `/apps/worker-stream` e o **Dockerfile Path** como `/docker/Dockerfile.worker`.
   - Mapeie o mesmo **Volume Persistente** `/storage` criado no backend (compartilhamento de arquivos).
   - Adicione as variáveis de ambiente (`DATABASE_URL`, `STORAGE_DIR`).

4. **Frontend (Next.js)**:
   - Crie um novo serviço do tipo **App**.
   - Defina o **Build Path** como `/apps/frontend` e o **Dockerfile Path** como `/docker/Dockerfile.frontend`.
   - Adicione a variável `NEXT_PUBLIC_API_URL` apontando para o domínio ou IP público do Backend.
   - Exponha a porta 3000 para a internet.

---

## 💻 Desenvolvimento e Testes Locais

Se você deseja rodar a aplicação localmente no seu computador antes de subir para a VPS:

### 1. Pré-requisitos
- Node.js 18+ instalado.
- FFmpeg e FFprobe instalados no sistema e disponíveis nas variáveis de ambiente (`PATH`).
- Docker instalado (para rodar o PostgreSQL localmente).

### 2. Passo a Passo

1. **Suba o Banco de Dados (PostgreSQL)**:
   ```bash
   docker run --name local-stream-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=livestream -p 5432:5432 -d postgres:15-alpine
   ```

2. **Configure e inicialize o Backend**:
   ```bash
   cd apps/backend
   npm install
   # Cria o banco e gera o Prisma Client
   npx prisma db push
   # Roda em modo desenvolvimento
   npm run dev
   ```

3. **Configure e inicialize o Streaming Worker**:
   ```bash
   cd apps/worker-stream
   npm install
   npx prisma generate
   # Roda o worker de transmissão
   npm run dev
   ```

4. **Inicialize o Frontend**:
   ```bash
   cd apps/frontend
   npm install
   # Roda o painel Next.js em http://localhost:3000
   npm run dev
   ```

5. Acesse [http://localhost:3000](http://localhost:3000). Use as credenciais definidas nas variáveis de ambiente do backend para logar (Usuário: `admin` / Senha: `adminpassword123`).

---

## 📈 Uptime e Monitoramento

- A aba **Terminal & Logs** exibe o output bruto do FFmpeg. Qualquer mensagem de erro, timeout ou problemas com a chave de transmissão do YouTube aparecerá em vermelho.
- O sistema salva os logs mais importantes no PostgreSQL para auditoria.
- O histórico de uptime calcula a taxa de transmissões bem-sucedidas nas últimas 24h automaticamente.
