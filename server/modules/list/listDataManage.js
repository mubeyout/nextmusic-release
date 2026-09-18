"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListDataManage = void 0;
const common_1 = require("../../utils/common");
const constants_1 = require("../../constants");
class ListDataManage {
    snapshotDataManage;
    userLists = [];
    allMusicList = new Map();
    initPromise;
    constructor(snapshotDataManage) {
        this.snapshotDataManage = snapshotDataManage;
        let listData;
        this.initPromise = this.snapshotDataManage.getSnapshotInfo().then(async (snapshotInfo) => {
            if (snapshotInfo.latest)
                listData = await this.snapshotDataManage.getSnapshot(snapshotInfo.latest);
            if (!listData)
                listData = { defaultList: [], loveList: [], userList: [] };
            this.allMusicList.set(constants_1.LIST_IDS.DEFAULT, listData.defaultList);
            this.allMusicList.set(constants_1.LIST_IDS.LOVE, listData.loveList);
            this.userLists.push(...listData.userList.map(({ list, ...l }) => {
                this.allMusicList.set(l.id, list);
                return l;
            }));
        });
    }
    restore = async (listData) => {
        this.allMusicList.clear();
        this.userLists = [];
        this.allMusicList.set(constants_1.LIST_IDS.DEFAULT, listData.defaultList);
        this.allMusicList.set(constants_1.LIST_IDS.LOVE, listData.loveList);
        this.userLists.push(...listData.userList.map(({ list, ...l }) => {
            this.allMusicList.set(l.id, list);
            return l;
        }));
    };
    getListData = async () => {
        await this.initPromise;
        return {
            defaultList: this.allMusicList.get(constants_1.LIST_IDS.DEFAULT) ?? [],
            loveList: this.allMusicList.get(constants_1.LIST_IDS.LOVE) ?? [],
            userList: this.userLists.map(l => ({ ...l, list: this.allMusicList.get(l.id) ?? [] })),
        };
    };
    setUserLists = (lists) => {
        this.userLists.splice(0, this.userLists.length, ...lists);
        return this.userLists;
    };
    setMusicList = (listId, musicList) => {
        this.allMusicList.set(listId, musicList);
        return musicList;
    };
    removeMusicList = (id) => {
        this.allMusicList.delete(id);
    };
    createUserList = ({ name, id, source, sourceListId, locationUpdateTime, }, position) => {
        if (position < 0 || position >= this.userLists.length) {
            this.userLists.push({
                name,
                id,
                source,
                sourceListId,
                locationUpdateTime,
            });
        }
        else {
            this.userLists.splice(position, 0, {
                name,
                id,
                source,
                sourceListId,
                locationUpdateTime,
            });
        }
    };
    updateList = ({ name, id, source, sourceListId, 
    // meta,
    locationUpdateTime, }) => {
        let targetList;
        switch (id) {
            case constants_1.LIST_IDS.DEFAULT:
            case constants_1.LIST_IDS.LOVE:
                break;
            case constants_1.LIST_IDS.TEMP:
            //   tempList.meta = meta ?? {}
            // break
            default:
                targetList = this.userLists.find(l => l.id == id);
                if (!targetList)
                    return;
                targetList.name = name;
                targetList.source = source;
                targetList.sourceListId = sourceListId;
                targetList.locationUpdateTime = locationUpdateTime;
                break;
        }
    };
    removeUserList = (id) => {
        const index = this.userLists.findIndex(l => l.id == id);
        if (index < 0)
            return;
        this.userLists.splice(index, 1);
        // removeMusicList(id)
    };
    overwriteUserList = (lists) => {
        this.userLists.splice(0, this.userLists.length, ...lists);
    };
    // const sendMyListUpdateEvent = (ids: string[]) => {
    //   window.app_event.myListUpdate(ids)
    // }
    listDataOverwrite = async ({ defaultList, loveList, userList, tempList }) => {
        const updatedListIds = [];
        const newUserIds = [];
        const newUserListInfos = userList.map(({ list, ...listInfo }) => {
            if (this.allMusicList.has(listInfo.id))
                updatedListIds.push(listInfo.id);
            newUserIds.push(listInfo.id);
            this.setMusicList(listInfo.id, list);
            return listInfo;
        });
        for (const list of this.userLists) {
            if (!this.allMusicList.has(list.id) || newUserIds.includes(list.id))
                continue;
            this.removeMusicList(list.id);
            updatedListIds.push(list.id);
        }
        this.overwriteUserList(newUserListInfos);
        if (this.allMusicList.has(constants_1.LIST_IDS.DEFAULT))
            updatedListIds.push(constants_1.LIST_IDS.DEFAULT);
        this.setMusicList(constants_1.LIST_IDS.DEFAULT, defaultList);
        this.setMusicList(constants_1.LIST_IDS.LOVE, loveList);
        updatedListIds.push(constants_1.LIST_IDS.LOVE);
        if (tempList && this.allMusicList.has(constants_1.LIST_IDS.TEMP)) {
            this.setMusicList(constants_1.LIST_IDS.TEMP, tempList);
            updatedListIds.push(constants_1.LIST_IDS.TEMP);
        }
        const newIds = [constants_1.LIST_IDS.DEFAULT, constants_1.LIST_IDS.LOVE, ...userList.map(l => l.id)];
        if (tempList)
            newIds.push(constants_1.LIST_IDS.TEMP);
        // void overwriteListPosition(newIds)
        // void overwriteListUpdateInfo(newIds)
        return updatedListIds;
    };
    userListCreate = async ({ name, id, source, sourceListId, position, locationUpdateTime }) => {
        if (this.userLists.some(item => item.id == id))
            return;
        const newList = {
            name,
            id,
            source,
            sourceListId,
            locationUpdateTime,
        };
        this.createUserList(newList, position);
    };
    userListsRemove = async (ids) => {
        const changedIds = [];
        for (const id of ids) {
            this.removeUserList(id);
            // removeListPosition(id)
            // removeListUpdateInfo(id)
            if (!this.allMusicList.has(id))
                continue;
            this.removeMusicList(id);
            changedIds.push(id);
        }
        return changedIds;
    };
    userListsUpdate = async (listInfos) => {
        for (const info of listInfos) {
            this.updateList(info);
        }
    };
    userListsUpdatePosition = async (position, ids) => {
        const newUserLists = [...this.userLists];
        // console.log(position, ids)
        const updateLists = [];
        // const targetItem = list[position]
        const map = new Map();
        for (const item of newUserLists)
            map.set(item.id, item);
        for (const id of ids) {
            const listInfo = map.get(id);
            listInfo.locationUpdateTime = Date.now();
            updateLists.push(listInfo);
            map.delete(id);
        }
        newUserLists.splice(0, newUserLists.length, ...newUserLists.filter(mInfo => map.has(mInfo.id)));
        newUserLists.splice(Math.min(position, newUserLists.length), 0, ...updateLists);
        this.setUserLists(newUserLists);
    };
    /**
     * 获取列表内的歌曲
     * @param listId
     */
    getListMusics = async (listId) => {
        if (!listId || !this.allMusicList.has(listId))
            return [];
        return this.allMusicList.get(listId);
    };
    listMusicOverwrite = async (listId, musicInfos) => {
        this.setMusicList(listId, musicInfos);
        return [listId];
    };
    listMusicAdd = async (id, musicInfos, addMusicLocationType) => {
        const targetList = await this.getListMusics(id);
        const listSet = new Set();
        for (const item of targetList)
            listSet.add(item.id);
        musicInfos = musicInfos.filter(item => {
            if (listSet.has(item.id))
                return false;
            listSet.add(item.id);
            return true;
        });
        switch (addMusicLocationType) {
            case 'top':
                (0, common_1.arrUnshift)(targetList, musicInfos);
                break;
            case 'bottom':
            default:
                (0, common_1.arrPush)(targetList, musicInfos);
                break;
        }
        this.setMusicList(id, targetList);
        return [id];
    };
    listMusicRemove = async (listId, ids) => {
        let targetList = await this.getListMusics(listId);
        const listSet = new Set();
        for (const item of targetList)
            listSet.add(item.id);
        for (const id of ids)
            listSet.delete(id);
        const newList = targetList.filter(mInfo => listSet.has(mInfo.id));
        targetList.splice(0, targetList.length);
        (0, common_1.arrPush)(targetList, newList);
        return [listId];
    };
    listMusicMove = async (fromId, toId, musicInfos, addMusicLocationType) => {
        return [
            ...await this.listMusicRemove(fromId, musicInfos.map(musicInfo => musicInfo.id)),
            ...await this.listMusicAdd(toId, musicInfos, addMusicLocationType),
        ];
    };
    listMusicUpdateInfo = async (musicInfos) => {
        const updateListIds = new Set();
        for (const { id, musicInfo } of musicInfos) {
            const targetList = await this.getListMusics(id);
            if (!targetList.length)
                continue;
            const index = targetList.findIndex(l => l.id == musicInfo.id);
            if (index < 0)
                continue;
            const info = { ...targetList[index] };
            // console.log(musicInfo)
            Object.assign(info, {
                name: musicInfo.name,
                singer: musicInfo.singer,
                source: musicInfo.source,
                interval: musicInfo.interval,
                meta: musicInfo.meta,
            });
            targetList.splice(index, 1, info);
            updateListIds.add(id);
        }
        return Array.from(updateListIds);
    };
    listMusicUpdatePosition = async (listId, position, ids) => {
        let targetList = await this.getListMusics(listId);
        // const infos = Array(ids.length)
        // for (let i = targetList.length; i--;) {
        //   const item = targetList[i]
        //   const index = ids.indexOf(item.id)
        //   if (index < 0) continue
        //   infos.splice(index, 1, targetList.splice(i, 1)[0])
        // }
        // targetList.splice(Math.min(position, targetList.length - 1), 0, ...infos)
        // console.time('ts')
        // const list = createSortedList(targetList, position, ids)
        const infos = [];
        const map = new Map();
        for (const item of targetList)
            map.set(item.id, item);
        for (const id of ids) {
            infos.push(map.get(id));
            map.delete(id);
        }
        const list = targetList.filter(mInfo => map.has(mInfo.id));
        (0, common_1.arrPushByPosition)(list, infos, Math.min(position, list.length));
        targetList.splice(0, targetList.length);
        (0, common_1.arrPush)(targetList, list);
        // console.timeEnd('ts')
        return [listId];
    };
    listMusicClear = async (ids) => {
        const changedIds = [];
        for (const id of ids) {
            const list = await this.getListMusics(id);
            if (!list.length)
                continue;
            this.setMusicList(id, []);
            changedIds.push(id);
        }
        return changedIds;
    };
}
exports.ListDataManage = ListDataManage;
