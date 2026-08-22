const express = require("express");
const http = require("http");
const path = require("path");
const { createSignaling } = require("./lib/signaling");

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.static(path.join(__dirname), { maxAge: 0 }));
app.get("/view", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

createSignaling(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Screen share rodando em http://localhost:${PORT}`);
});