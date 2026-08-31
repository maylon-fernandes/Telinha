(function () {
  "use strict";

  /* ===== CONFIG ===== */

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ];

  const PEER_CONFIG = { config: { iceServers: ICE_SERVERS } };

  /* ===== QUALITY PROFILES ===== */

  const QUALITY_PROFILES = {
    "1080p60": { maxBitrate: 8000000, maxFps: 60, scale: 1.0, label: "1080p 60fps" },
    "1080p30": { maxBitrate: 6000000, maxFps: 30, scale: 1.0, label: "1080p 30fps" },
    "720p60":  { maxBitrate: 4500000, maxFps: 60, scale: 1.5, label: "720p 60fps" },
    "720p30":  { maxBitrate: 2500000, maxFps: 30, scale: 1.5, label: "720p 30fps" },
  };

  const ADAPTIVE_ORDER = ["1080p60", "1080p30", "720p60", "720p30"];

  /* ===== DOM ===== */

  const $ = (id) => document.getElementById(id);

  const screens = {
    home: $("screen-home"),
    quality: $("screen-quality"),
    source: $("screen-source"),
    broadcast: $("screen-broadcast"),
    join: $("screen-join"),
    viewer: $("screen-viewer"),
  };

  const els = {
    btnTransmit: $("btn-transmit"),
    btnWatch: $("btn-watch"),
    btnQualityConfirm: $("btn-quality-confirm"),
    btnQualityBack: $("btn-quality-back"),
    sourceList: $("source-list"),
    chkAudio: $("chk-audio"),
    btnStartShare: $("btn-start-share"),
    btnSourceBack: $("btn-source-back"),
    broadcastCode: $("broadcast-code"),
    broadcastTimer: $("broadcast-timer"),
    broadcastStats: $("broadcast-stats"),
    broadcastQualityBadge: $("broadcast-quality-badge"),
    btnStopShare: $("btn-stop-share"),
    joinCodeInput: $("join-code-input"),
    joinStatus: $("join-status"),
    btnJoinConnect: $("btn-join-connect"),
    btnJoinBack: $("btn-join-back"),
    viewerVideo: $("viewer-video"),
    viewerBadge: $("viewer-badge"),
    viewerBadgeTimer: $("viewer-badge-timer"),
    viewerQualityBadge: $("viewer-quality-badge"),
    viewerStatus: $("viewer-status"),
    viewerControls: $("viewer-controls"),
    btnVolume: $("btn-volume"),
    volumeSlider: $("volume-slider"),
    btnFullscreen: $("btn-fullscreen"),
    btnLeave: $("btn-leave"),
  };

  /* ===== STATE ===== */

  let displayStream = null;
  let viewerCalls = new Map();
  let broadcastPeer = null;
  let viewerPeer = null;
  let viewerCall = null;
  let selectedSourceId = null;
  let broadcastStartTime = 0;
  let timerInterval = null;
  let statsTimer = null;
  let ctrlTimer = null;
  let viewerStatsTimer = null;
  let viewerEnded = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let backoffDelay = 2500;
  let viewerCount = 0;

  let qualitySettings = { resolution: "1080", fps: "30" };
  let currentQualityKey = "1080p30";
  let qualityHistory = [];

  /* ===== NAVIGATION ===== */

  function showScreen(name) {
    const wasHome = screens.home.classList.contains("active");

    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle("active", key === name);
    }

    if (window.asciiBg) {
      if (name === "home") {
        window.asciiBg.start();
        gsap.to(window.asciiBg.canvas, { opacity: 1, duration: 0.5, ease: "power2.out" });
      } else if (wasHome) {
        gsap.to(window.asciiBg.canvas, {
          opacity: 0,
          duration: 0.4,
          ease: "power2.in",
          onComplete: () => window.asciiBg.stop(),
        });
      }
    }

    const panel = screens[name].querySelector(".center-panel, .broadcast-layout, .viewer-wrapper");
    if (panel) {
      gsap.fromTo(panel, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
    }
  }

  /* ===== UTILS ===== */

  function generateCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function startTimer() {
    broadcastStartTime = Date.now();
    timerInterval = setInterval(() => {
      els.broadcastTimer.textContent = fmtTime(Date.now() - broadcastStartTime);
    }, 1000);
  }

  function resetTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    broadcastStartTime = 0;
    els.broadcastTimer.textContent = "00:00";
  }

  function showJoinError(msg) {
    els.joinStatus.textContent = msg;
    els.joinStatus.className = "status-msg error";
  }

  function showJoinInfo(msg) {
    els.joinStatus.textContent = msg;
    els.joinStatus.className = "status-msg info";
  }

  function hideJoinStatus() {
    els.joinStatus.className = "status-msg hidden";
  }

  /* ===== VIEWER STATS ===== */

  function startViewerStats() {
    if (viewerStatsTimer) clearInterval(viewerStatsTimer);
    viewerStatsTimer = setInterval(() => {
      const pc = viewerCall ? viewerCall.peerConnection : null;
      if (!pc || viewerEnded) return;
      pc.getStats().then((stats) => {
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

          let quality = "q-good";
          let label = "Boa";
          if (jitter > 50 || loss > 100) { quality = "q-terrible"; label = "Ruim"; }
          else if (jitter > 20 || loss > 30) { quality = "q-bad"; label = "Instável"; }
          else if (jitter > 8 || loss > 10) { quality = "q-ok"; label = "OK"; }

          els.viewerQualityBadge.className = "quality-badge viewer-quality-badge " + quality;
          els.viewerQualityBadge.textContent = w && h ? `${w}x${h} ${fps}fps - ${label}` : label;

          if (w && h) {
            els.viewerStatus.classList.remove("hidden");
            els.viewerStatus.textContent = `${w}x${h} ${fps}fps`;
          }
        }
      }).catch(() => {});
    }, 2000);
  }

  function stopViewerStats() {
    if (viewerStatsTimer) { clearInterval(viewerStatsTimer); viewerStatsTimer = null; }
  }

  /* ===== ADAPTIVE QUALITY ===== */

  function getProfileKey() {
    return qualitySettings.resolution + "p" + qualitySettings.fps;
  }

  function setQualityBadge(profileKey, badgeEl) {
    const profile = QUALITY_PROFILES[profileKey];
    if (!profile) return;
    badgeEl.textContent = profile.label;
  }

  function adaptQuality(stats) {
    const currentIdx = ADAPTIVE_ORDER.indexOf(currentQualityKey);
    if (currentIdx === -1) return;

    const { rtt, packetsLost } = stats;
    let targetIdx = currentIdx;

    if (rtt > 0.30 || packetsLost > 150) {
      targetIdx = Math.max(0, currentIdx - 2);
    } else if (rtt > 0.15 || packetsLost > 40) {
      targetIdx = Math.max(0, currentIdx - 1);
    } else if (rtt < 0.05 && packetsLost < 5 && currentIdx < ADAPTIVE_ORDER.length - 1) {
      targetIdx = Math.min(ADAPTIVE_ORDER.length - 1, currentIdx + 1);
    }

    if (targetIdx !== currentIdx) {
      const to = ADAPTIVE_ORDER[targetIdx];
      qualityHistory.push({ from: currentQualityKey, to, time: Date.now() });
      if (qualityHistory.length > 30) qualityHistory.shift();
      currentQualityKey = to;
      applyQualityToAll();
      setQualityBadge(to, els.broadcastQualityBadge);
    }
  }

  function applyEncodingParams(pc) {
    const profile = QUALITY_PROFILES[currentQualityKey];
    if (!profile) return;
    for (const s of pc.getSenders()) {
      if (s.track && s.track.kind === "video") {
        const p = s.getParameters();
        if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
        p.encodings[0].maxBitrate = profile.maxBitrate;
        p.encodings[0].maxFramerate = profile.maxFps;
        p.encodings[0].scaleResolutionDownBy = profile.scale;
        p.encodings[0].networkPriority = "high";
        p.encodings[0].priority = "high";
        p.degradationPreference = "maintain-framerate";
        s.setParameters(p).catch(() => {});
      }
    }
  }

  function applyQualityToAll() {
    for (const call of viewerCalls.values()) {
      if (call.peerConnection) applyEncodingParams(call.peerConnection);
    }
  }

  /* ===== SCREEN SOURCES ===== */

  async function loadSources() {
    const sources = await window.electronAPI.getDesktopSources();
    els.sourceList.innerHTML = "";

    const screenSources = sources.filter((s) => s.display_id !== "" || s.name.toLowerCase().includes("screen"));
    const windowSources = sources.filter((s) => s.display_id === "" && !s.name.toLowerCase().includes("screen"));
    const allItems = [...screenSources, ...windowSources];

    for (const source of allItems) {
      const item = document.createElement("div");
      item.className = "source-item";
      item.dataset.id = source.id;

      const type = source.display_id !== "" ? "Tela" : "Janela";
      item.innerHTML = `
        <img class="source-thumb" src="${source.thumbnail}" alt="" />
        <div>
          <div class="source-name">${source.name}</div>
          <div class="source-type">${type}</div>
        </div>
      `;

      item.addEventListener("click", () => {
        document.querySelectorAll(".source-item").forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");
        selectedSourceId = source.id;
        els.btnStartShare.disabled = false;
      });

      els.sourceList.appendChild(item);
    }
  }

  /* ===== BROADCAST ===== */

  async function startBroadcast() {
    if (!selectedSourceId) return;

    const audioEnabled = els.chkAudio.checked;

    try {
      const profile = QUALITY_PROFILES[getProfileKey()];
      const constraints = {
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSourceId,
            maxFrameRate: profile.maxFps,
          },
        },
        audio: audioEnabled
          ? {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: selectedSourceId,
              },
            }
          : false,
      };

      displayStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (!audioEnabled) {
        displayStream.getAudioTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      console.error("Erro ao capturar tela:", err);
      alert("Falha ao capturar tela. Verifique as permissões do sistema.");
      return;
    }

    currentQualityKey = getProfileKey();
    qualityHistory = [];
    viewerCount = 0;

    const code = generateCode();

    broadcastPeer = new Peer(code, PEER_CONFIG);

    broadcastPeer.on("open", () => {
      els.broadcastCode.textContent = code;
      $("broadcast-video").srcObject = displayStream;
      setQualityBadge(currentQualityKey, els.broadcastQualityBadge);
      showScreen("broadcast");
      startTimer();
      startBroadcastStats();
    });

    broadcastPeer.on("call", (call) => {
      call.answer(displayStream);
      viewerCalls.set(call.peer, call);
      viewerCount++;
      updateViewerCount();

      call.on("close", () => {
        viewerCalls.delete(call.peer);
        viewerCount = Math.max(0, viewerCount - 1);
        updateViewerCount();
      });

      call.on("error", () => {
        viewerCalls.delete(call.peer);
        viewerCount = Math.max(0, viewerCount - 1);
        updateViewerCount();
      });

      setTimeout(() => {
        if (call.peerConnection) applyEncodingParams(call.peerConnection);
      }, 1000);
    });

    broadcastPeer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        const newCode = generateCode();
        broadcastPeer.destroy();
        broadcastPeer = new Peer(newCode, PEER_CONFIG);
        broadcastPeer.on("open", () => {
          els.broadcastCode.textContent = newCode;
        });
      }
    });

    displayStream.getTracks().forEach((t) => {
      t.addEventListener("ended", () => stopBroadcast());
    });
  }

  function updateViewerCount() {
    if (viewerCount > 0) {
      els.broadcastStats.textContent =
        viewerCount + (viewerCount === 1 ? " viewer conectado" : " viewers conectados");
    }
  }

  function startBroadcastStats() {
    statsTimer = setInterval(async () => {
      const firstCall = [...viewerCalls.values()][0];
      if (!firstCall || !firstCall.peerConnection) {
        if (viewerCount === 0) els.broadcastStats.textContent = "aguardando viewers...";
        return;
      }
      try {
        const stats = await firstCall.peerConnection.getStats();
        let outbound = null;
        let remoteInbound = null;

        for (const s of stats.values()) {
          if (s.type === "outbound-rtp" && s.kind === "video") outbound = s;
          if (s.type === "remote-inbound-rtp" && s.kind === "video") remoteInbound = s;
        }

        if (outbound) {
          const resolution = `${outbound.frameWidth || "?"}x${outbound.frameHeight || "?"}`;
          const fps = outbound.framesPerSecond || 0;

          const qualityStats = {
            rtt: remoteInbound ? remoteInbound.roundTripTime || 0 : 0,
            packetsLost: outbound.packetsLost || 0,
          };

          adaptQuality(qualityStats);

          let qualityColor = "var(--green)";
          if (qualityStats.rtt > 0.30 || qualityStats.packetsLost > 150) qualityColor = "var(--red)";
          else if (qualityStats.rtt > 0.15 || qualityStats.packetsLost > 40) qualityColor = "#ff9900";
          else if (qualityStats.rtt > 0.05 || qualityStats.packetsLost > 10) qualityColor = "var(--blue)";

          els.broadcastStats.innerHTML =
            `${resolution} @ ${fps}fps <span style="color:${qualityColor}">${viewerCount > 0 ? viewerCount + " viewer" + (viewerCount > 1 ? "s" : "") + " | " : ""}${QUALITY_PROFILES[currentQualityKey]?.label || currentQualityKey}</span>`;
        }
      } catch (e) {}
    }, 2000);
  }

  function stopDisplayStream() {
    if (displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
      displayStream = null;
    }
  }

  function stopBroadcast() {
    stopDisplayStream();
    for (const call of viewerCalls.values()) {
      try { call.close(); } catch (e) {}
    }
    viewerCalls.clear();
    viewerCount = 0;
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    resetTimer();
    if (broadcastPeer) { broadcastPeer.destroy(); broadcastPeer = null; }
    $("broadcast-video").srcObject = null;
    els.broadcastCode.textContent = "----";
    els.broadcastStats.textContent = "";
    showScreen("home");
  }

  /* ===== VIEWER ===== */

  function connectAsViewer() {
    const code = els.joinCodeInput.value.trim();
    if (code.length !== 4 || !/^\d{4}$/.test(code)) {
      showJoinError("Digite um código de 4 dígitos.");
      return;
    }

    viewerEnded = false;
    reconnectAttempts = 0;
    backoffDelay = 2500;

    showJoinInfo("Conectando...");

    viewerPeer = new Peer(undefined, PEER_CONFIG);

    viewerPeer.on("open", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 2, 2);
      const dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0];

      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const silentSource = audioCtx.createBufferSource();
      const buffer = audioCtx.createBuffer(1, 1, 44100);
      silentSource.buffer = buffer;
      silentSource.loop = true;
      silentSource.connect(dest);
      silentSource.start();
      const dummyAudioTrack = dest.stream.getAudioTracks()[0];

      const dummyStream = new MediaStream([dummyVideoTrack, dummyAudioTrack]);

      const call = viewerPeer.call(code, dummyStream);

      if (!call) {
        showJoinError("Código inválido ou transmissão não encontrada.");
        viewerPeer.destroy();
        viewerPeer = null;
        dummyVideoTrack.stop();
        dummyAudioTrack.stop();
        audioCtx.close();
        return;
      }

      viewerCall = call;

      call.on("stream", (stream) => {
        els.viewerVideo.srcObject = stream;
        els.viewerVideo.volume = els.volumeSlider.value / 100;
        els.viewerVideo.play().catch(() => {});
        showScreen("viewer");
        els.viewerBadge.classList.remove("hidden");
        els.viewerControls.classList.remove("idle");
        startViewerStats();
      });

      call.on("close", () => {
        if (!viewerEnded) scheduleReconnect("Transmissão encerrada.");
      });

      call.on("error", (err) => {
        console.error("Viewer call error:", err);
        if (!viewerEnded) scheduleReconnect("Erro de conexão.");
      });
    });

    viewerPeer.on("disconnected", () => {
      if (!viewerEnded) scheduleReconnect("Conexão perdida.");
    });

    viewerPeer.on("close", () => {
      if (!viewerEnded) scheduleReconnect("Conexão encerrada.");
    });

    viewerPeer.on("error", (err) => {
      console.error("Viewer peer error:", err);
      if (err.type === "unavailable-id" || err.type === "peer-unavailable") {
        showJoinError("Código inválido ou transmissão não encontrada.");
        if (viewerPeer) { viewerPeer.destroy(); viewerPeer = null; }
      } else if (!viewerEnded) {
        scheduleReconnect("Erro de conexão.");
      }
    });
  }

  function scheduleReconnect(msg) {
    if (viewerEnded) return;
    reconnectAttempts++;
    if (reconnectAttempts > 30) {
      endViewer("Falha na conexão.");
      return;
    }
    els.viewerStatus.classList.remove("hidden");
    els.viewerStatus.innerHTML = `<span class="spinner"></span> ${msg}`;
    els.viewerControls.classList.add("idle");

    if (viewerPeer) { viewerPeer.destroy(); viewerPeer = null; }
    viewerCall = null;

    if (reconnectTimer) clearTimeout(reconnectTimer);

    const jitter = Math.random() * 1000;
    const delay = Math.min(backoffDelay * Math.pow(1.5, reconnectAttempts - 1) + jitter, 30000);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectAsViewer();
    }, delay);
  }

  function endViewer(msg) {
    if (viewerEnded) return;
    viewerEnded = true;
    stopViewerStats();
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ctrlTimer) { clearTimeout(ctrlTimer); ctrlTimer = null; }

    els.viewerControls.classList.remove("idle");

    if (viewerCall) { try { viewerCall.close(); } catch (e) {} viewerCall = null; }
    if (viewerPeer) { viewerPeer.destroy(); viewerPeer = null; }

    els.viewerStatus.classList.remove("hidden");
    els.viewerStatus.textContent = msg;
    els.viewerBadge.classList.add("hidden");
    els.viewerQualityBadge.className = "quality-badge viewer-quality-badge hidden";
  }

  function leaveViewer() {
    endViewer("Desconectado.");
    showScreen("home");
  }

  /* ===== VIEWER CONTROLS ===== */

  function updateVolumeIcon() {
    const v = els.viewerVideo.volume;
    const muted = els.viewerVideo.muted;
    if (muted || v === 0) {
      els.btnVolume.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
    } else {
      els.btnVolume.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    }
  }

  function kickControls() {
    if (viewerEnded) return;
    els.viewerControls.classList.remove("idle");
    if (ctrlTimer) clearTimeout(ctrlTimer);
    if (!els.viewerVideo.srcObject) return;
    ctrlTimer = setTimeout(() => els.viewerControls.classList.add("idle"), 3000);
  }

  /* ===== EVENTS ===== */

  document.querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const value = btn.dataset.value;
      qualitySettings[key] = value;
      document.querySelectorAll(`.option[data-key="${key}"]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  els.btnTransmit.addEventListener("click", () => {
    showScreen("quality");
  });

  els.btnQualityConfirm.addEventListener("click", () => {
    showScreen("source");
    loadSources();
  });

  els.btnQualityBack.addEventListener("click", () => {
    showScreen("home");
  });

  els.btnWatch.addEventListener("click", () => {
    showScreen("join");
    els.joinCodeInput.value = "";
    hideJoinStatus();
    els.btnJoinConnect.disabled = true;
    els.joinCodeInput.focus();
  });

  els.btnSourceBack.addEventListener("click", () => {
    selectedSourceId = null;
    els.btnStartShare.disabled = true;
    showScreen("quality");
  });

  els.btnStartShare.addEventListener("click", () => {
    startBroadcast();
  });

  els.btnStopShare.addEventListener("click", () => {
    stopBroadcast();
  });

  els.joinCodeInput.addEventListener("input", () => {
    els.joinCodeInput.value = els.joinCodeInput.value.replace(/\D/g, "").slice(0, 4);
    els.btnJoinConnect.disabled = els.joinCodeInput.value.length !== 4;
    hideJoinStatus();
  });

  els.joinCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && els.joinCodeInput.value.length === 4) {
      connectAsViewer();
    }
  });

  els.btnJoinConnect.addEventListener("click", () => {
    connectAsViewer();
  });

  els.btnJoinBack.addEventListener("click", () => {
    showScreen("home");
    if (viewerPeer) { viewerPeer.destroy(); viewerPeer = null; }
  });

  els.btnLeave.addEventListener("click", () => {
    leaveViewer();
  });

  els.btnVolume.addEventListener("click", () => {
    els.viewerVideo.muted = !els.viewerVideo.muted;
    updateVolumeIcon();
    kickControls();
  });

  els.volumeSlider.addEventListener("input", () => {
    const level = els.volumeSlider.value / 100;
    els.viewerVideo.volume = level;
    if (level > 0 && els.viewerVideo.muted) {
      els.viewerVideo.muted = false;
      els.viewerVideo.play().catch(() => {});
    }
    els.volumeSlider.style.setProperty("--v", els.volumeSlider.value + "%");
    updateVolumeIcon();
    kickControls();
  });

  els.btnFullscreen.addEventListener("click", () => {
    const wrapper = document.querySelector(".viewer-wrapper");
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapper.requestFullscreen().catch(() => {});
  });

  document.querySelector(".viewer-wrapper").addEventListener("mousemove", kickControls);
  document.querySelector(".viewer-wrapper").addEventListener("click", kickControls);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (screens.viewer.classList.contains("active")) {
        kickControls();
      }
    }
  });

  /* ===== INIT ===== */

  $("btn-minimize").addEventListener("click", () => window.electronAPI.winMinimize());
  $("btn-maximize").addEventListener("click", () => window.electronAPI.winMaximize());
  $("btn-close").addEventListener("click", () => window.electronAPI.winClose());

  function init() {
    showScreen("home");
    listenForUpdates();

    const splash = document.getElementById("splash");
    if (splash) {
      gsap.to(splash, {
        opacity: 0,
        duration: 0.6,
        delay: 0.2,
        ease: "power2.inOut",
        onComplete: () => splash.remove(),
      });
    }
  }

  function listenForUpdates() {
    const indicator = $("update-indicator");
    const updateText = $("update-text");
    const updateBtn = $("btn-update");

    if (!window.electronAPI?.onUpdateStatus) return;

    window.electronAPI.onUpdateStatus((event, status, data) => {
      indicator.classList.remove("hidden");
      updateBtn.classList.add("hidden");

      if (status === "available") {
        updateText.textContent = `Versão ${data} disponível — baixando...`;
      } else if (status === "downloading") {
        updateText.textContent = `Baixando update... ${data}%`;
      } else if (status === "downloaded") {
        updateText.textContent = "Update pronto!";
        updateBtn.classList.remove("hidden");
        updateBtn.textContent = "REINICIAR";
        updateBtn.onclick = () => window.electronAPI.installUpdate();
      }
    });
  }

  init();
})();
