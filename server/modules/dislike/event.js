"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DislikeEvent = exports.checkUpdateDislike = void 0;
const user_1 = require("../../user");
const events_1 = require("events");
// import {
//   userDislikeCreate,
//   userDislikesUpdate,
//   userDislikesRemove,
//   userDislikesUpdatePosition,
//   dislikeDataOverwrite,
//   dislikeMusicOverwrite,
//   dislikeMusicAdd,
//   dislikeMusicMove,
//   dislikeMusicRemove,
//   dislikeMusicUpdateInfo,
//   dislikeMusicUpdatePosition,
//   dislikeMusicClear,
// } from '@/dislikeManage/action'
const dislikeUpdated = () => {
    // return createSnapshot()
};
const checkUpdateDislike = async (changedIds) => {
    // if (!changedIds.length) return
    // await saveDislikeMusics(changedIds.map(id => ({ id, musics: allMusicDislike.get(id) as LX.Dislike.DislikeMusics })))
    // global.app_event.myDislikeMusicUpdate(changedIds)
};
exports.checkUpdateDislike = checkUpdateDislike;
class DislikeEvent extends events_1.EventEmitter {
    dislike_changed() {
        this.emit('dislike_changed');
    }
    /**
     * 覆盖整个列表数据
     * @param dislikeData 列表数据
     * @param isRemote 是否属于远程操作
     */
    async dislike_data_overwrite(userName, dislikeData, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        await userSpace.dislikeManage.dislikeDataManage.overwirteDislikeInfo(dislikeData);
        this.emit('dislike_data_overwrite', userName, dislikeData, isRemote);
        dislikeUpdated();
    }
    /**
     * 批量添加歌曲到列表
     * @param dislikeId 列表id
     * @param musicInfos 添加的歌曲信息
     * @param addMusicLocationType 添加在到列表的位置
     * @param isRemote 是否属于远程操作
     */
    async dislike_music_add(userName, musicInfo, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.dislikeManage.dislikeDataManage.addDislikeInfo(musicInfo);
        // await checkUpdateDislike(changedIds)
        this.emit('dislike_music_add', userName, musicInfo, isRemote);
        dislikeUpdated();
    }
    /**
     * 清空列表内的歌曲
     * @param ids 列表Id
     * @param isRemote 是否属于远程操作
     */
    async dislike_music_clear(userName, isRemote = false) {
        const userSpace = (0, user_1.getUserSpace)(userName);
        // const changedIds =
        await userSpace.dislikeManage.dislikeDataManage.overwirteDislikeInfo('');
        // await checkUpdateDislike(changedIds)
        this.emit('dislike_music_clear', userName, isRemote);
        dislikeUpdated();
    }
}
exports.DislikeEvent = DislikeEvent;
