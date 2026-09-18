"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unregisterLocalSyncEvent = exports.registerLocalSyncEvent = void 0;
const modules_1 = require("../../modules");
const registerLocalSyncEvent = async (wss) => {
    (0, exports.unregisterLocalSyncEvent)();
    for (const module of Object.values(modules_1.modules)) {
        module.registerEvent(wss);
    }
};
exports.registerLocalSyncEvent = registerLocalSyncEvent;
const unregisterLocalSyncEvent = () => {
    for (const module of Object.values(modules_1.modules)) {
        module.unregisterEvent();
    }
};
exports.unregisterLocalSyncEvent = unregisterLocalSyncEvent;
