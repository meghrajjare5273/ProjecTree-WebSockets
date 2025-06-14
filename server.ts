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

// Fix 1: Update the conversation interface to match actual data structure
interface ConversationData {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  createdAt: Date;
  read: boolean;
  other_user_id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  user_id: string;
  unread_count: number;
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

// Fix 2: Optimized function to get conversations with single query
const getConversationsForUser = async (
  userId: string
): Promise<ConversationData[]> => {
  try {
    // Get all messages where user is sender or receiver, with latest message per conversation
    const conversations = await prisma.$queryRaw<any[]>`
      WITH ranked_messages AS (
        SELECT 
          m.*,
          u.name,
          u.username,
          u.image,
          CASE 
            WHEN m."senderId" = ${userId} THEN m."receiverId"
            ELSE m."senderId"
          END as other_user_id,
          ROW_NUMBER() OVER (
            PARTITION BY CASE 
              WHEN m."senderId" = ${userId} THEN m."receiverId"
              ELSE m."senderId"
            END
            ORDER BY m."createdAt" DESC
          ) as rn
        FROM "message" m
        JOIN "user" u ON (
          CASE 
            WHEN m."senderId" = ${userId} THEN u.id = m."receiverId"
            ELSE u.id = m."senderId"
          END
        )
        WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
      ),
      unread_counts AS (
        SELECT 
          "senderId" as other_user_id,
          COUNT(*) as unread_count
        FROM "message"
        WHERE "receiverId" = ${userId} AND "read" = false
        GROUP BY "senderId"
      )
      SELECT 
        rm.*,
        COALESCE(uc.unread_count, 0) as unread_count
      FROM ranked_messages rm
      LEFT JOIN unread_counts uc ON rm.other_user_id = uc.other_user_id
      WHERE rm.rn = 1
      ORDER BY rm."createdAt" DESC
    `;

    return conversations.map((conv: any) => ({
      id: conv.id,
      content: conv.content,
      senderId: conv.senderId,
      receiverId: conv.receiverId,
      createdAt: conv.createdAt,
      read: conv.read,
      other_user_id: conv.other_user_id,
      name: conv.name,
      username: conv.username,
      image: conv.image,
      user_id: conv.other_user_id,
      unread_count: Number(conv.unread_count) || 0,
    }));
  } catch (error) {
    console.error("Error in getConversationsForUser:", error);
    throw error;
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

  socket.on("join_chat", async (data: { otherUserId: string }, callback) => {
    try {
      const { otherUserId } = data;
      if (!otherUserId) {
        callback({ error: "Invalid user ID provided" });
        return;
      }
      const roomId = getRoomId(socket.userId!, otherUserId);
      socket.join(roomId);
      let messages = await getRecentMessagesFromRedis(
        socket.userId!,
        otherUserId
      );
      if (messages.length === 0) {
        const dbMessages = await prisma.message.findMany({
          where: {
            OR: [
              { senderId: socket.userId, receiverId: otherUserId },
              { senderId: otherUserId, receiverId: socket.userId },
            ],
          },
          include: {
            sender: {
              select: { id: true, name: true, username: true, image: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        messages = dbMessages.reverse();
        if (messages.length > 0) {
          const pipeline = redis.pipeline();
          messages.forEach((msg) =>
            pipeline.lpush(`${ROOM_PREFIX}${roomId}`, JSON.stringify(msg))
          );
          await pipeline.exec();
        }
      }
      // Send messages back via callback
      callback({ messages });
      // Additional server logic (e.g., marking messages as read)
      await markMessagesAsRead(otherUserId, socket.userId!);
      const newUnreadCount = await getUnreadCount(socket.userId!);
      io.to(`user:${socket.userId}`).emit("unread_count", newUnreadCount);
    } catch (error) {
      console.error(`❌ Error in join_chat for user ${socket.userId}:`, error);
      callback({ error: "Failed to load chat history" });
    }
  });
  // Fix 4: Add validation and better error handling to send_message
  socket.on(
    "send_message",
    async (data: { receiverId: string; content: string }) => {
      try {
        console.log(
          `📤 User ${socket.userId} sending message to ${data.receiverId}`
        );
        const { receiverId, content } = data;

        // Validation
        if (!receiverId) {
          socket.emit("error", { message: "Receiver ID is required" });
          return;
        }

        if (!content || !content.trim()) {
          console.warn(`⚠️ Empty message content from user ${socket.userId}`);
          socket.emit("error", { message: "Message content cannot be empty" });
          return;
        }

        if (content.trim().length > 1000) {
          socket.emit("error", { message: "Message too long" });
          return;
        }

        // Validate receiver exists
        const receiver = await prisma.user.findUnique({
          where: { id: receiverId },
          select: { id: true },
        });

        if (!receiver) {
          socket.emit("error", { message: "Receiver not found" });
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

  // Fix 5: Optimized get_conversations handler
  socket.on("get_conversations", async () => {
    try {
      console.log(`📋 Getting conversations for user ${socket.userId}`);

      const conversations = await getConversationsForUser(socket.userId!);

      console.log(`✅ Retrieved ${conversations.length} conversations`);
      socket.emit("conversations", conversations);
    } catch (error) {
      console.error(
        `❌ Error getting conversations for user ${socket.userId}:`,
        error
      );
      console.error("Error details:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : "No stack trace",
      });
      socket.emit("error", { message: "Failed to get conversations" });
    }
  });

  //Handle Old Messages
  socket.on("load_more_messages", async (data) => {
    try {
      const { otherUserId, before } = data;
      if (!otherUserId || !before) {
        socket.emit("error", { message: "Invalid parameters" });
        return;
      }

      const roomId = getRoomId(socket.userId!, otherUserId);
      if (!socket.rooms.has(roomId)) {
        socket.emit("error", { message: "Not in chat room" });
        return;
      }

      const olderMessages = await prisma.message.findMany({
        where: {
          OR: [
            { senderId: socket.userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: socket.userId },
          ],
          createdAt: { lt: new Date(before) },
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

      // Reverse to send messages in ascending order (oldest first)
      const sortedOlderMessages = olderMessages.reverse();
      socket.emit("more_messages", sortedOlderMessages);
    } catch (error) {
      console.error("Error loading more messages:", error);
      socket.emit("error", { message: "Failed to load more messages" });
    }
  });

  // Handle disconnect with enhanced logic
  socket.on("disconnect", async (reason) => {
    try {
      console.log(`👋 User ${socket.userId} disconnected: ${reason}`);

      // Don't clean up immediately for transport errors - they might reconnect
      if (
        reason === "transport error" ||
        reason === "transport close" ||
        reason == "client namespace disconnect"
      ) {
        console.log(
          `⏳ Delaying cleanup for user ${socket.userId} due to transport issue`
        );

        setTimeout(async () => {
          try {
            // Check if user has reconnected by looking for active socket
            const currentSocketId = await redis.hget(
              USER_SOCKET_KEY,
              socket.userId!
            );

            // Clean up only if this socket is still the active one (user hasn't reconnected)
            if (currentSocketId === socket.id) {
              await cleanup();
            } else {
              console.log(
                `🔄 User ${socket.userId} has reconnected, skipping cleanup`
              );
            }
          } catch (error) {
            console.error(
              `❌ Error during delayed cleanup for user ${socket.userId}:`,
              error
            );
          }
        }, 8000);
      } else {
        // For normal disconnects (client close, server shutdown, etc.), clean up immediately
        await cleanup();
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
