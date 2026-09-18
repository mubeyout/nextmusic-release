"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DislikeManage = void 0;
const snapshotDataManage_1 = require("./snapshotDataManage");
const dislikeDataManage_1 = require("./dislikeDataManage");
const utils_1 = require("../../utils");
class DislikeManage {
    snapshotDataManage;
    dislikeDataManage;
    constructor(userDataManage) {
        this.snapshotDataManage = new snapshotDataManage_1.SnapshotDataManage(userDataManage);
        this.dislikeDataManage = new dislikeDataManage_1.DislikeDataManage(this.snapshotDataManage);
    }
    createSnapshot = async () => {
        const listData = await this.getDislikeRules();
        const md5 = (0, utils_1.toMD5)(listData.trim());
        const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo();
        console.log(md5, snapshotInfo.latest);
        if (snapshotInfo.latest == md5)
            return md5;
        if (snapshotInfo.list.includes(md5)) {
            snapshotInfo.list.splice(snapshotInfo.list.indexOf(md5), 1);
        }
        else
            await this.snapshotDataManage.saveSnapshot(md5, listData);
        if (snapshotInfo.latest)
            snapshotInfo.list.unshift(snapshotInfo.latest);
        snapshotInfo.latest = md5;
        snapshotInfo.time = Date.now();
        this.snapshotDataManage.saveSnapshotInfo(snapshotInfo);
        return md5;
    };
    getCurrentListInfoKey = async () => {
        const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo();
        if (snapshotInfo.latest)
            return snapshotInfo.latest;
        // snapshotInfo.latest = toMD5((await this.getDislikeRules()).trim())
        // this.snapshotDataManage.saveSnapshotInfo(snapshotInfo)
        return this.createSnapshot();
    };
    getDeviceCurrentSnapshotKey = async (clientId) => {
        return this.snapshotDataManage.getDeviceCurrentSnapshotKey(clientId);
    };
    updateDeviceSnapshotKey = async (clientId, key) => {
        await this.snapshotDataManage.updateDeviceSnapshotKey(clientId, key);
    };
    removeDevice = async (clientId) => {
        this.snapshotDataManage.removeSnapshotInfo(clientId);
    };
    getDislikeRules = async () => {
        return await this.dislikeDataManage.getDislikeRules();
    };
}
exports.DislikeManage = DislikeManage;
