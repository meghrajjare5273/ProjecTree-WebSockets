import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import cookie from "cookie";
import { auth } from "./auth"; // Import your Better Auth instance
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

// CORS configuration - allow multiple origins for development and production
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "https://localhost:3000",
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
  "http://localhost:3001",
].filter(Boolean);

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    console.log(`CORS check for origin: ${origin}`); // Keep this for debugging
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

app.use(cors(corsOptions));
// app.use(express.json());

// Better Auth routes - must be before other middleware
app.all("/api/auth/*splat", toNodeHandler(auth));

// Socket.io server with CORS
const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

// Store active users and their socket connections
const activeUsers = new Map<string, Set<string>>(); // userId -> Set of socketIds (multiple tabs support)
const userSockets = new Map<string, string>(); // socketId -> userId

// Interface for message data
interface MessageData {
  receiverId: string;
  content: string;
  type?: "text" | "image" | "file";
}

interface AuthenticatedSocket extends Socket {
  userId?: string;
  sessionId?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
}

// Enhanced session validation function using Better Auth
async function validateSessionFromHeaders(headers: any) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    if (!session?.user) {
      return null;
    }

    return {
      user: session.user,
      session: session.session,
    };
  } catch (error) {
    console.error("Session validation error:", error);
    return null;
  }
}

// Helper function to validate session from socket handshake
async function validateSocketSession(socket: any) {
  try {
    // Try to get session from cookie in handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    let headers: any = {};

    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    // Also check for authorization header or token in auth
    if (socket.handshake.auth.token) {
      headers.authorization = `Bearer ${socket.handshake.auth.token}`;
    }

    // If sessionId is provided in auth, treat it as a token
    if (socket.handshake.auth.sessionId) {
      headers.authorization = `Bearer ${socket.handshake.auth.sessionId}`;
    }

    const authResult = await validateSessionFromHeaders(headers);
    return authResult;
  } catch (error) {
    console.error("Socket session validation error:", error);
    return null;
  }
}

// Middleware to authenticate socket connections
io.use(async (socket: any, next) => {
  try {
    const authResult = await validateSocketSession(socket);

    if (!authResult) {
      console.log("Socket authentication failed - no valid session");
      return next(new Error("Invalid or expired session"));
    }

    socket.userId = authResult.user.id;
    socket.user = {
      id: authResult.user.id,
      name: authResult.user.name,
      email: authResult.user.email,
      image: authResult.user.image,
    };
    socket.sessionId = authResult.session?.id;

    console.log(
      `Socket authenticated for user: ${authResult.user.id} (socket: ${socket.id})`
    );
    next();
  } catch (error) {
    console.error("Socket authentication error:", error);
    next(new Error("Authentication failed"));
  }
});

