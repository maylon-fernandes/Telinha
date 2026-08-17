(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const joinId = (params.get("join") || "").trim();
  const isViewer = !!joinId;

  const $ = (id) => document.getElementById(id);
  const appEl = $("app");
  const video = $("screen-video");
  const wrapper = $("screen-wrapper");
  const bPanel = $("broadcaster-panel");
  const startBtn = $("start-share-btn");
  const stopBtn = $("stop-share-btn");
  const statusEl = $("share-status");
  const linkInput = $("share-link");
  const copyBtn = $("copy-link-btn");
  const bStats = $("broadcaster-stats");
  const bHint = $("b-hint");
  const viewerCountEl = $("viewer-count");
  const vStatus = $("viewer-status");
  const fullscreenBtn = $("fullscreen-btn");
  const leaveBtn = $("leave-btn");
  const ctrlBar = $("viewer-controls");
  const volumeBtn = $("volume-btn");
  const volumeSlider = $("volume-slider");
  const badge = $("live-badge");
  const popup = $("share-popup");
  const popupLink = $("popup-link");
  const popupCopyBtn = $("popup-copy-btn");
  const popupOkBtn = $("popup-ok-btn");
  const popupStopBtn = $("popup-stop-btn");
  const timerEls = [$("popup-timer"), $("badge-timer"), $("timer")];

  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80?transport=udp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: ["turn:openrelay.metered.ca:80?transport=tcp", "turn:openrelay.metered.ca:443?transport=tcp"],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];

  function makePC() {
    return new RTCPeerConnection({ iceServers: ICE_SERVERS });
  }

  function openWS() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.onopen = null;
        resolve(ws);
      };
      ws.onerror = () => reject(new Error("Falha ao conectar ao servidor."));
    });
  }

  function send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /* ================= TRANSMISSOR ================= */

  let broadcastWS = null;
  let sessionId = null;
  let displayStream = null;
  let viewerPCs = new Map();
  let statsTimer = null;
  let shareStartTime = 0;
  let timerInterval = null;

  let viewerWS = null;
  let viewerPC = null;
  let pendingCandidates = [];
  let attempts = 0;
  let viewerEnded = false;
  let reconnectTimer = null;
  let errorFired = false;

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function updateTimerEls() {
    const t = fmtTime(Date.now() - shareStartTime);
    for (const el of timerEls) if (el) el.textContent = t;
  }

  function startTimer() {
    shareStartTime = Date.now();
    updateTimerEls();
    timerInterval = setInterval(updateTimerEls, 1000);
  }

  function resetTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    shareStartTime = 0;
    for (const el of timerEls) if (el) el.textContent = "00:00";
  }

  if (!isViewer) {
    startBtn.addEventListener("click", startSharing);
    stopBtn.addEventListener("click", stopSharing);
    copyBtn.addEventListener("click", () => {
      linkInput.select();
      try {
        navigator.clipboard.writeText(linkInput.value);
      } catch (e) {}
      copyBtn.textContent = "Copiado!";
      setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
    });

    popupOkBtn.addEventListener("click", () => popup.classList.add("hidden"));
    popupStopBtn.addEventListener("click", stopSharing);
    popup.addEventListener("click", (e) => {
      if (e.target === popup) popup.classList.add("hidden");
    });
    popupCopyBtn.addEventListener("click", () => {
      popupLink.select();
      try {
        navigator.clipboard.writeText(popupLink.value);
      } catch (e) {}
      popupCopyBtn.textContent = "Copiado!";
      setTimeout(() => (popupCopyBtn.textContent = "Copiar"), 1500);
    });

    window.addEventListener("beforeunload", (e) => {
      if (displayStream) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  } else {
    initViewer();
  }

  async function startSharing() {
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: true,
      });
    } catch (err) {
      alert("Captura de tela cancelada ou não permitida pelo navegador.");
      return;
    }

    startBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    video.srcObject = displayStream;
    video.muted = true;
    wrapper.classList.remove("hidden");
    appEl.classList.add("sharing");
    bHint.textContent = "Transmissão ao vivo. Compartilhe o link com quem quiser ver sua tela.";

    displayStream.getTracks().forEach((t) =>
      t.addEventListener("ended", () => stopSharing())
    );

    try {
      broadcastWS = await openWS();
    } catch (err) {
      alert("Não foi possível gerar o link de acesso.");
      stopSharing();
      return;
    }

    broadcastWS.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "joined":
          sessionId = msg.id;
          const link = location.origin + "/view?join=" + sessionId;
          linkInput.value = link;
          popupLink.value = link;
          statusEl.classList.remove("hidden");
          badge.classList.remove("hidden");
          popup.classList.remove("hidden");
          viewerCountEl.classList.remove("hidden");
          updateViewerCount(0);
          startTimer();
          send(broadcastWS, { type: "share-ready" });
          startStats();
          break;
        case "viewer-count":
          updateViewerCount(msg.count);
          break;
        case "viewer-arrived":
          createViewerPC(msg.viewerId);
          break;
        case "answer": {
          const pc = viewerPCs.get(msg.viewerId);
          if (pc) {
            pc.setRemoteDescription(msg.sdp)
              .then(() => {
                const pending = pc._pendingRemoteIce || [];
                pc._pendingRemoteIce = [];
                for (const c of pending) pc.addIceCandidate(c).catch(() => {});
              })
              .catch(() => {});
          }
          break;
        }
        case "ice": {
          const pc = viewerPCs.get(msg.viewerId);
          if (pc) {
            if (pc.remoteDescription) {
              pc.addIceCandidate(msg.candidate).catch(() => {});
            } else {
              pc._pendingRemoteIce = pc._pendingRemoteIce || [];
              pc._pendingRemoteIce.push(msg.candidate);
            }
          }
          break;
        }
        case "viewer-left":
          closeViewerPC(msg.viewerId);
          break;
      }
    };

    broadcastWS.onclose = () => stopSharing();

    send(broadcastWS, { type: "join", role: "broadcaster" });
  }

  async function createViewerPC(viewerId) {
    const pc = makePC();
    viewerPCs.set(viewerId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) send(broadcastWS, { type: "ice", viewerId, candidate: e.candidate });
    };

    displayStream.getTracks().forEach((t) => pc.addTrack(t, displayStream));

    for (const s of pc.getSenders()) {
      if (s.track && s.track.kind === "video") {
        const p = s.getParameters();
        if (p.encodings && p.encodings.length) {
          p.encodings[0].maxBitrate = 8000000;
          p.encodings[0].maxFramerate = 60;
        }
        s.setParameters(p).catch(() => {});
      }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send(broadcastWS, { type: "offer", viewerId, sdp: pc.localDescription });
  }

  function closeViewerPC(viewerId) {
    const pc = viewerPCs.get(viewerId);
    if (pc) {
      pc.close();
      viewerPCs.delete(viewerId);
    }
  }

  function updateViewerCount(n) {
    if (!viewerCountEl) return;
    viewerCountEl.textContent =
      "👁 " + n + (n === 1 ? " pessoa assistindo" : " pessoas assistindo");
  }

  function stopSharing() {
    if (displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
      displayStream = null;
    }
    for (const vid of [...viewerPCs.keys()]) closeViewerPC(vid);
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
    resetTimer();
    if (broadcastWS) {
      broadcastWS.onclose = null;
      broadcastWS.close();
      broadcastWS = null;
    }
    video.srcObject = null;
    wrapper.classList.add("hidden");
    appEl.classList.remove("sharing");
    badge.classList.add("hidden");
    popup.classList.add("hidden");
    stopBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
    statusEl.classList.add("hidden");
    linkInput.value = "";
    popupLink.value = "";
    bStats.textContent = "";
    viewerCountEl.classList.add("hidden");
    viewerCountEl.textContent = "";
    sessionId = null;
    bHint.textContent =
      "O link gerado é compartilhado com quem quiser ver sua tela. Todos os dispositivos precisam alcançar este servidor.";
  }

  function startStats() {
    bStats.textContent = "Aguardando espectadores...";
    statsTimer = setInterval(async () => {
      const pc = [...viewerPCs.values()][0];
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        for (const s of stats.values()) {
          if (
            (s.type === "outbound-rtp" || s.type === "remote-inbound-rtp") &&
            s.kind === "video"
          ) {
            bStats.textContent =
              `Enviando ${s.frameWidth || "?"}x${s.frameHeight || "?"} ` +
              `@ ${s.framesPerSecond || 0} fps`;
            break;
          }
        }
      } catch (e) {}
    }, 2000);
  }

  /* ================= ESPECTADOR ================= */

  function updateVolumeIcon() {
    if (!volumeBtn) return;
    const v = video.volume;
    volumeBtn.textContent = video.muted || v === 0 ? "🔇" : v < 0.5 ? "🔉" : "🔊";
  }

  function setVolumeFill() {
    if (volumeSlider) volumeSlider.style.setProperty("--v", volumeSlider.value + "%");
  }

  let ctrlTimer = null;

  function kickControls() {
    if (viewerEnded) return;
    ctrlBar.classList.remove("idle");
    if (ctrlTimer) clearTimeout(ctrlTimer);
    if (!video.srcObject) return;
    ctrlTimer = setTimeout(() => ctrlBar.classList.add("idle"), 3000);
  }

  function initViewer() {
    bPanel.classList.add("hidden");
    document.body.classList.add("viewer-mode");
    wrapper.classList.remove("hidden");
    ctrlBar.classList.remove("hidden");
    vStatus.classList.remove("hidden");
    setVolumeFill();

    wrapper.addEventListener("mousemove", () => {
      if (video.srcObject) kickControls();
    });

    volumeBtn.addEventListener("click", () => {
      video.muted = !video.muted;
      if (!video.muted) {
        video.volume = volumeSlider.value / 100;
        video.play().catch(() => {});
      }
      updateVolumeIcon();
      kickControls();
    });
    volumeSlider.addEventListener("input", () => {
      const level = volumeSlider.value / 100;
      video.volume = level;
      if (level > 0 && video.muted) {
        video.muted = false;
        video.play().catch(() => {});
      }
      setVolumeFill();
      updateVolumeIcon();
      kickControls();
    });
    fullscreenBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else wrapper.requestFullscreen().catch(() => {});
    });
    leaveBtn.addEventListener("click", () => {
      endViewer("Desconectado.");
      location.href = "/";
    });
    connectViewer();
  }

  function closeViewerWS() {
    if (viewerWS) {
      viewerWS.onclose = null;
      viewerWS.onmessage = null;
      viewerWS.onerror = null;
      viewerWS.close();
      viewerWS = null;
    }
  }

  function scheduleReconnect(msg) {
    if (viewerEnded) return;
    attempts++;
    if (attempts > 30) {
      endViewer("Não foi possível conectar à transmissão.");
      return;
    }
    vStatus.textContent = msg;
    if (ctrlTimer) clearTimeout(ctrlTimer);
    ctrlBar.classList.remove("idle");
    closeViewerWS();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectViewer();
    }, 2500);
  }

  function connectViewer() {
    closeViewerWS();
    errorFired = false;

    try {
      viewerWS = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect("Erro de conexão.");
      return;
    }

    viewerWS.onopen = () => send(viewerWS, { type: "join", role: "viewer", joinId });

    viewerWS.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "joined":
          vStatus.textContent = "Conectando ao transmissor...";
          viewerPC = makePC();
          try {
            viewerPC.addTransceiver("video", { direction: "recvonly" });
          } catch (err) {}
          viewerPC.onconnectionstatechange = () => {
            if (!viewerPC || viewerEnded) return;
            const st = viewerPC.connectionState;
            if (st === "failed" || st === "disconnected") {
              vStatus.classList.remove("hidden");
              vStatus.textContent = "Sem conexão com o transmissor.";
            }
          };
          viewerPC.onicecandidate = (ev) => {
            if (ev.candidate) send(viewerWS, { type: "ice", joinId, candidate: ev.candidate });
          };
          viewerPC.ontrack = (ev) => {
            if (ev.streams && ev.streams[0]) {
              const stream = ev.streams[0];
              video.muted = true;
              video.volume = volumeSlider.value / 100;
              video.srcObject = stream;
              video.play().catch(() => {});
              vStatus.classList.add("hidden");
              badge.classList.remove("hidden");
              setVolumeFill();
              updateVolumeIcon();
              kickControls();
            }
          };
          break;

        case "offer":
          (async () => {
            await viewerPC.setRemoteDescription(msg.sdp);
            for (const c of pendingCandidates) {
              viewerPC.addIceCandidate(c).catch(() => {});
            }
            pendingCandidates = [];
            const answer = await viewerPC.createAnswer();
            await viewerPC.setLocalDescription(answer);
            send(viewerWS, { type: "answer", joinId, sdp: viewerPC.localDescription });
          })().catch((err) => {
            vStatus.textContent = "Erro: " + err.message;
          });
          break;

        case "ice":
          if (viewerPC && viewerPC.remoteDescription) {
            viewerPC.addIceCandidate(msg.candidate).catch(() => {});
          } else if (viewerPC) {
            pendingCandidates.push(msg.candidate);
          }
          break;

        case "broadcaster-left":
          endViewer("Transmissão encerrada.");
          break;

        case "error":
          scheduleReconnect("O transmissor ainda não iniciou. Reconectando...");
          break;
      }
    };

    viewerWS.onerror = () => {
      errorFired = true;
      scheduleReconnect("Erro de conexão. Reconectando...");
    };

    viewerWS.onclose = () => {
      if (!errorFired && !viewerEnded) scheduleReconnect("Conexão perdida. Reconectando...");
    };
  }

  function endViewer(msg) {
    if (viewerEnded) return;
    viewerEnded = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ctrlTimer) {
      clearTimeout(ctrlTimer);
      ctrlTimer = null;
    }
    ctrlBar.classList.remove("idle");
    if (viewerPC) {
      viewerPC.close();
      viewerPC = null;
    }
    closeViewerWS();
    vStatus.textContent = msg;
    vStatus.classList.remove("hidden");
    badge.classList.add("hidden");
  }
})();