"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_http_1 = require("node:http");
var socket_io_1 = require("socket.io");
var auth_1 = require("./auth");
var express_1 = require("express");
var node_1 = require("better-auth/node");
var client_1 = require("@prisma/client");
var ioredis_1 = require("ioredis");
var cors_1 = require("cors");
// Initialize clients
console.log("🚀 Initializing server components...");
var prisma;
var redis;
try {
    console.log("💾 Connecting to database...");
    prisma = new client_1.PrismaClient();
    console.log("🔴 Connecting to Redis...");
    redis = new ioredis_1.default(process.env.REDIS_URL || "redis://localhost:6379");
    // Test Redis connection
    redis.on("connect", function () {
        console.log("✅ Redis connected successfully");
    });
    redis.on("error", function (err) {
        console.error("❌ Redis connection error:", err);
    });
    // Test database connection
    prisma
        .$connect()
        .then(function () { return console.log("✅ Database connected successfully"); })
        .catch(function (err) { return console.error("❌ Database connection error:", err); });
}
catch (error) {
    console.error("❌ Failed to initialize clients:", error);
    process.exit(1);
}
var app = (0, express_1.default)();
var httpServer = (0, node_http_1.createServer)(app);
// CORS middleware
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
}));
// Better Auth handler
app.all("/api/auth/*splat", (0, node_1.toNodeHandler)(auth_1.auth));
app.use(express_1.default.json());
// Session endpoint
app.get("/api/me", function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var session, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, auth_1.auth.api.getSession({
                        headers: (0, node_1.fromNodeHeaders)(req.headers),
                    })];
            case 1:
                session = _a.sent();
                res.json(session);
                return [3 /*break*/, 3];
            case 2:
                error_1 = _a.sent();
                res.status(500).json({ error: "Failed to get session" });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
