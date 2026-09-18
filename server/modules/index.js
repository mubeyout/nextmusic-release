"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.featureVersion = exports.DislikeEvent = exports.DislikeManage = exports.ListEvent = exports.ListManage = exports.modules = exports.callObj = void 0;
const list_1 = require("./list");
const dislike_1 = require("./dislike");
exports.callObj = Object.assign({}, list_1.sync.handler, dislike_1.sync.handler);
exports.modules = {
    list: list_1.sync,
    dislike: dislike_1.sync,
};
var list_2 = require("./list");
Object.defineProperty(exports, "ListManage", { enumerable: true, get: function () { return list_2.ListManage; } });
Object.defineProperty(exports, "ListEvent", { enumerable: true, get: function () { return list_2.ListEvent; } });
var dislike_2 = require("./dislike");
Object.defineProperty(exports, "DislikeManage", { enumerable: true, get: function () { return dislike_2.DislikeManage; } });
Object.defineProperty(exports, "DislikeEvent", { enumerable: true, get: function () { return dislike_2.DislikeEvent; } });
exports.featureVersion = {
    list: 1,
    dislike: 1,
};
