import http from "node:http";
import dotenv from "dotenv";
dotenv.config();

const port = process.env.PORT!;

const server = http.createServer((req, res) => {
  console.log(`Received request for ${req.url}`);
  console.log(server.connections);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello World!");
});

server.on("connection", () => {
  console.log("Server is Connected", server.address());
});

server.listen(port, () => {
  console.log(`Web server listening on port 3001`);
});
