const { WebSocketServer } = require("ws");

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function createSignaling(server) {
  const wss = new WebSocketServer({ server });
  const sessions = new Map();
  let viewerSeq = 0;

  wss.on("connection", (ws) => {
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
          role = "broadcaster";
          const id =
            msg.id && !sessions.has(msg.id)
              ? msg.id
              : Math.random().toString(36).slice(2, 8);
          session = { id, ws, media: true, viewers: new Map() };
          sessions.set(id, session);
          send(ws, { type: "joined", id, role: "broadcaster" });
        } else if (msg.role === "viewer") {
          const sess = sessions.get(msg.joinId);
          if (!sess || sess.ws.readyState !== 1 || !sess.media) {
            send(ws, { type: "error", message: "not-found" });
            return;
          }
          role = "viewer";
          session = sess;
          ws.viewerId = "id" + (viewerSeq++).toString(36);
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