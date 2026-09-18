"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 这个文件导出的方法将暴露给客户端调用，第一个参数固定为当前 socket 对象
// import { getUserSpace } from '../../user'
const constants_1 = require("../../constants");
const modules_1 = require("../../modules");
const handler = {
    async onFeatureChanged(socket, feature) {
        // const userSpace = getUserSpace(socket.userInfo.name)
        const beforeFeature = socket.feature;
        for (const name of constants_1.FeaturesList) {
            const newStatus = feature[name];
            if (newStatus == null)
                continue;
            beforeFeature[name] = feature[name];
            socket.moduleReadys[name] = false;
            if (feature[name])
                await modules_1.modules[name].sync(socket).catch(_ => _);
        }
    },
};
exports.default = handler;
