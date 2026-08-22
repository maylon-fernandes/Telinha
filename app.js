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

  const configPopup = $("config-popup");
  const configConfirm = $("config-confirm");
  const configCancel = $("config-cancel");

  const wsUrl =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws";

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
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

  /* ================= CONFIG ================= */

  let shareConfig = { quality: "1080", fps: "30" };

  function getConfigBitrate() {
    const map = { "1080": 8000000, "720": 4000000, "480": 1500000 };
    return map[shareConfig.quality] || 8000000;
  }

  function getConfigFps() {
    return parseInt(shareConfig.fps, 10) || 30;
  }

  function getConfigHeight() {
    const map = { "1080": 1080, "720": 720, "480": 480 };
    return map[shareConfig.quality] || 1080;
  }

  function getConfigWidth() {
    const h = getConfigHeight();
    return Math.round(h * (16 / 9));
  }

  function getScale() {
    const map = { "1080": 1.0, "720": 720 / 1080, "480": 480 / 1080 };
    return map[shareConfig.quality] || 1.0;
  }

  /* Config popup option clicks */
  document.querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const value = btn.dataset.value;
      shareConfig[key] = value;
      document.querySelectorAll(`.option[data-key="${key}"]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  configConfirm.addEventListener("click", () => {
    configPopup.classList.add("hidden");
    doStartSharing();
  });

  configCancel.addEventListener("click", () => {
    configPopup.classList.add("hidden");
  });

  configPopup.addEventListener("click", (e) => {
    if (e.target === configPopup) configPopup.classList.add("hidden");
  });

  /* ================= QUALITY ADAPTIVE ================= */

  const QualityProfile = {
    ULTRA: { maxBitrate: 8000000, maxFps: 60, scale: 1.0, label: "Ultra (1080p60)" },
    HIGH:  { maxBitrate: 5000000, maxFps: 30, scale: 1.0, label: "Alta (1080p30)" },
    MEDIUM:{ maxBitrate: 2500000, maxFps: 30, scale: 0.75, label: "Média (720p30)" },
    LOW:   { maxBitrate: 1200000, maxFps: 24, scale: 0.5, label: "Baixa (480p24)" },
    MIN:   { maxBitrate: 600000,  maxFps: 15, scale: 0.35, label: "Mínima (360p15)" },
  };

  let currentProfile = QualityProfile.ULTRA;
  let qualityStats = { packetsLost: 0, rtt: 0, bandwidth: 0, framesDropped: 0 };
  let profileHistory = [];
  let broadcastWSRef = null;

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
  let sigReady = false;

  let viewerWS = null;
  let viewerPC = null;
  let pendingCandidates = [];
  let attempts = 0;
  let viewerEnded = false;
  let reconnectTimer = null;
  let errorFired = false;
  let backoffDelay = 2500;

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
    startBtn.addEventListener("click", () => {
      configPopup.classList.remove("hidden");
    });
    stopBtn.addEventListener("click", stopSharing);
    copyBtn.addEventListener("click", () => {
      linkInput.select();
      try { navigator.clipboard.writeText(linkInput.value); } catch (e) {}
      copyBtn.textContent = "COPIED!";
      setTimeout(() => (copyBtn.textContent = "COPY"), 1500);
    });

    popupOkBtn.addEventListener("click", () => popup.classList.add("hidden"));
    popupStopBtn.addEventListener("click", stopSharing);
    popup.addEventListener("click", (e) => {
      if (e.target === popup) popup.classList.add("hidden");
    });
    popupCopyBtn.addEventListener("click", () => {
      popupLink.select();
      try { navigator.clipboard.writeText(popupLink.value); } catch (e) {}
      popupCopyBtn.textContent = "COPIED!";
      setTimeout(() => (popupCopyBtn.textContent = "COPY"), 1500);
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

  async function doStartSharing() {
    try {
      const constraints = {
        video: {
          width: { ideal: getConfigWidth(), max: getConfigWidth() },
          height: { ideal: getConfigHeight(), max: getConfigHeight() },
          frameRate: { ideal: getConfigFps(), max: getConfigFps() },
        },
        audio: true,
      };
      displayStream = await navigator.mediaDevices.getDisplayMedia(constraints);
    } catch (err) {
      return;
    }

    currentProfile = {
      maxBitrate: getConfigBitrate(),
      maxFps: getConfigFps(),
      scale: getScale(),
      label: `${shareConfig.quality}p${shareConfig.fps}`,
    };

    startBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    video.srcObject = displayStream;
    video.muted = true;
    wrapper.classList.remove("hidden");
    appEl.classList.add("sharing");
    bHint.textContent = "ao vivo. compartilhe o link.";

    displayStream.getTracks().forEach((t) =>
      t.addEventListener("ended", () => stopSharing())
    );

    connectBroadcastSignaling(0);
  }

  function connectBroadcastSignaling(retry) {
    openWS()
      .then((ws) => {
        broadcastWS = ws;
        setupBroadcastSignaling();
      })
      .catch(() => {
        if (!displayStream) return;
        if (retry >= 15) {
          bHint.textContent = "sem conexão com o servidor.";
          return;
        }
        bHint.textContent = "conectando...";
        setTimeout(() => connectBroadcastSignaling(retry + 1), 2500);
      });
  }

  function setupBroadcastSignaling() {
    broadcastWS.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "joined":
          sessionId = msg.id;
          const link = location.origin + "/view?join=" + sessionId;
          linkInput.value = link;
          popupLink.value = link;
          if (!sigReady) {
            statusEl.classList.remove("hidden");
            badge.classList.remove("hidden");
            popup.classList.remove("hidden");
            viewerCountEl.classList.remove("hidden");
            updateViewerCount(0);
            startTimer();
            startStats();
            sigReady = true;
          } else {
            bHint.textContent = "reconectado.";
          }
          send(broadcastWS, { type: "share-ready" });
          break;
        case "viewer-count":
          updateViewerCount(msg.count);
          break;
        case "viewer-arrived":
          createViewerPC(msg.viewerId);
          send(broadcastWS, { type: "broadcast-start", viewerId: msg.viewerId, startTime: shareStartTime });
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

    broadcastWS.onclose = () => {
      broadcastWS = null;
      if (displayStream) {
        bHint.textContent = "reconectando ao servidor...";
        connectBroadcastSignaling(0);
      }
    };
    broadcastWS.onerror = () => {
      try { broadcastWS.close(); } catch (e) {}
    };

    send(broadcastWS, { type: "join", role: "broadcaster", id: sessionId || undefined });
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
        if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
        p.encodings[0].maxBitrate = currentProfile.maxBitrate;
        p.encodings[0].maxFramerate = currentProfile.maxFps;
        p.encodings[0].scaleResolutionDownBy = currentProfile.scale > 0 ? (1 / currentProfile.scale) : 1;
        p.encodings[0].networkPriority = "high";
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
      n + (n === 1 ? " viewer" : " viewers");
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
    sigReady = false;
    currentProfile = QualityProfile.ULTRA;
    qualityStats = { packetsLost: 0, rtt: 0, bandwidth: 0, framesDropped: 0 };
    profileHistory = [];
    bHint.textContent = "clique em iniciar para compartilhar sua tela.";
  }

  function startStats() {
    bStats.textContent = "aguardando viewers...";
    statsTimer = setInterval(async () => {
      const pc = [...viewerPCs.values()][0];
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let outbound = null;
        let remoteInbound = null;

        for (const s of stats.values()) {
          if (s.type === "outbound-rtp" && s.kind === "video") outbound = s;
          if (s.type === "remote-inbound-rtp" && s.kind === "video") remoteInbound = s;
        }

        if (outbound) {
          qualityStats.packetsLost = outbound.packetsLost || 0;
          qualityStats.framesDropped = outbound.framesDropped || 0;
          qualityStats.bandwidth = outbound.bytesSent || 0;

          if (remoteInbound) {
            qualityStats.rtt = remoteInbound.roundTripTime || 0;
          }

          const resolution = `${outbound.frameWidth || "?"}x${outbound.frameHeight || "?"}`;
          const fps = outbound.framesPerSecond || 0;
          const quality = getConnectionQuality();

          bStats.innerHTML =
            `${resolution} @ ${fps}fps` +
            ` <span style="color:${quality.color}">${quality.label}</span>`;

          adaptQuality(qualityStats, [...viewerPCs.values()]);
        }
      } catch (e) {}
    }, 1500);
  }

  function getConnectionQuality() {
    const { rtt, packetsLost } = qualityStats;
    if (rtt < 0.05 && packetsLost < 10) return { level: 3, label: "ok", color: "#00ff66" };
    if (rtt < 0.15 && packetsLost < 50) return { level: 2, label: "ok", color: "#3399ff" };
    if (rtt < 0.30 && packetsLost < 200) return { level: 1, label: "instavel", color: "#ff9900" };
    return { level: 0, label: "ruim", color: "#ff3333" };
  }

  function adaptQuality(stats, pcs) {
    const profiles = [QualityProfile.MIN, QualityProfile.LOW, QualityProfile.MEDIUM, QualityProfile.HIGH, QualityProfile.ULTRA];
    const currentIdx = profiles.indexOf(currentProfile);

    let targetIdx = currentIdx;
    const { rtt, packetsLost } = stats;

    if (rtt > 0.30 || packetsLost > 200) {
      targetIdx = Math.max(0, currentIdx - 2);
    } else if (rtt > 0.15 || packetsLost > 50) {
      targetIdx = Math.max(0, currentIdx - 1);
    } else if (rtt < 0.05 && packetsLost < 10 && currentIdx < profiles.length - 1) {
      targetIdx = Math.min(profiles.length - 1, currentIdx + 1);
    }

    if (targetIdx !== currentIdx) {
      profileHistory.push({ from: currentProfile.label, to: profiles[targetIdx].label, time: Date.now() });
      if (profileHistory.length > 20) profileHistory.shift();
      currentProfile = profiles[targetIdx];
      applyQualityToAll(pcs);
    }
  }

  function applyQualityToAll(pcs) {
    for (const pc of pcs) {
      for (const sender of pc.getSenders()) {
        if (sender.track && sender.track.kind === "video") {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = currentProfile.maxBitrate;
          params.encodings[0].maxFramerate = currentProfile.maxFps;
          params.encodings[0].scaleResolutionDownBy = currentProfile.scale > 0 ? (1 / currentProfile.scale) : 1;
          sender.setParameters(params).catch(() => {});
        }
      }
    }
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
  let viewerStatsTimer = null;

  function kickControls() {
    if (viewerEnded) return;
    ctrlBar.classList.remove("idle");
    if (ctrlTimer) clearTimeout(ctrlTimer);
    if (!video.srcObject) return;
    ctrlTimer = setTimeout(() => ctrlBar.classList.add("idle"), 3000);
  }

  function startViewerStats() {
    if (viewerStatsTimer) clearInterval(viewerStatsTimer);
    viewerStatsTimer = setInterval(async () => {
      if (!viewerPC || viewerEnded) return;
      try {
        const stats = await viewerPC.getStats();
        let inbound = null;
        for (const s of stats.values()) {
          if (s.type === "inbound-rtp" && s.kind === "video") { inbound = s; break; }
        }
        if (inbound) {
          const fps = inbound.framesPerSecond || 0;
          const w = inbound.frameWidth || 0;
          const h = inbound.frameHeight || 0;
          const loss = inbound.packetsLost || 0;
          const jitter = (inbound.jitter || 0) * 1000;
          let color = "#00ff66";
          if (jitter > 50 || loss > 100) color = "#ff3333";
          else if (jitter > 20 || loss > 20) color = "#ff9900";
          if (w && h) {
            vStatus.textContent = `${w}x${h} ${fps}fps`;
            vStatus.classList.remove("hidden");
            vStatus.style.color = color;
          }
        }
      } catch (e) {}
    }, 2000);
  }

  function stopViewerStats() {
    if (viewerStatsTimer) { clearInterval(viewerStatsTimer); viewerStatsTimer = null; }
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
      endViewer("desconectado.");
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
      endViewer("falha na conexão.");
      return;
    }
    vStatus.textContent = msg;
    if (ctrlTimer) clearTimeout(ctrlTimer);
    ctrlBar.classList.remove("idle");
    closeViewerWS();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const jitter = Math.random() * 1000;
    const delay = Math.min(backoffDelay * Math.pow(1.5, attempts - 1) + jitter, 30000);
    vStatus.textContent = `${msg} (${Math.round(delay / 1000)}s)`;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectViewer();
    }, delay);
  }

  function connectViewer() {
    closeViewerWS();
    errorFired = false;

    try {
      viewerWS = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect("erro de conexão.");
      return;
    }

    viewerWS.onopen = () => send(viewerWS, { type: "join", role: "viewer", joinId });

    viewerWS.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "joined":
          vStatus.textContent = "conectando...";
          backoffDelay = 2500;
          attempts = 0;
          viewerPC = makePC();
          try {
            viewerPC.addTransceiver("video", { direction: "recvonly" });
          } catch (err) {}
          viewerPC.onconnectionstatechange = () => {
            if (!viewerPC || viewerEnded) return;
            const st = viewerPC.connectionState;
            if (st === "failed" || st === "disconnected") {
              vStatus.classList.remove("hidden");
              vStatus.textContent = "sem conexão.";
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
              startViewerStats();
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
            vStatus.textContent = "erro: " + err.message;
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
          endViewer("transmissão encerrada.");
          break;

        case "broadcast-start":
          if (msg.startTime) {
            shareStartTime = msg.startTime;
            updateTimerEls();
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimerEls, 1000);
          }
          break;

        case "error":
          scheduleReconnect("aguardando transmissor...");
          break;
      }
    };

    viewerWS.onerror = () => {
      errorFired = true;
      scheduleReconnect("erro de conexão.");
    };

    viewerWS.onclose = () => {
      if (!errorFired && !viewerEnded) scheduleReconnect("conexão perdida.");
    };
  }

  function endViewer(msg) {
    if (viewerEnded) return;
    viewerEnded = true;
    stopViewerStats();
    resetTimer();
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
