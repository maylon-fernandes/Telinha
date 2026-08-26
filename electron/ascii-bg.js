(function () {
  "use strict";

  const canvas = document.getElementById("ascii-bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const CHARS = "01アイウエオカキクケコサシスセソ";
  const FONT_SIZE = 12;
  let columns = [];
  let running = false;
  let animId = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initColumns();
  }

  function initColumns() {
    const count = Math.ceil(canvas.width / FONT_SIZE);
    columns = [];
    for (let i = 0; i < count; i++) {
      const len = 4 + Math.floor(Math.random() * 12);
      const chars = [];
      for (let j = 0; j < len; j++) {
        chars.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
      }
      columns.push({
        x: i * FONT_SIZE,
        y: Math.random() * canvas.height,
        speed: 0.15 + Math.random() * 0.5,
        chars: chars,
      });
    }
  }

  function draw() {
    ctx.fillStyle = "rgba(10, 10, 15, 0.12)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${FONT_SIZE}px "Consolas", "SF Mono", monospace`;
    ctx.textBaseline = "top";

    for (const col of columns) {
      const len = col.chars.length;
      for (let i = 0; i < len; i++) {
        const yPos = col.y - (len - i) * FONT_SIZE;
        if (yPos < -FONT_SIZE || yPos > canvas.height + FONT_SIZE) continue;

        const ratio = i / (len - 1);
        const brightness = 0.04 + 0.14 * (1 - ratio);
        const g = Math.floor(60 + 40 * (1 - ratio));
        ctx.fillStyle = `rgba(${g}, ${g}, ${g}, ${brightness})`;
        ctx.fillText(col.chars[i], col.x, yPos);
      }

      col.y += col.speed;

      if (col.y - col.chars.length * FONT_SIZE > canvas.height) {
        col.y = -FONT_SIZE;
        col.speed = 0.15 + Math.random() * 0.5;
        const newLen = 4 + Math.floor(Math.random() * 12);
        col.chars = [];
        for (let j = 0; j < newLen; j++) {
          col.chars.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
        }
      }

      if (Math.random() < 0.01) {
        const idx = Math.floor(Math.random() * col.chars.length);
        col.chars[idx] = CHARS[Math.floor(Math.random() * CHARS.length)];
      }
    }

    if (running) animId = requestAnimationFrame(draw);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    draw();
  }

  function stop() {
    running = false;
    if (animId) { cancelAnimationFrame(animId); animId = null; }
  }

  window.addEventListener("resize", () => { if (running) resize(); });
  window.asciiBg = { start, stop, canvas };

  start();
})();
