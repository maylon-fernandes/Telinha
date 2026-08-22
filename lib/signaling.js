const { WebSocketServer } = require("ws");
const crypto = require("crypto");

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function generateSessionId() {
  return crypto.randomBytes(8).toString("base64url");
}

function createSignaling(server) {
  const wss = new WebSocketServer({ server });
  const sessions = new Map();
  let viewerSeq = 0;
  const MAX_VIEWERS_PER_SESSION = 50;
  const MAX_SESSIONS = 100;
  const ipConnections = new Map();

  function getIP(ws) {
    return ws._socket?.remoteAddress || "unknown";
  }

  function cleanupIP(ip) {
    const count = (ipConnections.get(ip) || 1) - 1;
    if (count <= 0) ipConnections.delete(ip);
    else ipConnections.set(ip, count);
  }

  wss.on("connection", (ws) => {
    const ip = getIP(ws);
    const connCount = ipConnections.get(ip) || 0;
    if (connCount >= 20) {
      send(ws, { type: "error", message: "rate-limit" });
      ws.close();
      return;
    }
    ipConnections.set(ip, connCount + 1);

    let role = null;
    let session = null;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === "join") {
        if (msg.role === "broadcaster") {
          if (sessions.size >= MAX_SESSIONS) {
            send(ws, { type: "error", message: "server-full" });
            return;
          }
          role = "broadcaster";
          const id =
            msg.id && !sessions.has(msg.id)
              ? msg.id
              : generateSessionId();
          session = { id, ws, media: true, viewers: new Map() };
          sessions.set(id, session);
          send(ws, { type: "joined", id, role: "broadcaster" });
        } else if (msg.role === "viewer") {
          const sess = sessions.get(msg.joinId);
          if (!sess || sess.ws.readyState !== 1 || !sess.media) {
            send(ws, { type: "error", message: "not-found" });
            return;
          }
          if (sess.viewers.size >= MAX_VIEWERS_PER_SESSION) {
            send(ws, { type: "error", message: "session-full" });
            return;
          }
          role = "viewer";
          session = sess;
          ws.viewerId = "v" + (viewerSeq++).toString(36);
          sess.viewers.set(ws.viewerId, ws);
          send(ws, { type: "joined", id: ws.viewerId, role: "viewer" });
          send(sess.ws, { type: "viewer-arrived", viewerId: ws.viewerId });
          send(sess.ws, { type: "viewer-count", count: sess.viewers.size });
        }
        return;
      }

      if (msg.type === "share-ready" && role === "broadcaster") {
        session.media = true;
        return;
      }

      if (role === "broadcaster") {
        const vws = session.viewers.get(msg.viewerId);
        send(vws, { ...msg, viewerId: msg.viewerId });
      } else if (role === "viewer") {
        send(session.ws, { ...msg, viewerId: ws.viewerId });
      }
    });

    ws.on("close", () => {
      cleanupIP(ip);
      if (role === "broadcaster") {
        for (const vws of session.viewers.values()) send(vws, { type: "broadcaster-left" });
        sessions.delete(session.id);
      } else if (role === "viewer") {
        session.viewers.delete(ws.viewerId);
        send(session.ws, { type: "viewer-left", viewerId: ws.viewerId });
        send(session.ws, { type: "viewer-count", count: session.viewers.size });
      }
    });
  });

  return wss;
}

module.exports = { createSignaling };