"use strict";
// import { updateDeviceSnapshotKey } from '@main/modules/sync/data'
// import { registerListActionEvent } from '../../../utils'
// import { getCurrentListInfoKey } from '../../utils'
Object.defineProperty(exports, "__esModule", { value: true });
exports.unregisterEvent = exports.registerEvent = void 0;
// let socket: LX.Sync.Server.Socket | null
let unregisterLocalListAction;
// const sendListAction = async(wss: LX.SocketServer, action: LX.Sync.List.ActionList) => {
//   // console.log('sendListAction', action.action)
//   const key = await getCurrentListInfoKey()
//   for (const client of wss.clients) {
//     if (!client.moduleReadys?.list) continue
//     void client.remoteQueueList.onListSyncAction(action).then(() => {
//       updateDeviceSnapshotKey(client.keyInfo, key)
//     })
//   }
// }
const registerEvent = (wss) => {
    // socket = _socket
    // socket.onClose(() => {
    //   unregisterLocalListAction?.()
    //   unregisterLocalListAction = null
    // })
    // unregisterEvent()
    // unregisterLocalListAction = registerListActionEvent((action) => {
    //   void sendListAction(wss, action)
    // })
};
exports.registerEvent = registerEvent;
const unregisterEvent = () => {
    unregisterLocalListAction?.();
    unregisterLocalListAction = null;
};
exports.unregisterEvent = unregisterEvent;
