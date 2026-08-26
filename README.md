# Telinha

Compartilhe sua tela com amigos de graça, sem servidor, sem complicação.

<br>

![Electron](https://img.shields.io/badge/Electron-33.4-47848F?logo=electron&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-FF6633?logo=webrtc&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

<br>

## Como funciona

1. Abra o app e clique em **Transmitir**
2. Escolha a qualidade (1080p 60fps / 720p 60fps / etc)
3. Selecione a tela ou janela que quer compartilhar
4. O app gera um **código de 4 dígitos**
5. Seu amigo abre o app, clica em **Assistir**, e digita o código

Pronto — conexão P2P direta, sem servidor intermediário.

<br>

## Pre-requisitos

- [Node.js](https://nodejs.org/) (v18+)
- npm (vem junto com o Node)

<br>

## Instalação

```bash
git clone https://github.com/maylon-fernandes/Telinha.git
cd Telinha
npm install
```

<br>

## Uso

```bash
npm start
```

<br>

## Build (Windows)

Para gerar o instalador `.exe`:

```bash
npm run build
```

O instalador será gerado em `dist/telinha Setup 1.0.0.exe`.

<br>

## Stack

- **Electron** — desktop app
- **PeerJS** — conexão P2P via WebRTC (servidor de sinalização gratuito)
- **Vanilla JS** — zero frameworks
- **WebRTC** — streaming de vídeo e áudio em tempo real
- **GSAP** — animações de transição
- **ASCII Art** — fundo animado em tons de cinza

<br>

## Funcionalidades

- Compartilhamento de tela via WebRTC (P2P)
- Código de 4 dígitos para conexão fácil
- Seleção de qualidade (1080p/720p, 60/30fps)
- Qualidade adaptativa baseada na rede
- Compartilhamento de áudio opcional
- Controle de volume no viewer
- Modo tela cheia
- Título customizado (frameless)
- Múltiplos espectadores simultâneos

<br>

## Estrutura

```
telinha/
├── main.js              # Processo principal do Electron
├── preload.js           # Bridge entre main e renderer
├── package.json
└── electron/
    ├── index.html       # Interface (UI)
    ├── renderer.js      # Toda a lógica (PeerJS, WebRTC, UI)
    ├── style.css        # Estilos
    ├── ascii-bg.js      # Animação de fundo
    ├── favicon.ico      # Ícone do app
    └── NEOPIXEL-Regular.otf  # Fonte do logo
```

<br>

## Licença

MIT
