"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishRenameUserSpace = exports.renameUserSpace = exports.releaseUserSpace = exports.getUserSpace = void 0;
const data_1 = require("./data");
const modules_1 = require("../modules");
const users = new Map();
const renamingUsers = new Set();
const delayTime = 60 * 60 * 1000; // 延长到 1 小时
const delayReleaseTimeouts = new Map();
const clearDelayReleaseTimeout = (userName) => {
    if (!delayReleaseTimeouts.has(userName))
        return;
    clearTimeout(delayReleaseTimeouts.get(userName));
    delayReleaseTimeouts.delete(userName);
};
const seartDelayReleaseTimeout = (userName) => {
    clearDelayReleaseTimeout(userName);
    delayReleaseTimeouts.set(userName, setTimeout(() => {
        users.delete(userName);
    }, delayTime));
};
const getUserSpace = (userName) => {
    if (renamingUsers.has(userName)) {
        throw new Error(`User ${userName} is being renamed, access denied temporarily`);
    }
    clearDelayReleaseTimeout(userName);
    let user = users.get(userName);
    if (!user) {
        console.log('new user data manage:', userName);
        const dataManage = new data_1.UserDataManage(userName);
        const listManage = new modules_1.ListManage(dataManage);
        const dislikeManage = new modules_1.DislikeManage(dataManage);
        users.set(userName, user = {
            dataManage,
            listManage,
            dislikeManage,
            async getDecices() {
                return this.dataManage.getAllClientKeyInfo();
            },
            async removeDevice(clientId) {
                await listManage.removeDevice(clientId);
                await dataManage.removeClientKeyInfo(clientId);
            },
        });
    }
    return user;
};
exports.getUserSpace = getUserSpace;
const releaseUserSpace = (userName, force = false) => {
    if (force) {
        clearDelayReleaseTimeout(userName);
        users.delete(userName);
    }
    else
        seartDelayReleaseTimeout(userName);
};
exports.releaseUserSpace = releaseUserSpace;
/**
 * 重命名用户空间缓存并加锁
 * @param oldName 旧用户名
 */
const renameUserSpace = (oldName) => {
    clearDelayReleaseTimeout(oldName);
    users.delete(oldName);
    renamingUsers.add(oldName);
};
exports.renameUserSpace = renameUserSpace;
/**
 * 解除重命名锁定
 * @param oldName 旧用户名
 */
const finishRenameUserSpace = (oldName) => {
    renamingUsers.delete(oldName);
};
exports.finishRenameUserSpace = finishRenameUserSpace;
__exportStar(require("./data"), exports);