// Socket.IO setup
var io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
    },
    path: "/socket.io/",
});
// Store user socket mappings in Redis
var USER_SOCKET_KEY = "user_sockets";
var ROOM_PREFIX = "room:";
var TYPING_PREFIX = "typing:";
// Socket.IO middleware for authentication
io.use(function (socket, next) { return __awaiter(void 0, void 0, void 0, function () {
    var session, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                console.log("🔐 Authenticating socket connection...");
                console.log("Headers:", JSON.stringify(socket.handshake.headers, null, 2));
                return [4 /*yield*/, auth_1.auth.api.getSession({
                        headers: (0, node_1.fromNodeHeaders)(socket.handshake.headers),
                    })];
            case 1:
                session = _a.sent();
                console.log("📋 Session data:", JSON.stringify(session, null, 2));
                if (!(session === null || session === void 0 ? void 0 : session.user)) {
                    console.error("❌ Authentication failed: No user session found");
                    return [2 /*return*/, next(new Error("Authentication required"))];
                }
                socket.userId = session.user.id;
                socket.userEmail = session.user.email;
                console.log("\u2705 User authenticated: ".concat(session.user.id, " (").concat(session.user.email, ")"));
                next();
                return [3 /*break*/, 3];
            case 2:
                error_2 = _a.sent();
                console.error("❌ Authentication middleware error:", error_2);
                console.error("Error stack:", error_2 instanceof Error ? error_2.stack : "No stack trace");
                next(new Error("Authentication failed: ".concat(error_2 instanceof Error ? error_2.message : "Unknown error")));
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
// Helper functions
var getRoomId = function (userId1, userId2) {
    return [userId1, userId2].sort().join(":");
};
var saveMessageToRedis = function (message) { return __awaiter(void 0, void 0, void 0, function () {
    var roomId;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                roomId = getRoomId(message.senderId, message.receiverId);
                return [4 /*yield*/, redis.lpush("".concat(ROOM_PREFIX).concat(roomId), JSON.stringify(message))];
            case 1:
                _a.sent();
                // Keep only last 100 messages in Redis for quick access
                return [4 /*yield*/, redis.ltrim("".concat(ROOM_PREFIX).concat(roomId), 0, 99)];
            case 2:
                // Keep only last 100 messages in Redis for quick access
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
var getRecentMessagesFromRedis = function (userId1, userId2) { return __awaiter(void 0, void 0, void 0, function () {
    var roomId, messages;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                roomId = getRoomId(userId1, userId2);
                return [4 /*yield*/, redis.lrange("".concat(ROOM_PREFIX).concat(roomId), 0, 49)];
            case 1:
                messages = _a.sent();
                return [2 /*return*/, messages.map(function (msg) { return JSON.parse(msg); }).reverse()];
        }
    });
}); };
var saveMessageToDatabase = function (messageData) { return __awaiter(void 0, void 0, void 0, function () {
    var message, error_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                console.log("\uD83D\uDCBE Attempting to save message to database:", {
                    senderId: messageData.senderId,
                    receiverId: messageData.receiverId,
                    contentLength: messageData.content.length,
                });
                return [4 /*yield*/, prisma.message.create({
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
                    })];
            case 1:
                message = _a.sent();
                console.log("\u2705 Message saved successfully with ID: ".concat(message.id));
                return [2 /*return*/, message];
            case 2:
                error_3 = _a.sent();
                console.error("❌ Failed to save message to database:", error_3);
                console.error("Database error details:", {
                    error: error_3 instanceof Error ? error_3.message : "Unknown error",
                    stack: error_3 instanceof Error ? error_3.stack : "No stack trace",
                    messageData: messageData,
                });
                throw error_3;
            case 3: return [2 /*return*/];
        }
    });
}); };
var markMessagesAsRead = function (senderId, receiverId) { return __awaiter(void 0, void 0, void 0, function () {
    var error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, prisma.message.updateMany({
                        where: {
                            senderId: senderId,
                            receiverId: receiverId,
                            read: false,
                        },
                        data: {
                            read: true,
                        },
                    })];
            case 1:
                _a.sent();
                return [3 /*break*/, 3];
            case 2:
                error_4 = _a.sent();
                console.error("Failed to mark messages as read:", error_4);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); };
var getUnreadCount = function (userId) { return __awaiter(void 0, void 0, void 0, function () {
    var error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, prisma.message.count({
                        where: {
                            receiverId: userId,
                            read: false,
                        },
                    })];
            case 1: return [2 /*return*/, _a.sent()];
            case 2:
                error_5 = _a.sent();
                console.error("Failed to get unread count:", error_5);
                return [2 /*return*/, 0];
            case 3: return [2 /*return*/];
        }
    });
}); };
// Fix 2: Optimized function to get conversations with single query
var getConversationsForUser = function (userId) { return __awaiter(void 0, void 0, void 0, function () {
    var conversations, error_6;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, prisma.$queryRaw(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n      WITH ranked_messages AS (\n        SELECT \n          m.*,\n          u.name,\n          u.username,\n          u.image,\n          CASE \n            WHEN m.\"senderId\" = ", " THEN m.\"receiverId\"\n            ELSE m.\"senderId\"\n          END as other_user_id,\n          ROW_NUMBER() OVER (\n            PARTITION BY CASE \n              WHEN m.\"senderId\" = ", " THEN m.\"receiverId\"\n              ELSE m.\"senderId\"\n            END\n            ORDER BY m.\"createdAt\" DESC\n          ) as rn\n        FROM \"message\" m\n        JOIN \"user\" u ON (\n          CASE \n            WHEN m.\"senderId\" = ", " THEN u.id = m.\"receiverId\"\n            ELSE u.id = m.\"senderId\"\n          END\n        )\n        WHERE m.\"senderId\" = ", " OR m.\"receiverId\" = ", "\n      ),\n      unread_counts AS (\n        SELECT \n          \"senderId\" as other_user_id,\n          COUNT(*) as unread_count\n        FROM \"message\"\n        WHERE \"receiverId\" = ", " AND \"read\" = false\n        GROUP BY \"senderId\"\n      )\n      SELECT \n        rm.*,\n        COALESCE(uc.unread_count, 0) as unread_count\n      FROM ranked_messages rm\n      LEFT JOIN unread_counts uc ON rm.other_user_id = uc.other_user_id\n      WHERE rm.rn = 1\n      ORDER BY rm.\"createdAt\" DESC\n    "], ["\n      WITH ranked_messages AS (\n        SELECT \n          m.*,\n          u.name,\n          u.username,\n          u.image,\n          CASE \n            WHEN m.\"senderId\" = ", " THEN m.\"receiverId\"\n            ELSE m.\"senderId\"\n          END as other_user_id,\n          ROW_NUMBER() OVER (\n            PARTITION BY CASE \n              WHEN m.\"senderId\" = ", " THEN m.\"receiverId\"\n              ELSE m.\"senderId\"\n            END\n            ORDER BY m.\"createdAt\" DESC\n          ) as rn\n        FROM \"message\" m\n        JOIN \"user\" u ON (\n          CASE \n            WHEN m.\"senderId\" = ", " THEN u.id = m.\"receiverId\"\n            ELSE u.id = m.\"senderId\"\n          END\n        )\n        WHERE m.\"senderId\" = ", " OR m.\"receiverId\" = ", "\n      ),\n      unread_counts AS (\n        SELECT \n          \"senderId\" as other_user_id,\n          COUNT(*) as unread_count\n        FROM \"message\"\n        WHERE \"receiverId\" = ", " AND \"read\" = false\n        GROUP BY \"senderId\"\n      )\n      SELECT \n        rm.*,\n        COALESCE(uc.unread_count, 0) as unread_count\n      FROM ranked_messages rm\n      LEFT JOIN unread_counts uc ON rm.other_user_id = uc.other_user_id\n      WHERE rm.rn = 1\n      ORDER BY rm.\"createdAt\" DESC\n    "])), userId, userId, userId, userId, userId, userId)];
            case 1:
                conversations = _a.sent();
                return [2 /*return*/, conversations.map(function (conv) { return ({
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
                    }); })];
            case 2:
                error_6 = _a.sent();
                console.error("Error in getConversationsForUser:", error_6);
                throw error_6;
            case 3: return [2 /*return*/];
        }
    });
}); };
// Socket.IO connection handling
io.on("connection", function (socket) { return __awaiter(void 0, void 0, void 0, function () {
    var unreadCount, error_7;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                console.log("\uD83D\uDD0C User ".concat(socket.userId, " connected successfully"));
                // Store user socket mapping
                console.log("\uD83D\uDCBE Storing socket mapping for user ".concat(socket.userId));
                return [4 /*yield*/, redis.hset(USER_SOCKET_KEY, socket.userId, socket.id)];
            case 1:
                _a.sent();
                // Join user to their personal room for notifications
                socket.join("user:".concat(socket.userId));
                console.log("\uD83C\uDFE0 User ".concat(socket.userId, " joined personal room"));
                return [4 /*yield*/, getUnreadCount(socket.userId)];
            case 2:
                unreadCount = _a.sent();
                socket.emit("unread_count", unreadCount);
                console.log("\uD83D\uDCE7 Sent unread count (".concat(unreadCount, ") to user ").concat(socket.userId));
                return [3 /*break*/, 4];
            case 3:
                error_7 = _a.sent();
                console.error("\u274C Error during connection setup for user ".concat(socket.userId, ":"), error_7);
                console.error("Connection error stack:", error_7 instanceof Error ? error_7.stack : "No stack trace");
                return [3 /*break*/, 4];
            case 4:
                socket.on("join_chat", function (data, callback) { return __awaiter(void 0, void 0, void 0, function () {
                    var otherUserId, roomId_1, messages, dbMessages, pipeline_1, newUnreadCount, error_8;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 7, , 8]);
                                otherUserId = data.otherUserId;
                                if (!otherUserId) {
                                    callback({ error: "Invalid user ID provided" });
                                    return [2 /*return*/];
                                }
                                roomId_1 = getRoomId(socket.userId, otherUserId);
                                socket.join(roomId_1);
                                return [4 /*yield*/, getRecentMessagesFromRedis(socket.userId, otherUserId)];
                            case 1:
                                messages = _a.sent();
                                if (!(messages.length === 0)) return [3 /*break*/, 4];
                                return [4 /*yield*/, prisma.message.findMany({
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
                                    })];
                            case 2:
                                dbMessages = _a.sent();
                                messages = dbMessages.reverse();
                                if (!(messages.length > 0)) return [3 /*break*/, 4];
                                pipeline_1 = redis.pipeline();
                                messages.forEach(function (msg) {
                                    return pipeline_1.lpush("".concat(ROOM_PREFIX).concat(roomId_1), JSON.stringify(msg));
                                });
                                return [4 /*yield*/, pipeline_1.exec()];
                            case 3:
                                _a.sent();
                                _a.label = 4;
                            case 4:
                                // Send messages back via callback
                                callback({ messages: messages });
                                // Additional server logic (e.g., marking messages as read)
                                return [4 /*yield*/, markMessagesAsRead(otherUserId, socket.userId)];
                            case 5:
                                // Additional server logic (e.g., marking messages as read)
                                _a.sent();
                                return [4 /*yield*/, getUnreadCount(socket.userId)];
                            case 6:
                                newUnreadCount = _a.sent();
                                io.to("user:".concat(socket.userId)).emit("unread_count", newUnreadCount);
                                return [3 /*break*/, 8];
                            case 7:
                                error_8 = _a.sent();
                                console.error("\u274C Error in join_chat for user ".concat(socket.userId, ":"), error_8);
                                callback({ error: "Failed to load chat history" });
                                return [3 /*break*/, 8];
                            case 8: return [2 /*return*/];
                        }
                    });
                }); });
                // Fix 4: Add validation and better error handling to send_message
                socket.on("send_message", function (data) { return __awaiter(void 0, void 0, void 0, function () {
                    var receiverId, content, receiver, message, roomId, receiverSocketId, receiverSocket, unreadCount, error_9;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 10, , 11]);
                                console.log("\uD83D\uDCE4 User ".concat(socket.userId, " sending message to ").concat(data.receiverId));
                                receiverId = data.receiverId, content = data.content;
                                // Validation
                                if (!receiverId) {
                                    socket.emit("error", { message: "Receiver ID is required" });
                                    return [2 /*return*/];
                                }
                                if (!content || !content.trim()) {
                                    console.warn("\u26A0\uFE0F Empty message content from user ".concat(socket.userId));
                                    socket.emit("error", { message: "Message content cannot be empty" });
                                    return [2 /*return*/];
                                }
                                if (content.trim().length > 1000) {
                                    socket.emit("error", { message: "Message too long" });
                                    return [2 /*return*/];
                                }
                                return [4 /*yield*/, prisma.user.findUnique({
                                        where: { id: receiverId },
                                        select: { id: true },
                                    })];
                            case 1:
                                receiver = _a.sent();
                                if (!receiver) {
                                    socket.emit("error", { message: "Receiver not found" });
                                    return [2 /*return*/];
                                }
                                // Save to database
                                console.log("\uD83D\uDCBE Saving message to database");
                                return [4 /*yield*/, saveMessageToDatabase({
                                        content: content.trim(),
                                        senderId: socket.userId,
                                        receiverId: receiverId,
                                    })];
                            case 2:
                                message = _a.sent();
                                console.log("\u2705 Message saved with ID: ".concat(message.id));
                                // Save to Redis for quick access
                                console.log("\uD83D\uDCBE Caching message in Redis");
                                return [4 /*yield*/, saveMessageToRedis(message)];
                            case 3:
                                _a.sent();
                                roomId = getRoomId(socket.userId, receiverId);
                                // Send to all users in the room
                                console.log("\uD83D\uDCE1 Broadcasting message to room ".concat(roomId));
                                io.to(roomId).emit("new_message", message);
                                return [4 /*yield*/, redis.hget(USER_SOCKET_KEY, receiverId)];
                            case 4:
                                receiverSocketId = _a.sent();
                                if (!receiverSocketId) return [3 /*break*/, 8];
                                console.log("\uD83D\uDD0D Found receiver socket: ".concat(receiverSocketId));
                                receiverSocket = io.sockets.sockets.get(receiverSocketId);
                                if (!(receiverSocket && !receiverSocket.rooms.has(roomId))) return [3 /*break*/, 6];
                                console.log("\uD83D\uDD14 Sending notification to receiver ".concat(receiverId));
                                // User is online but not in chat room - send notification
                                receiverSocket.emit("new_message_notification", {
                                    senderId: socket.userId,
                                    senderName: message.sender.name || message.sender.username,
                                    content: content.length > 50
                                        ? content.substring(0, 50) + "..."
                                        : content,
                                    messageId: message.id,
                                });
                                return [4 /*yield*/, getUnreadCount(receiverId)];
                            case 5:
                                unreadCount = _a.sent();
                                receiverSocket.emit("unread_count", unreadCount);
                                console.log("\uD83D\uDCE7 Updated unread count (".concat(unreadCount, ") for receiver ").concat(receiverId));
                                return [3 /*break*/, 7];
                            case 6:
                                console.log("\u2139\uFE0F Receiver is in chat room, no notification needed");
                                _a.label = 7;
                            case 7: return [3 /*break*/, 9];
                            case 8:
                                console.log("\uD83D\uDCF4 Receiver ".concat(receiverId, " is offline"));
                                _a.label = 9;
                            case 9:
                                socket.emit("message_sent", {
                                    messageId: message.id,
                                    status: "delivered",
                                });
                                console.log("\u2705 Message delivery confirmed to sender ".concat(socket.userId));
                                return [3 /*break*/, 11];
                            case 10:
                                error_9 = _a.sent();
                                console.error("\u274C Error sending message from user ".concat(socket.userId, ":"), error_9);
                                socket.emit("error", { message: "Failed to send message" });
                                return [3 /*break*/, 11];
                            case 11: return [2 /*return*/];
                        }
                    });
                }); });
                // Handle typing indicators
                socket.on("typing_start", function (data) { return __awaiter(void 0, void 0, void 0, function () {
                    var receiverId, roomId, error_10;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                receiverId = data.receiverId;
                                roomId = getRoomId(socket.userId, receiverId);
                                // Set typing indicator with expiration
                                return [4 /*yield*/, redis.setex("".concat(TYPING_PREFIX).concat(roomId, ":").concat(socket.userId), 5, "1")];
                            case 1:
                                // Set typing indicator with expiration
                                _a.sent();
                                socket.to(roomId).emit("user_typing", {
                                    userId: socket.userId,
                                    isTyping: true,
                                });
                                return [3 /*break*/, 3];
                            case 2:
                                error_10 = _a.sent();
                                console.error("Error handling typing start:", error_10);
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); });
                socket.on("typing_stop", function (data) { return __awaiter(void 0, void 0, void 0, function () {
                    var receiverId, roomId, error_11;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                receiverId = data.receiverId;
                                roomId = getRoomId(socket.userId, receiverId);
                                // Remove typing indicator
                                return [4 /*yield*/, redis.del("".concat(TYPING_PREFIX).concat(roomId, ":").concat(socket.userId))];
                            case 1:
                                // Remove typing indicator
                                _a.sent();
                                socket.to(roomId).emit("user_typing", {
                                    userId: socket.userId,
                                    isTyping: false,
                                });
                                return [3 /*break*/, 3];
                            case 2:
                                error_11 = _a.sent();
                                console.error("Error handling typing stop:", error_11);
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); });
                // Handle marking messages as read
                socket.on("mark_read", function (data) { return __awaiter(void 0, void 0, void 0, function () {
                    var senderId, unreadCount, senderSocketId, error_12;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 4, , 5]);
                                senderId = data.senderId;
                                return [4 /*yield*/, markMessagesAsRead(senderId, socket.userId)];
                            case 1:
                                _a.sent();
                                return [4 /*yield*/, getUnreadCount(socket.userId)];
                            case 2:
                                unreadCount = _a.sent();
                                socket.emit("unread_count", unreadCount);
                                return [4 /*yield*/, redis.hget(USER_SOCKET_KEY, senderId)];
                            case 3:
                                senderSocketId = _a.sent();
                                if (senderSocketId) {
                                    io.to(senderSocketId).emit("messages_read", {
                                        readBy: socket.userId,
                                    });
                                }
                                return [3 /*break*/, 5];
                            case 4:
                                error_12 = _a.sent();
                                console.error("Error marking messages as read:", error_12);
                                return [3 /*break*/, 5];
                            case 5: return [2 /*return*/];
                        }
                    });
                }); });
                // Fix 5: Optimized get_conversations handler
                socket.on("get_conversations", function () { return __awaiter(void 0, void 0, void 0, function () {
                    var conversations, error_13;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                console.log("\uD83D\uDCCB Getting conversations for user ".concat(socket.userId));
                                return [4 /*yield*/, getConversationsForUser(socket.userId)];
                            case 1:
                                conversations = _a.sent();
                                console.log("\u2705 Retrieved ".concat(conversations.length, " conversations"));
                                socket.emit("conversations", conversations);
                                return [3 /*break*/, 3];
                            case 2:
                                error_13 = _a.sent();
                                console.error("\u274C Error getting conversations for user ".concat(socket.userId, ":"), error_13);
                                console.error("Error details:", {
                                    error: error_13 instanceof Error ? error_13.message : "Unknown error",
                                    stack: error_13 instanceof Error ? error_13.stack : "No stack trace",
                                });
                                socket.emit("error", { message: "Failed to get conversations" });
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); });
                //Handle Old Messages
                socket.on("load_more_messages", function (data) { return __awaiter(void 0, void 0, void 0, function () {
                    var otherUserId, before, roomId, olderMessages, sortedOlderMessages, error_14;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 2, , 3]);
                                otherUserId = data.otherUserId, before = data.before;
                                if (!otherUserId || !before) {
                                    socket.emit("error", { message: "Invalid parameters" });
                                    return [2 /*return*/];
                                }
                                roomId = getRoomId(socket.userId, otherUserId);
                                if (!socket.rooms.has(roomId)) {
                                    socket.emit("error", { message: "Not in chat room" });
                                    return [2 /*return*/];
                                }
                                return [4 /*yield*/, prisma.message.findMany({
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
                                    })];
                            case 1:
                                olderMessages = _a.sent();
                                sortedOlderMessages = olderMessages.reverse();
                                socket.emit("more_messages", sortedOlderMessages);
                                return [3 /*break*/, 3];
                            case 2:
                                error_14 = _a.sent();
                                console.error("Error loading more messages:", error_14);
                                socket.emit("error", { message: "Failed to load more messages" });
                                return [3 /*break*/, 3];
                            case 3: return [2 /*return*/];
                        }
                    });
                }); });
                // Handle disconnect with enhanced logic
                socket.on("disconnect", function (reason) { return __awaiter(void 0, void 0, void 0, function () {
                    var error_15;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 4, , 5]);
                                console.log("\uD83D\uDC4B User ".concat(socket.userId, " disconnected: ").concat(reason));
                                if (!(reason === "transport error" ||
                                    reason === "transport close" ||
                                    reason == "client namespace disconnect")) return [3 /*break*/, 1];
                                console.log("\u23F3 Delaying cleanup for user ".concat(socket.userId, " due to transport issue"));
                                setTimeout(function () { return __awaiter(void 0, void 0, void 0, function () {
                                    var currentSocketId, error_16;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                _a.trys.push([0, 5, , 6]);
                                                return [4 /*yield*/, redis.hget(USER_SOCKET_KEY, socket.userId)];
                                            case 1:
                                                currentSocketId = _a.sent();
                                                if (!(currentSocketId === socket.id)) return [3 /*break*/, 3];
                                                return [4 /*yield*/, cleanup()];
                                            case 2:
                                                _a.sent();
                                                return [3 /*break*/, 4];
                                            case 3:
                                                console.log("\uD83D\uDD04 User ".concat(socket.userId, " has reconnected, skipping cleanup"));
                                                _a.label = 4;
                                            case 4: return [3 /*break*/, 6];
                                            case 5:
                                                error_16 = _a.sent();
                                                console.error("\u274C Error during delayed cleanup for user ".concat(socket.userId, ":"), error_16);
                                                return [3 /*break*/, 6];
                                            case 6: return [2 /*return*/];
                                        }
                                    });
                                }); }, 8000);
                                return [3 /*break*/, 3];
                            case 1: 
                            // For normal disconnects (client close, server shutdown, etc.), clean up immediately
                            return [4 /*yield*/, cleanup()];
                            case 2:
                                // For normal disconnects (client close, server shutdown, etc.), clean up immediately
                                _a.sent();
                                _a.label = 3;
                            case 3: return [3 /*break*/, 5];
                            case 4:
                                error_15 = _a.sent();
                                console.error("\u274C Error during disconnect for user ".concat(socket.userId, ":"), error_15);
                                console.error("Disconnect error stack:", error_15 instanceof Error ? error_15.stack : "No stack trace");
                                return [3 /*break*/, 5];
                            case 5: return [2 /*return*/];
                        }
                    });
                }); });
                return [2 /*return*/];
        }
    });
}); });
// Cleanup function for graceful shutdown
var cleanup = function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [4 /*yield*/, redis.quit()];
            case 2:
                _a.sent();
                httpServer.close();
                return [2 /*return*/];
        }
    });
}); };
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
var PORT = process.env.PORT || 3001;
httpServer.listen(PORT, function () {
    console.log("\uD83D\uDE80 Chat server running on port ".concat(PORT));
    console.log("\uD83D\uDCE1 Socket.IO endpoint: http://localhost:".concat(PORT, "/socket.io/"));
    console.log("\uD83D\uDD10 Auth endpoint: http://localhost:".concat(PORT, "/api/auth/*"));
    console.log("\uD83D\uDC64 Session endpoint: http://localhost:".concat(PORT, "/api/me"));
});
// Add error handling for the server
httpServer.on("error", function (error) {
    console.error("❌ HTTP Server error:", error);
});
// Add unhandled rejection and exception handlers
process.on("unhandledRejection", function (reason, promise) {
    console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", function (error) {
    console.error("❌ Uncaught Exception:", error);
    console.error("Stack trace:", error.stack);
});
var templateObject_1;
