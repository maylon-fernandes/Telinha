const http = require("http");
const { createSignaling } = require("../lib/signaling");

const server = http.createServer();
createSignaling(server);

module.exports = server;