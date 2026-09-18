"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const leaderboard_1 = __importDefault(require("./leaderboard"));
const api_source_1 = require("../api-source");
const musicInfo_1 = __importDefault(require("./musicInfo"));
const songList_1 = __importDefault(require("./songList"));
const request_1 = require("../../request");
const musicSearch_1 = __importDefault(require("./musicSearch"));
const hotSearch_1 = __importDefault(require("./hotSearch"));
const bd = {
    leaderboard: leaderboard_1.default,
    songList: songList_1.default,
    musicSearch: musicSearch_1.default,
    hotSearch: hotSearch_1.default,
    getMusicUrl(songInfo, type) {
        return (0, api_source_1.apis)('bd').getMusicUrl(songInfo, type);
    },
    getPic(songInfo) {
        const requestObj = this.getMusicInfo(songInfo);
        return requestObj.promise.then(info => info.pic_premium);
    },
    getLyric(songInfo) {
        const requestObj = this.getMusicInfo(songInfo);
        requestObj.promise = requestObj.promise.then(info => (0, request_1.httpFetch)(info.lrclink).promise.then(resp => ({ lyric: resp.body, tlyric: '' })));
        return requestObj;
    },
    // getLyric(songInfo) {
    //   return apis('bd').getLyric(songInfo)
    // },
    // getPic(songInfo) {
    //   return apis('bd').getPic(songInfo)
    // },
    getMusicInfo(songInfo) {
        return musicInfo_1.default.getMusicInfo(songInfo.songmid);
    },
    getMusicDetailPageUrl(songInfo) {
        return `http://music.taihe.com/song/${songInfo.songmid}`;
    },
};
exports.default = bd;
