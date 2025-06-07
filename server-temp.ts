import { createServer } from "node:http";
import { Server } from "socket.io";
import { auth } from "./auth";
import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

const app = express();
const httpServer = createServer(app);

// // app.all("/api/auth/*", toNodeHandler(auth)); // For ExpressJS v4
// app.all("/api/auth/*splat", toNodeHandler(auth)); //For ExpressJS v5

// // Mount express json middleware after Better Auth handler
// // or only apply it to routes that don't interact with Better Auth
// app.use(express.json());

app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  res.json(session);
});

const io = new Server(httpServer, {
  cors: {
    origin: true, // Allow all origins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  path: "/",
});
io.on("connection", (socket) => {
  console.log("a user connected");
  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

// Use the auth middleware for socket.io connections
io.use(async (socket, next) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(socket.handshake.headers),
    });

    if (!session?.user) {
      return next(new Error("Authentication required"));
    }

    socket.userId = session.user.id;
    next();
  } catch (error) {
    next(new Error("Authentication failed"));
  }
});

httpServer.listen(3001, () => {
  if (!httpServer.listening) {
    console.error("Server failed to start:");
    process.exit(1);
  }
  console.log("Server running on port 3001");
});
