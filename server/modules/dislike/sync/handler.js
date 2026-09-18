"use strict";
// 这个文件导出的方法将暴露给客户端调用，第一个参数固定为当前 socket 对象
Object.defineProperty(exports, "__esModule", { value: true });
// import { sendSyncActionList } from '@main/modules/winMain'
// import { SYNC_CLOSE_CODE } from '../../../constants'
const constants_1 = require("../../../constants");
const user_1 = require("../../../user");
// import { encryptMsg } from '../../../utils/tools'
// let wss: LX.SocketServer | null
// let removeListener: (() => void) | null
// type listAction = 'list:action'
const handleListAction = async (userName, param) => {
    console.log('handleListAction', userName, param.action);
    switch (param.action) {
        case 'dislike_data_overwrite':
            await global.event_dislike.dislike_data_overwrite(userName, param.data, true);
            break;
        case 'dislike_music_add':
            await global.event_dislike.dislike_music_add(userName, param.data, true);
            break;
        case 'dislike_music_clear':
            await global.event_dislike.dislike_music_clear(userName, true);
            break;
        default:
            throw new Error('unknown dislike sync action');
    }
    const userSpace = (0, user_1.getUserSpace)(userName);
    let key = userSpace.dislikeManage.createSnapshot();
    return key;
};
const handler = {
    async onDislikeSyncAction(socket, action) {
        if (!socket.moduleReadys?.dislike)
            return;
        const key = await handleListAction(socket.userInfo.name, action);
        console.log(key);
        const userSpace = (0, user_1.getUserSpace)(socket.userInfo.name);
        await userSpace.dislikeManage.updateDeviceSnapshotKey(socket.keyInfo.clientId, key);
        const currentUserName = socket.userInfo.name;
        const currentId = socket.keyInfo.clientId;
        socket.broadcast((client) => {
            if (client.keyInfo.clientId == currentId || !client.moduleReadys?.dislike || client.userInfo.name != currentUserName)
                return;
            void client.remoteQueueDislike.onDislikeSyncAction(action).then(async () => {
                return userSpace.dislikeManage.updateDeviceSnapshotKey(client.keyInfo.clientId, key);
            }).catch(err => {
                // TODO send status
                client.close(constants_1.SYNC_CLOSE_CODE.failed);
                // client.moduleReadys.dislike = false
                console.log(err.message);
            });
        });
    },
};
exports.default = handler;
