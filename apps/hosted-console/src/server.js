import { createHostedConsoleServer } from "./app.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const server = createHostedConsoleServer();
server.listen(port, host, () => {
  console.log(`WGW Relay hosted console listening on http://${host}:${port}`);
});
