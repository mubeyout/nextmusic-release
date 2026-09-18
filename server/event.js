"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createModuleEvent = void 0;
// import { Event as App, type Type as AppType } from './AppEvent'
const modules_1 = require("./modules");
// export const createAppEvent = (): AppType => {
//   return new App()
// }
const createModuleEvent = () => {
    global.event_list = new modules_1.ListEvent();
    global.event_dislike = new modules_1.DislikeEvent();
};
exports.createModuleEvent = createModuleEvent;