// Socket connection handler
io.on("connection", (socket: AuthenticatedSocket) => {
  console.log(`User ${socket.userId} connected with socket ${socket.id}`);
  socket.emit("connection:success", { userId: socket.userId });

  // Store user connection (support multiple connections per user)
  if (socket.userId) {
    if (!activeUsers.has(socket.userId)) {
      activeUsers.set(socket.userId, new Set());
    }
    activeUsers.get(socket.userId)!.add(socket.id);
    userSockets.set(socket.id, socket.userId);

    // Notify user is online (only if first connection)
    if (activeUsers.get(socket.userId)!.size === 1) {
      socket.broadcast.emit("user:online", {
        userId: socket.userId,
        user: socket.user,
      });
    }

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);
  }

  // Handle sending private messages
  socket.on("message:send", async (data: MessageData, callback) => {
    try {
      if (!socket.userId) {
        const error = "Authentication required";
        socket.emit("error", error);
        if (callback) callback({ success: false, error });
        return;
      }

      const { receiverId, content, type = "text" } = data;

      // Basic validation
      if (!receiverId || !content.trim()) {
        const error = "Invalid message data";
        socket.emit("error", error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Validate receiver exists
      const receiver = await prisma.user.findUnique({
        where: { id: receiverId },
        select: { id: true, name: true, image: true },
      });

      if (!receiver) {
        const error = "Receiver not found";
        socket.emit("error", error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Create message in database
      const message = await prisma.message.create({
        data: {
          senderId: socket.userId,
          receiverId: receiverId,
          content: content.trim(),
          createdAt: new Date(),
        },
        include: {
          sender: {
            select: { id: true, name: true, image: true },
          },
          receiver: {
            select: { id: true, name: true, image: true },
          },
        },
      });

      // Send message to all receiver's connections
      const receiverSockets = activeUsers.get(receiverId);
      if (receiverSockets && receiverSockets.size > 0) {
        receiverSockets.forEach((socketId) => {
          io.to(socketId).emit("message:receive", message);
        });
      }

      // Send confirmation to sender
      socket.emit("message:sent", message);
      if (callback) callback({ success: true, message });

      console.log(`Message sent from ${socket.userId} to ${receiverId}`);
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMsg = "Failed to send message";
      socket.emit("error", errorMsg);
      if (callback) callback({ success: false, error: errorMsg });
    }
  });

  // Handle marking messages as read
  socket.on("message:read", async (data: { messageIds: string[] }) => {
    try {
      if (!socket.userId || !data.messageIds?.length) return;

      // Update messages as read
      const updatedMessages = await prisma.message.updateMany({
        where: {
          id: { in: data.messageIds },
          receiverId: socket.userId,
          read: false, // Only update unread messages
        },
        data: {
          read: true,
        },
      });

      if (updatedMessages.count === 0) return;

      // Get the updated messages to notify senders
      const messages = await prisma.message.findMany({
        where: {
          id: { in: data.messageIds },
          receiverId: socket.userId,
        },
        select: { id: true, senderId: true },
        distinct: ["senderId"],
      });

      // Notify each sender about read status
      messages.forEach((msg) => {
        const senderSockets = activeUsers.get(msg.senderId);
        if (senderSockets && senderSockets.size > 0) {
          senderSockets.forEach((socketId) => {
            io.to(socketId).emit("message:read", {
              messageIds: data.messageIds,
              readBy: socket.userId,
              readByUser: socket.user,
            });
          });
        }
      });

      console.log(
        `${updatedMessages.count} messages marked as read by ${socket.userId}`
      );
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  // Handle typing indicators
  socket.on("typing:start", (data: { receiverId: string }) => {
    if (!socket.userId || !data.receiverId) return;

    const receiverSockets = activeUsers.get(data.receiverId);
    if (receiverSockets && receiverSockets.size > 0) {
      receiverSockets.forEach((socketId) => {
        io.to(socketId).emit("typing:start", {
          userId: socket.userId,
          user: socket.user,
        });
      });
    }
  });

  socket.on("typing:stop", (data: { receiverId: string }) => {
    if (!socket.userId || !data.receiverId) return;

    const receiverSockets = activeUsers.get(data.receiverId);
    if (receiverSockets && receiverSockets.size > 0) {
      receiverSockets.forEach((socketId) => {
        io.to(socketId).emit("typing:stop", {
          userId: socket.userId,
        });
      });
    }
  });

  // Handle joining conversation rooms (optional - for future use)
  socket.on("conversation:join", async (data: { userId: string }) => {
    if (!socket.userId) return;

    const roomName = [socket.userId, data.userId].sort().join("-");
    socket.join(roomName);

    console.log(`User ${socket.userId} joined conversation room: ${roomName}`);
  });

  // Handle getting conversation history with pagination
  socket.on(
    "conversation:history",
    async (data: {
      userId: string;
      page?: number;
      limit?: number;
      before?: string; // ISO date string for cursor-based pagination
    }) => {
      try {
        if (!socket.userId) return;

        const page = data.page || 1;
        const limit = Math.min(data.limit || 50, 100); // Cap at 100 messages
        const offset = (page - 1) * limit;

        let whereClause: any = {
          OR: [
            { senderId: socket.userId, receiverId: data.userId },
            { senderId: data.userId, receiverId: socket.userId },
          ],
        };

        // Add cursor-based pagination if before timestamp is provided
        if (data.before) {
          whereClause.createdAt = {
            lt: new Date(data.before),
          };
        }

        const messages = await prisma.message.findMany({
          where: whereClause,
          include: {
            sender: {
              select: { id: true, name: true, image: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: data.before ? 0 : offset, // Don't use offset with cursor pagination
        });

        socket.emit("conversation:history", {
          messages: messages.reverse(), // Return in chronological order
          hasMore: messages.length === limit,
          page,
        });
      } catch (error) {
        console.error("Error fetching conversation history:", error);
        socket.emit("error", "Failed to fetch conversation history");
      }
    }
  );

  // Handle getting user's conversations list
  socket.on("conversations:list", async () => {
    try {
      if (!socket.userId) return;

      // Get latest message for each conversation
      const latestMessages = (await prisma.$queryRaw`
        SELECT DISTINCT ON (
          CASE 
            WHEN "senderId" = ${socket.userId} THEN "receiverId"
            ELSE "senderId"
          END
        )
        *,
        CASE 
          WHEN "senderId" = ${socket.userId} THEN "receiverId"
          ELSE "senderId"
        END as "otherUserId"
        FROM "message"
        WHERE "senderId" = ${socket.userId} OR "receiverId" = ${socket.userId}
        ORDER BY "otherUserId", "createdAt" DESC
      `) as any[];

      if (latestMessages.length === 0) {
        socket.emit("conversations:list", []);
        return;
      }

      // Get user details and unread counts
      const conversationPromises = latestMessages.map(async (msg) => {
        const otherUserId = msg.otherUserId;

        // Get other user details
        const otherUser = await prisma.user.findUnique({
          where: { id: otherUserId },
          select: { id: true, name: true, image: true },
        });

        if (!otherUser) return null;

        // Get unread count
        const unreadCount = await prisma.message.count({
          where: {
            senderId: otherUserId,
            receiverId: socket.userId,
            read: false,
          },
        });

        // Check if other user is online
        const isOnline = activeUsers.has(otherUserId);

        return {
          user: otherUser,
          lastMessage: {
            id: msg.id,
            content: msg.content,
            createdAt: msg.createdAt,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
          },
          unreadCount,
          isOnline,
        };
      });

      const conversations = (await Promise.all(conversationPromises))
        .filter(Boolean)
        .sort(
          (a, b) =>
            new Date(b!.lastMessage.createdAt).getTime() -
            new Date(a!.lastMessage.createdAt).getTime()
        );

      socket.emit("conversations:list", conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      socket.emit("error", "Failed to fetch conversations");
    }
  });

  // Handle getting online users list
  socket.on("users:online", () => {
    const onlineUsers = Array.from(activeUsers.keys()).map((userId) => ({
      userId,
      isOnline: true,
    }));
    socket.emit("users:online", onlineUsers);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User ${socket.userId} disconnected (socket: ${socket.id})`);

    if (socket.userId) {
      // Remove this socket from user's connections
      const userSocketSet = activeUsers.get(socket.userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);

        // If no more connections, mark user as offline
        if (userSocketSet.size === 0) {
          activeUsers.delete(socket.userId);
          socket.broadcast.emit("user:offline", {
            userId: socket.userId,
          });
        }
      }

      userSockets.delete(socket.id);
    }
  });
});

// REST API middleware for authentication using Better Auth
const authenticateRequest = async (req: any, res: any, next: any) => {
  try {
    const authResult = await validateSessionFromHeaders(req.headers);

    if (!authResult) {
      console.log("REST API authentication failed - no valid session");
      return res.status(401).json({ error: "Authentication required" });
    }

    req.user = authResult.user;
    req.session = authResult.session;
    console.log(`REST API authenticated for user: ${authResult.user.id}`);
    next();
  } catch (error) {
    console.error("Request authentication error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    activeConnections: activeUsers.size,
    totalSockets: userSockets.size,
  });
});

// Get current user session info
app.get("/api/me", async (req, res) => {
  const authResult = await validateSessionFromHeaders(req.headers);
  res.json(authResult);
});

// Get online users (protected route)
app.get("/api/users/online", authenticateRequest, (req, res) => {
  const onlineUserIds = Array.from(activeUsers.keys());
  res.json({
    onlineUsers: onlineUserIds,
    count: onlineUserIds.length,
  });
});

// Get user's conversations via REST API
app.get("/api/conversations", authenticateRequest, async (req, res) => {
  try {
    // Similar logic to socket event but via REST
    const userId = req.user.id;

    const latestMessages = (await prisma.$queryRaw`
      SELECT DISTINCT ON (
        CASE 
          WHEN "senderId" = ${userId} THEN "receiverId"
          ELSE "senderId"
        END
      )
      *,
      CASE 
        WHEN "senderId" = ${userId} THEN "receiverId"
        ELSE "senderId"
      END as "otherUserId"
      FROM "message"
      WHERE "senderId" = ${userId} OR "receiverId" = ${userId}
      ORDER BY "otherUserId", "createdAt" DESC
    `) as any[];

    const conversations = await Promise.all(
      latestMessages.map(async (msg) => {
        const otherUserId = msg.otherUserId;

        const otherUser = await prisma.user.findUnique({
          where: { id: otherUserId },
          select: { id: true, name: true, image: true },
        });

        if (!otherUser) return null;

        const unreadCount = await prisma.message.count({
          where: {
            senderId: otherUserId,
            receiverId: userId,
            read: false,
          },
        });

        return {
          user: otherUser,
          lastMessage: msg,
          unreadCount,
          isOnline: activeUsers.has(otherUserId),
        };
      })
    );

    res.json(conversations.filter(Boolean));
  } catch (error) {
    console.error("Error fetching conversations via REST:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Error handling middleware
app.use((error: any, req: any, res: any, next: any) => {
  console.error("Server error:", error);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`Allowed origins:`, allowedOrigins);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log("Shutting down gracefully...");

  // Close all socket connections
  io.emit("server:shutdown", { message: "Server is shutting down" });

  // Close HTTP server
  httpServer.close(async () => {
    console.log("HTTP server closed");

    // Disconnect Prisma
    await prisma.$disconnect();
    console.log("Database connection closed");

    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.log("Forcing shutdown...");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});
