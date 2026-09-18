"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListManage = void 0;
const snapshotDataManage_1 = require("./snapshotDataManage");
const listDataManage_1 = require("./listDataManage");
const utils_1 = require("../../utils");
class ListManage {
    snapshotDataManage;
    listDataManage;
    constructor(userDataManage) {
        this.snapshotDataManage = new snapshotDataManage_1.SnapshotDataManage(userDataManage);
        this.listDataManage = new listDataManage_1.ListDataManage(this.snapshotDataManage);
    }
    createSnapshot = async () => {
        const listData = JSON.stringify(await this.getListData());
        const md5 = (0, utils_1.toMD5)(listData);
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
        // snapshotInfo.latest = toMD5(JSON.stringify(await this.getListData()))
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
    getListData = async () => {
        return await this.listDataManage.getListData();
    };
    getSnapshotList = async () => {
        return this.snapshotDataManage.getSnapshotListWithMeta();
    };
    getSnapshot = async (name) => {
        return this.snapshotDataManage.getSnapshot(name);
    };
    restoreSnapshot = async (name) => {
        const listData = await this.snapshotDataManage.getSnapshot(name);
        if (!listData)
            throw new Error('Snapshot not found');
        await this.listDataManage.restore(listData);
        this.snapshotDataManage.clearClients();
        this.snapshotDataManage.setLatest(name);
    };
    removeSnapshot = async (name) => {
        await this.snapshotDataManage.removeSnapshot(name);
    };
    saveSnapshotWithTime = async (name, data, time) => {
        await this.snapshotDataManage.saveSnapshotWithTime(name, data, time);
    };
}
exports.ListManage = ListManage;
