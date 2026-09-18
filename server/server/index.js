"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = exports.startServer = void 0;
const server_1 = require("./server");
Object.defineProperty(exports, "startServer", { enumerable: true, get: function () { return server_1.startServer; } });
Object.defineProperty(exports, "getStatus", { enumerable: true, get: function () { return 
    // stopServer,
    server_1.getStatus; } });
