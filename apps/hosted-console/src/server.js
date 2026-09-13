import { createHostedConsoleServer } from "./app.js";

const port = Number(process.env.PORT || 8787);
const server = createHostedConsoleServer();
server.listen(port, "127.0.0.1", () => {
  console.log(`WGW Relay hosted console listening on http://127.0.0.1:${port}`);
});
