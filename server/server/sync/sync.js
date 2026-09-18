"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync = void 0;
const constants_1 = require("../../constants");
const modules_1 = require("../../modules");
const sync = async (socket) => {
    let disconnected = false;
    socket.onClose(() => {
        disconnected = true;
    });
    const enabledFeatures = await socket.remote.getEnabledFeatures('server', modules_1.featureVersion);
    if (disconnected)
        throw new Error('disconnected');
    for (const moduleName of constants_1.FeaturesList) {
        if (enabledFeatures[moduleName]) {
            socket.feature[moduleName] = enabledFeatures[moduleName];
            await modules_1.modules[moduleName].sync(socket).catch(_ => _);
        }
        if (disconnected)
            throw new Error('disconnected');
    }
    await socket.remote.finished();
};
exports.sync = sync;
