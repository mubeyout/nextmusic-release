"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const leaderboard_1 = __importDefault(require("./leaderboard"));
const api_source_1 = require("../api-source"); // 现在已适配服务器端
const songList_1 = __importDefault(require("./songList"));
const musicSearch_1 = __importDefault(require("./musicSearch"));
const pic_1 = __importDefault(require("./pic"));
const lyric_1 = __importDefault(require("./lyric"));
const hotSearch_1 = __importDefault(require("./hotSearch"));
const comment_1 = __importDefault(require("./comment"));
const tipSearch_1 = __importDefault(require("./tipSearch"));
const kg = {
    tipSearch: tipSearch_1.default,
    leaderboard: leaderboard_1.default,
    songList: songList_1.default,
    musicSearch: musicSearch_1.default,
    hotSearch: hotSearch_1.default,
    comment: comment_1.default,
    getMusicUrl(songInfo, type) {
        // 使用 api-source 获取 API（优先自定义源）
        return (0, api_source_1.apis)('kg').getMusicUrl(songInfo, type);
    },
    getLyric(songInfo) {
        return lyric_1.default.getLyric(songInfo);
    },
    // getLyric(songInfo) {
    //   return apis('kg').getLyric(songInfo)
    // },
    getPic(songInfo) {
        return pic_1.default.getPic(songInfo);
    },
    getMusicDetailPageUrl(songInfo) {
        return `https://www.kugou.com/song/#hash=${songInfo.hash}&album_id=${songInfo.albumId}`;
    },
    // getPic(songInfo) {
    //   return apis('kg').getPic(songInfo)
    // },
};
exports.default = kg;
