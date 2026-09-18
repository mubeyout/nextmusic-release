"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../../constants");
const user_1 = require("../../user");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const __1 = require("..");
exports.default = (dataPath, userPath) => {
    const version = (0, user_1.getVersion)();
    if (version != 1)
        return;
    console.log('数据迁移：v1 -> v2');
    for (const dir of node_fs_1.default.readdirSync(userPath)) {
        const userDir = node_path_1.default.join(userPath, dir);
        const listDir = node_path_1.default.join(userDir, constants_1.File.listDir);
        (0, __1.checkAndCreateDirSync)(listDir);
        const oldSnapshotDir = node_path_1.default.join(userDir, constants_1.File.listSnapshotDir);
        if (node_fs_1.default.existsSync(oldSnapshotDir))
            node_fs_1.default.renameSync(oldSnapshotDir, node_path_1.default.join(listDir, constants_1.File.listSnapshotDir));
        const oldSnapshotInfoPath = node_path_1.default.join(userDir, constants_1.File.listSnapshotInfoJSON);
        if (!node_fs_1.default.existsSync(oldSnapshotInfoPath))
            continue;
        const devicesInfoPath = node_path_1.default.join(userDir, constants_1.File.userDevicesJSON);
        const snapshotInfo = JSON.parse(node_fs_1.default.readFileSync(oldSnapshotInfoPath).toString());
        const devicesInfo = JSON.parse(node_fs_1.default.readFileSync(devicesInfoPath).toString());
        snapshotInfo.clients = {};
        for (const device of (Object.values(devicesInfo.clients))) {
            snapshotInfo.clients[device.clientId] = {
                snapshotKey: device.snapshotKey,
                lastSyncDate: device.lastSyncDate,
            };
            device.lastConnectDate = device.lastSyncDate;
            delete device.lastSyncDate;
            delete device.snapshotKey;
        }
        node_fs_1.default.writeFileSync(node_path_1.default.join(listDir, constants_1.File.listSnapshotInfoJSON), JSON.stringify(snapshotInfo));
        node_fs_1.default.writeFileSync(devicesInfoPath, JSON.stringify(devicesInfo));
        node_fs_1.default.unlinkSync(oldSnapshotInfoPath);
    }
    (0, user_1.setVersion)(2);
};
