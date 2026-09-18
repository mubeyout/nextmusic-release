"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListEvent = exports.checkUpdateList = void 0;
const user_1 = require("../../user");
const events_1 = require("events");
// import {
//   userListCreate,
//   userListsUpdate,
//   userListsRemove,
//   userListsUpdatePosition,
//   listDataOverwrite,
//   listMusicOverwrite,
//   listMusicAdd,
//   listMusicMove,
//   listMusicRemove,
//   listMusicUpdateInfo,
//   listMusicUpdatePosition,
//   listMusicClear,
// } from '@/listManage/action'
const listUpdated = () => {
    // return createSnapshot()
};
const checkUpdateList = async (changedIds) => {
    // if (!changedIds.length) return
    // await saveListMusics(changedIds.map(id => ({ id, musics: allMusicList.get(id) as LX.List.ListMusics })))
    // global.app_event.myListMusicUpdate(changedIds)
};
exports.checkUpdateList = checkUpdateList;
class ListEvent extends events_1.EventEmitter {
    list_changed() {
        this.emit('list_changed');
    }
    /**
     * 覆盖整个列表数据
     * @param listData 列表数据
     * @param isRemote 是否属于远程操作
     */
    async list_data_overwrite(userName, listData, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const oldIds = userLists.map(l => l.id)
        // const changedIds =
        await userSpace.listManage.listDataManage.listDataOverwrite(listData);
        // await updateUserList(userLists)
        // await checkUpdateList(changedIds)
        // const removedList = oldIds.filter(id => !allMusicList.has(id))
        // if (removedList.length) await removeListMusics(removedList)
        // const allListIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...userLists.map(l => l.id)]
        // if (changedIds.includes(LIST_IDS.TEMP)) allListIds.push(LIST_IDS.TEMP)
        // await saveListMusics([...allListIds.map(id => ({ id, musics: allMusicList.get(id) as LX.List.ListMusics }))])
        // global.app_event.myListMusicUpdate(changedIds)
        this.emit('list_data_overwrite', userName, listData, isRemote);
        listUpdated();
    }
    /**
     * 批量创建列表
     * @param position 列表位置
     * @param lists 列表信息
     * @param isRemote 是否属于远程操作
     */
    async list_create(userName, position, lists, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds: string[] = []
        for (const list of lists) {
            await userSpace.listManage.listDataManage.userListCreate({ ...list, position });
            // changedIds.push(list.id)
        }
        // await updateUserList(userLists)
        this.emit('list_create', userName, position, lists, isRemote);
        listUpdated();
    }
    /**
     * 批量删除列表及列表内歌曲
     * @param ids 列表ids
     * @param isRemote 是否属于远程操作
     */
    async list_remove(userName, ids, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.userListsRemove(ids);
        // await updateUserList(userLists)
        // await removeListMusics(ids)
        this.emit('list_remove', userName, ids, isRemote);
        listUpdated();
        // global.app_event.myListMusicUpdate(changedIds)
    }
    /**
     * 批量更新列表信息
     * @param lists 列表信息
     * @param isRemote 是否属于远程操作
     */
    async list_update(userName, lists, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        await userSpace.listManage.listDataManage.userListsUpdate(lists);
        // await updateUserList(userLists)
        this.emit('list_update', userName, lists, isRemote);
        listUpdated();
    }
    /**
     * 批量更新列表位置
     * @param position 列表位置
     * @param ids 列表ids
     * @param isRemote 是否属于远程操作
     */
    async list_update_position(userName, position, ids, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        await userSpace.listManage.listDataManage.userListsUpdatePosition(position, ids);
        // await updateUserList(userLists)
        this.emit('list_update_position', userName, position, ids, isRemote);
        listUpdated();
    }
    /**
     * 覆盖列表内歌曲
     * @param listId 列表id
     * @param musicInfos 音乐信息
     * @param isRemote 是否属于远程操作
     */
    async list_music_overwrite(userName, listId, musicInfos, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicOverwrite(listId, musicInfos);
        // await checkUpdateList(changedIds)
        this.emit('list_music_overwrite', userName, listId, musicInfos, isRemote);
        listUpdated();
    }
    /**
     * 批量添加歌曲到列表
     * @param listId 列表id
     * @param musicInfos 添加的歌曲信息
     * @param addMusicLocationType 添加在到列表的位置
     * @param isRemote 是否属于远程操作
     */
    async list_music_add(userName, listId, musicInfos, addMusicLocationType, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicAdd(listId, musicInfos, addMusicLocationType);
        // await checkUpdateList(changedIds)
        this.emit('list_music_add', userName, listId, musicInfos, addMusicLocationType, isRemote);
        listUpdated();
    }
    /**
     * 批量移动歌曲
     * @param fromId 源列表id
     * @param toId 目标列表id
     * @param musicInfos 移动的歌曲信息
     * @param addMusicLocationType 添加在到列表的位置
     * @param isRemote 是否属于远程操作
     */
    async list_music_move(userName, fromId, toId, musicInfos, addMusicLocationType, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicMove(fromId, toId, musicInfos, addMusicLocationType);
        // await checkUpdateList(changedIds)
        this.emit('list_music_move', userName, fromId, toId, musicInfos, addMusicLocationType, isRemote);
        listUpdated();
    }
    /**
     * 批量移除歌曲
     * @param listId
     * @param listId 列表Id
     * @param ids 要删除歌曲的id
     * @param isRemote 是否属于远程操作
     */
    async list_music_remove(userName, listId, ids, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicRemove(listId, ids);
        // console.log(changedIds)
        // await checkUpdateList(changedIds)
        this.emit('list_music_remove', userName, listId, ids, isRemote);
        listUpdated();
    }
    /**
     * 批量更新歌曲信息
     * @param musicInfos 歌曲&列表信息
     * @param isRemote 是否属于远程操作
     */
    async list_music_update(userName, musicInfos, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicUpdateInfo(musicInfos);
        // await checkUpdateList(changedIds)
        this.emit('list_music_update', userName, musicInfos, isRemote);
        listUpdated();
    }
    /**
     * 清空列表内的歌曲
     * @param ids 列表Id
     * @param isRemote 是否属于远程操作
     */
    async list_music_clear(userName, ids, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicClear(ids);
        // await checkUpdateList(changedIds)
        this.emit('list_music_clear', userName, ids, isRemote);
        listUpdated();
    }
    /**
     * 批量更新歌曲位置
     * @param listId 列表ID
     * @param position 新位置
     * @param ids 歌曲id
     * @param isRemote 是否属于远程操作
     */
    async list_music_update_position(userName, listId, position, ids, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.listManage.listDataManage.listMusicUpdatePosition(listId, position, ids);
        // await checkUpdateList(changedIds)
        this.emit('list_music_update_position', userName, listId, position, ids, isRemote);
        listUpdated();
    }
}
exports.ListEvent = ListEvent;
