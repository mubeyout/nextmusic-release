"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const leaderboard_1 = __importDefault(require("./leaderboard"));
const api_source_1 = require("../api-source");
const lyric_1 = __importDefault(require("./lyric"));
const musicInfo_1 = __importDefault(require("./musicInfo"));
const musicSearch_1 = __importDefault(require("./musicSearch"));
const extendSearch_1 = __importDefault(require("./extendSearch"));
const extendDetail_1 = __importDefault(require("./extendDetail"));
const songList_1 = __importDefault(require("./songList"));
const hotSearch_1 = __importDefault(require("./hotSearch"));
const comment_1 = __importDefault(require("./comment"));
const tipSearch_1 = __importDefault(require("./tipSearch"));
const wy = {
    tipSearch: tipSearch_1.default,
    leaderboard: leaderboard_1.default,
    musicSearch: musicSearch_1.default,
    extendSearch: extendSearch_1.default,
    extendDetail: extendDetail_1.default,
    songList: songList_1.default,
    hotSearch: hotSearch_1.default,
    comment: comment_1.default,
    getMusicUrl(songInfo, type) {
        return (0, api_source_1.apis)('wy').getMusicUrl(songInfo, type);
    },
    getLyric(songInfo) {
        return (0, lyric_1.default)(songInfo.songmid);
    },
    getPic(songInfo) {
        const requestObj = (0, musicInfo_1.default)(songInfo.songmid);
        return requestObj.promise.then(info => info.al.picUrl);
    },
    getMusicDetailPageUrl(songInfo) {
        return `https://music.163.com/#/song?id=${songInfo.songmid}`;
    },
};
exports.default = wy;
