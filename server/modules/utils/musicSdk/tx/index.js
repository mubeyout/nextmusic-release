"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const leaderboard_1 = __importDefault(require("./leaderboard"));
const lyric_1 = __importDefault(require("./lyric"));
const songList_1 = __importDefault(require("./songList"));
const musicSearch_1 = __importDefault(require("./musicSearch"));
const api_source_1 = require("../api-source");
const hotSearch_1 = __importDefault(require("./hotSearch"));
const comment_1 = __importDefault(require("./comment"));
const tipSearch_1 = __importDefault(require("./tipSearch"));
const extendDetail_1 = __importDefault(require("./extendDetail"));
const extendSearch_1 = __importDefault(require("./extendSearch"));
const userPlaylist_1 = __importDefault(require("./userPlaylist"));
const tx = {
    tipSearch: tipSearch_1.default,
    leaderboard: leaderboard_1.default,
    songList: songList_1.default,
    userPlaylist: userPlaylist_1.default,
    musicSearch: musicSearch_1.default,
    extendSearch: extendSearch_1.default,
    extendDetail: extendDetail_1.default,
    hotSearch: hotSearch_1.default,
    comment: comment_1.default,
    getMusicUrl(songInfo, type) {
        return (0, api_source_1.apis)('tx').getMusicUrl(songInfo, type);
    },
    getLyric(songInfo) {
        // let singer = songInfo.singer.indexOf('、') > -1 ? songInfo.singer.split('、')[0] : songInfo.singer
        return lyric_1.default.getLyric(songInfo);
    },
    async getPic(songInfo) {
        return `https://y.gtimg.cn/music/photo_new/T002R800x800M000${songInfo.albumId}.jpg`;
    },
    getMusicDetailPageUrl(songInfo) {
        return `https://y.qq.com/n/yqq/song/${songInfo.songmid}.html`;
    },
};
exports.default = tx;
