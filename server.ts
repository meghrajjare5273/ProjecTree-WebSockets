import { createServer } from "node:http";
import { Server } from "socket.io";
import { auth } from "./auth";
import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import cors from "cors";
import { Socket } from "socket.io";

// Extend the Socket interface to include custom properties
declare module "socket.io" {
  interface Socket {
    userId?: string;
    userEmail?: string;
  }
}

// Initialize clients
console.log("🚀 Initializing server components...");

let prisma: PrismaClient;
let redis: Redis;

try {
  console.log("💾 Connecting to database...");
  prisma = new PrismaClient();

  console.log("🔴 Connecting to Redis...");
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  // Test Redis connection
  redis.on("connect", () => {
    console.log("✅ Redis connected successfully");
  });

  redis.on("error", (err) => {
    console.error("❌ Redis connection error:", err);
  });

  // Test database connection
  prisma
    .$connect()
    .then(() => console.log("✅ Database connected successfully"))
    .catch((err) => console.error("❌ Database connection error:", err));
} catch (error) {
  console.error("❌ Failed to initialize clients:", error);
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);

// CORS middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Better Auth handler
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

// Session endpoint
app.get("/api/me", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: "Failed to get session" });
  }
});

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  path: "/socket.io/",
});

// Store user socket mappings in Redis
const USER_SOCKET_KEY = "user_sockets";
const ROOM_PREFIX = "room:";
const TYPING_PREFIX = "typing:";

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  try {
    console.log("🔐 Authenticating socket connection...");
    console.log("Headers:", JSON.stringify(socket.handshake.headers, null, 2));

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(socket.handshake.headers),
    });

    console.log("📋 Session data:", JSON.stringify(session, null, 2));

    if (!session?.user) {
      console.error("❌ Authentication failed: No user session found");
      return next(new Error("Authentication required"));
    }

    socket.userId = session.user.id;
    socket.userEmail = session.user.email;
    console.log(
      `✅ User authenticated: ${session.user.id} (${session.user.email})`
    );
    next();
  } catch (error) {
    console.error("❌ Authentication middleware error:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    next(
      new Error(
        `Authentication failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      )
    );
  }
});

// Helper functions
const getRoomId = (userId1: string, userId2: string): string => {
  return [userId1, userId2].sort().join(":");
};

const saveMessageToRedis = async (message: any) => {
  const roomId = getRoomId(message.senderId, message.receiverId);
  await redis.lpush(`${ROOM_PREFIX}${roomId}`, JSON.stringify(message));
  // Keep only last 100 messages in Redis for quick access
  await redis.ltrim(`${ROOM_PREFIX}${roomId}`, 0, 99);
};

const getRecentMessagesFromRedis = async (userId1: string, userId2: string) => {
  const roomId = getRoomId(userId1, userId2);
  const messages = await redis.lrange(`${ROOM_PREFIX}${roomId}`, 0, 49);
  return messages.map((msg) => JSON.parse(msg)).reverse();
};

const saveMessageToDatabase = async (messageData: {
  content: string;
  senderId: string;
  receiverId: string;
}) => {
  try {
    console.log(`💾 Attempting to save message to database:`, {
      senderId: messageData.senderId,
      receiverId: messageData.receiverId,
      contentLength: messageData.content.length,
    });

    const message = await prisma.message.create({
      data: messageData,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          },
        },
      },
    });

    console.log(`✅ Message saved successfully with ID: ${message.id}`);
    return message;
  } catch (error) {
    console.error("❌ Failed to save message to database:", error);
    console.error("Database error details:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : "No stack trace",
      messageData,
    });
    throw error;
  }
};

const markMessagesAsRead = async (senderId: string, receiverId: string) => {
  try {
    await prisma.message.updateMany({
      where: {
        senderId,
        receiverId,
        read: false,
      },
      data: {
        read: true,
      },
    });
  } catch (error) {
    console.error("Failed to mark messages as read:", error);
  }
};

const getUnreadCount = async (userId: string) => {
  try {
    return await prisma.message.count({
      where: {
        receiverId: userId,
        read: false,
      },
    });
  } catch (error) {
    console.error("Failed to get unread count:", error);
    return 0;
  }
};

// Socket.IO connection handling
io.on("connection", async (socket) => {
  try {
    console.log(`🔌 User ${socket.userId} connected successfully`);

    // Store user socket mapping
    console.log(`💾 Storing socket mapping for user ${socket.userId}`);
    await redis.hset(USER_SOCKET_KEY, socket.userId!, socket.id);

    // Join user to their personal room for notifications
    socket.join(`user:${socket.userId}`);
    console.log(`🏠 User ${socket.userId} joined personal room`);

    // Send unread message count
    const unreadCount = await getUnreadCount(socket.userId!);
    socket.emit("unread_count", unreadCount);
    console.log(
      `📧 Sent unread count (${unreadCount}) to user ${socket.userId}`
    );
  } catch (error) {
    console.error(
      `❌ Error during connection setup for user ${socket.userId}:`,
      error
    );
    console.error(
      "Connection error stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
  }

  // Handle joining a chat room
  socket.on("join_chat", async (data: { otherUserId: string }) => {
    try {
      console.log(
        `👥 User ${socket.userId} joining chat with ${data.otherUserId}`
      );
      const { otherUserId } = data;
      const roomId = getRoomId(socket.userId!, otherUserId);

      socket.join(roomId);
      console.log(`🏠 User ${socket.userId} joined room: ${roomId}`);

      // Load recent messages from Redis first (faster)
      console.log(`📜 Loading recent messages from Redis for room ${roomId}`);
      let messages = await getRecentMessagesFromRedis(
        socket.userId!,
        otherUserId
      );

      // If no messages in Redis, load from database
      if (messages.length === 0) {
        console.log(
          `💾 No messages in Redis, loading from database for room ${roomId}`
        );
        const dbMessages = await prisma.message.findMany({
          where: {
            OR: [
              { senderId: socket.userId, receiverId: otherUserId },
              { senderId: otherUserId, receiverId: socket.userId },
            ],
          },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                username: true,
                image: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        messages = dbMessages.reverse();
        console.log(`📊 Loaded ${messages.length} messages from database`);

        // Cache in Redis for future use
        if (messages.length > 0) {
          console.log(`💾 Caching ${messages.length} messages to Redis`);
          const pipeline = redis.pipeline();
          messages.forEach((msg) => {
            pipeline.lpush(`${ROOM_PREFIX}${roomId}`, JSON.stringify(msg));
          });
          await pipeline.exec();
        }
      } else {
        console.log(`📊 Loaded ${messages.length} messages from Redis cache`);
      }

      socket.emit("chat_history", messages);

      // Mark messages as read
      console.log(`✅ Marking messages as read for user ${socket.userId}`);
      await markMessagesAsRead(otherUserId, socket.userId!);

      // Update unread count
      const newUnreadCount = await getUnreadCount(socket.userId!);
      socket.emit("unread_count", newUnreadCount);
      console.log(
        `📧 Updated unread count (${newUnreadCount}) for user ${socket.userId}`
      );
    } catch (error) {
      console.error(`❌ Error joining chat for user ${socket.userId}:`, error);
      console.error(
        "Join chat error stack:",
        error instanceof Error ? error.stack : "No stack trace"
      );
      socket.emit("error", { message: "Failed to join chat" });
    }
  });

  // Handle sending messages
  socket.on(
    "send_message",
    async (data: { receiverId: string; content: string }) => {
      try {
        console.log(
          `📤 User ${socket.userId} sending message to ${data.receiverId}`
        );
        const { receiverId, content } = data;

        if (!content.trim()) {
          console.warn(`⚠️ Empty message content from user ${socket.userId}`);
          socket.emit("error", { message: "Message content cannot be empty" });
          return;
        }

        // Save to database
        console.log(`💾 Saving message to database`);
        const message = await saveMessageToDatabase({
          content: content.trim(),
          senderId: socket.userId!,
          receiverId,
        });
        console.log(`✅ Message saved with ID: ${message.id}`);

        // Save to Redis for quick access
        console.log(`💾 Caching message in Redis`);
        await saveMessageToRedis(message);

        const roomId = getRoomId(socket.userId!, receiverId);

        // Send to all users in the room
        console.log(`📡 Broadcasting message to room ${roomId}`);
        io.to(roomId).emit("new_message", message);

        // Send notification to receiver if they're online but not in the chat room
        const receiverSocketId = await redis.hget(USER_SOCKET_KEY, receiverId);
        if (receiverSocketId) {
          console.log(`🔍 Found receiver socket: ${receiverSocketId}`);
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket && !receiverSocket.rooms.has(roomId)) {
            console.log(`🔔 Sending notification to receiver ${receiverId}`);
            // User is online but not in chat room - send notification
            receiverSocket.emit("new_message_notification", {
              senderId: socket.userId,
              senderName: message.sender.name || message.sender.username,
              content:
                content.length > 50
                  ? content.substring(0, 50) + "..."
                  : content,
              messageId: message.id,
            });

            // Update unread count
            const unreadCount = await getUnreadCount(receiverId);
            receiverSocket.emit("unread_count", unreadCount);
            console.log(
              `📧 Updated unread count (${unreadCount}) for receiver ${receiverId}`
            );
          } else {
            console.log(`ℹ️ Receiver is in chat room, no notification needed`);
          }
        } else {
          console.log(`📴 Receiver ${receiverId} is offline`);
        }

        socket.emit("message_sent", {
          messageId: message.id,
          status: "delivered",
        });
        console.log(`✅ Message delivery confirmed to sender ${socket.userId}`);
      } catch (error) {
        console.error(
          `❌ Error sending message from user ${socket.userId}:`,
          error
        );
        console.error(
          "Send message error stack:",
          error instanceof Error ? error.stack : "No stack trace"
        );
        socket.emit("error", { message: "Failed to send message" });
      }
    }
  );

  // Handle typing indicators
  socket.on("typing_start", async (data: { receiverId: string }) => {
    try {
      const { receiverId } = data;
      const roomId = getRoomId(socket.userId!, receiverId);

      // Set typing indicator with expiration
      await redis.setex(`${TYPING_PREFIX}${roomId}:${socket.userId}`, 5, "1");

      socket.to(roomId).emit("user_typing", {
        userId: socket.userId,
        isTyping: true,
      });
    } catch (error) {
      console.error("Error handling typing start:", error);
    }
  });

  socket.on("typing_stop", async (data: { receiverId: string }) => {
    try {
      const { receiverId } = data;
      const roomId = getRoomId(socket.userId!, receiverId);

      // Remove typing indicator
      await redis.del(`${TYPING_PREFIX}${roomId}:${socket.userId}`);

      socket.to(roomId).emit("user_typing", {
        userId: socket.userId,
        isTyping: false,
      });
    } catch (error) {
      console.error("Error handling typing stop:", error);
    }
  });

  // Handle marking messages as read
  socket.on("mark_read", async (data: { senderId: string }) => {
    try {
      const { senderId } = data;
      await markMessagesAsRead(senderId, socket.userId!);

      const unreadCount = await getUnreadCount(socket.userId!);
      socket.emit("unread_count", unreadCount);

      // Notify sender that messages were read
      const senderSocketId = await redis.hget(USER_SOCKET_KEY, senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messages_read", {
          readBy: socket.userId,
        });
      }
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  // Handle getting conversation list
  socket.on("get_conversations", async () => {
    try {
      // Alternative approach using window functions instead of DISTINCT ON
      const conversations = await prisma.$queryRaw`
      WITH ranked_messages AS (
        SELECT 
          *,
          CASE 
            WHEN "senderId" = ${socket.userId} THEN "receiverId"
            ELSE "senderId"
          END as other_user_id,
          ROW_NUMBER() OVER (
            PARTITION BY 
              CASE 
                WHEN "senderId" = ${socket.userId} THEN "receiverId"
                ELSE "senderId"
              END
            ORDER BY "createdAt" DESC
          ) as rn
        FROM "message"
        WHERE "senderId" = ${socket.userId} OR "receiverId" = ${socket.userId}
      ),
      latest_messages AS (
        SELECT * FROM ranked_messages WHERE rn = 1
      )
      SELECT 
        lm.id,
        lm.content,
        lm."senderId",
        lm."receiverId", 
        lm."createdAt",
        lm.read,
        lm.other_user_id,
        u.name,
        u.username,
        u.image,
        u.id as user_id,
        COALESCE((
          SELECT COUNT(*)::int
          FROM "message" m2
          WHERE m2."senderId" = lm.other_user_id 
          AND m2."receiverId" = ${socket.userId}
          AND m2.read = false
        ), 0) as unread_count
      FROM latest_messages lm
      JOIN "user" u ON u.id = lm.other_user_id
      ORDER BY lm."createdAt" DESC
    `;

      socket.emit("conversations", conversations);
    } catch (error) {
      console.error("Error getting conversations:", error);
      socket.emit("error", { message: "Failed to get conversations" });
    }
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
    try {
      console.log(`👋 User ${socket.userId} disconnected`);

      // Remove user socket mapping
      await redis.hdel(USER_SOCKET_KEY, socket.userId!);
      console.log(`🗑️ Removed socket mapping for user ${socket.userId}`);

      // Clean up typing indicators
      const keys = await redis.keys(`${TYPING_PREFIX}*:${socket.userId}`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(
          `🧹 Cleaned up ${keys.length} typing indicators for user ${socket.userId}`
        );
      }
    } catch (error) {
      console.error(
        `❌ Error during disconnect for user ${socket.userId}:`,
        error
      );
      console.error(
        "Disconnect error stack:",
        error instanceof Error ? error.stack : "No stack trace"
      );
    }
  });
});

// Cleanup function for graceful shutdown
const cleanup = async () => {
  await prisma.$disconnect();
  await redis.quit();
  httpServer.close();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 Chat server running on port ${PORT}`);
  console.log(`📡 Socket.IO endpoint: http://localhost:${PORT}/socket.io/`);
  console.log(`🔐 Auth endpoint: http://localhost:${PORT}/api/auth/*`);
  console.log(`👤 Session endpoint: http://localhost:${PORT}/api/me`);
});

// Add error handling for the server
httpServer.on("error", (error) => {
  console.error("❌ HTTP Server error:", error);
});

// Add unhandled rejection and exception handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  console.error("Stack trace:", error.stack);
});
