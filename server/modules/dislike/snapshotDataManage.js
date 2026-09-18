"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotDataManage = void 0;
const common_1 = require("../../utils/common");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const log4js_1 = require("../../utils/log4js");
const utils_1 = require("../../utils");
const data_1 = require("../../user/data");
const constants_1 = require("../../constants");
class SnapshotDataManage {
    userDataManage;
    dislikeDir;
    snapshotDir;
    snapshotInfoFilePath;
    snapshotInfo;
    clientSnapshotKeys;
    saveSnapshotInfoThrottle;
    isIncluedsDevice = (key) => {
        return this.clientSnapshotKeys.includes(key);
    };
    clearOldSnapshot = async () => {
        if (!this.snapshotInfo)
            return;
        const snapshotList = this.snapshotInfo.list.filter(key => !this.isIncluedsDevice(key));
        // console.log(snapshotList.length, lx.config.maxSnapshotNum)
        const userMaxSnapshotNum = (0, data_1.getUserConfig)(this.userDataManage.userName).maxSnapshotNum;
        let requiredSave = snapshotList.length > userMaxSnapshotNum;
        while (snapshotList.length > userMaxSnapshotNum) {
            const name = snapshotList.pop();
            if (name) {
                await this.removeSnapshot(name);
                this.snapshotInfo.list.splice(this.snapshotInfo.list.indexOf(name), 1);
            }
            else
                break;
        }
        if (requiredSave)
            this.saveSnapshotInfo(this.snapshotInfo);
    };
    updateDeviceSnapshotKey = async (clientId, key) => {
        // console.log('updateDeviceSnapshotKey', key)
        let client = this.snapshotInfo.clients[clientId];
        if (!client)
            client = this.snapshotInfo.clients[clientId] = { snapshotKey: '', lastSyncDate: 0 };
        if (client.snapshotKey)
            this.clientSnapshotKeys.splice(this.clientSnapshotKeys.indexOf(client.snapshotKey), 1);
        client.snapshotKey = key;
        client.lastSyncDate = Date.now();
        this.clientSnapshotKeys.push(key);
        this.saveSnapshotInfoThrottle();
    };
    getDeviceCurrentSnapshotKey = async (clientId) => {
        // console.log('updateDeviceSnapshotKey', key)
        const client = this.snapshotInfo.clients[clientId];
        return client?.snapshotKey;
    };
    getSnapshotInfo = async () => {
        return this.snapshotInfo;
    };
    saveSnapshotInfo = (info) => {
        this.snapshotInfo = info;
        this.saveSnapshotInfoThrottle();
    };
    removeSnapshotInfo = (clientId) => {
        let client = this.snapshotInfo.clients[clientId];
        if (!client)
            return;
        if (client.snapshotKey)
            this.clientSnapshotKeys.splice(this.clientSnapshotKeys.indexOf(client.snapshotKey), 1);
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.snapshotInfo.clients[clientId];
        this.saveSnapshotInfoThrottle();
    };
    getSnapshot = async (name) => {
        const filePath = node_path_1.default.join(this.snapshotDir, `snapshot_${name}`);
        let listData;
        try {
            listData = (await node_fs_1.default.promises.readFile(filePath)).toString('utf-8');
        }
        catch (err) {
            log4js_1.syncLog.warn(err);
            return null;
        }
        return listData;
    };
    saveSnapshot = async (name, data) => {
        log4js_1.syncLog.info('saveSnapshot', this.userDataManage.userName, name);
        const filePath = node_path_1.default.join(this.snapshotDir, `snapshot_${name}`);
        try {
            node_fs_1.default.writeFileSync(filePath, data);
        }
        catch (err) {
            log4js_1.syncLog.error(err);
            throw err;
        }
    };
    removeSnapshot = async (name) => {
        log4js_1.syncLog.info('removeSnapshot', this.userDataManage.userName, name);
        const filePath = node_path_1.default.join(this.snapshotDir, `snapshot_${name}`);
        try {
            node_fs_1.default.unlinkSync(filePath);
        }
        catch (err) {
            log4js_1.syncLog.error(err);
        }
    };
    constructor(userDataManage) {
        this.userDataManage = userDataManage;
        this.dislikeDir = node_path_1.default.join(userDataManage.userDir, constants_1.File.dislikeDir);
        (0, utils_1.checkAndCreateDirSync)(this.dislikeDir);
        this.snapshotDir = node_path_1.default.join(this.dislikeDir, constants_1.File.dislikeSnapshotDir);
        (0, utils_1.checkAndCreateDirSync)(this.snapshotDir);
        this.snapshotInfoFilePath = node_path_1.default.join(this.dislikeDir, constants_1.File.dislikeSnapshotInfoJSON);
        this.snapshotInfo = node_fs_1.default.existsSync(this.snapshotInfoFilePath)
            ? JSON.parse(node_fs_1.default.readFileSync(this.snapshotInfoFilePath).toString())
            : { latest: null, time: 0, list: [], clients: {} };
        this.saveSnapshotInfoThrottle = (0, common_1.throttle)(() => {
            node_fs_1.default.writeFile(this.snapshotInfoFilePath, JSON.stringify(this.snapshotInfo), 'utf8', (err) => {
                if (err)
                    console.error(err);
                void this.clearOldSnapshot();
            });
        });
        this.clientSnapshotKeys = Object.values(this.snapshotInfo.clients).map(device => device.snapshotKey).filter(k => k);
    }
}
exports.SnapshotDataManage = SnapshotDataManage;
// type UserDataManages = Map<string, UserDataManage>
// export const createUserDataManage = (user: LX.UserConfig) => {
//   const manage = Object.create(userDataManage) as typeof userDataManage
//   manage.userDir = user.dataPath
// }
