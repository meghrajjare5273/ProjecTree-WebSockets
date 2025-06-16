"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.prisma = void 0;
var better_auth_1 = require("better-auth");
// import { username } from "better-auth/plugins";
var prisma_1 = require("better-auth/adapters/prisma");
var client_1 = require("@prisma/client");
exports.prisma = new client_1.PrismaClient();
exports.auth = (0, better_auth_1.betterAuth)({
    database: (0, prisma_1.prismaAdapter)(exports.prisma, {
        provider: "postgresql", // or "mysql", "postgresql", ...etc
    }),
});
