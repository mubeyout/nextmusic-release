"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const tipSearch_1 = __importDefault(require("./tipSearch"));
const musicSearch_1 = __importDefault(require("./musicSearch"));
const util_1 = require("./util");
const leaderboard_1 = __importDefault(require("./leaderboard"));
const lyric_1 = __importDefault(require("./lyric"));
const pic_1 = __importDefault(require("./pic"));
const api_source_1 = require("../api-source");
const songList_1 = __importDefault(require("./songList"));
const hotSearch_1 = __importDefault(require("./hotSearch"));
const comment_1 = __importDefault(require("./comment"));
const kw = {
    _musicInfoRequestObj: null,
    _musicInfoPromiseCancelFn: null,
    _musicPicRequestObj: null,
    _musicPicPromiseCancelFn: null,
    // context: null,
    // init(context) {
    //   if (this.isInited) return
    //   this.isInited = true
    //   this.context = context
    //   // this.musicSearch.search('我又想你了').then(res => {
    //   //   console.log(res)
    //   // })
    //   // this.getMusicUrl('62355680', '320k').then(url => {
    //   //   console.log(url)
    //   // })
    // },
    tipSearch: tipSearch_1.default,
    musicSearch: musicSearch_1.default,
    leaderboard: leaderboard_1.default,
    songList: songList_1.default,
    hotSearch: hotSearch_1.default,
    comment: comment_1.default,
    getLyric(songInfo, isGetLyricx) {
        // let singer = songInfo.singer.indexOf('、') > -1 ? songInfo.singer.split('、')[0] : songInfo.singer
        return lyric_1.default.getLyric(songInfo, isGetLyricx);
    },
    handleMusicInfo(songInfo) {
        return this.getMusicInfo(songInfo).then(info => {
            // console.log(JSON.stringify(info))
            songInfo.name = info.name;
            songInfo.singer = (0, util_1.formatSinger)(info.artist);
            songInfo.img = (0, util_1.formatPic)(info.pic);
            songInfo.albumName = info.album;
            return songInfo;
            // return Object.assign({}, songInfo, {
            //   name: info.name,
            //   singer: formatSinger(info.artist),
            //   img: info.pic,
            //   albumName: info.album,
            // })
        });
    },
    getMusicUrl(songInfo, type) {
        return (0, api_source_1.apis)('kw').getMusicUrl(songInfo, type);
    },
    getMusicInfo(songInfo) {
        if (this._musicInfoRequestObj)
            this._musicInfoRequestObj.cancelHttp();
        this._musicInfoRequestObj = (0, request_1.httpFetch)(`http://www.kuwo.cn/api/www/music/musicInfo?mid=${songInfo.songmid}`);
        return this._musicInfoRequestObj.promise.then(({ body }) => {
            return body.code === 200 ? body.data : Promise.reject(new Error(body.msg));
        });
    },
    getMusicUrls(musicInfo, cb) {
        let tasks = [];
        let songId = musicInfo.songmid;
        musicInfo.types.forEach(type => {
            tasks.push(kw.getMusicUrl(songId, type.type).promise);
        });
        Promise.all(tasks).then(urlInfo => {
            let typeUrl = {};
            urlInfo.forEach(info => {
                typeUrl[info.type] = info.url;
            });
            cb(typeUrl);
        });
    },
    getPic(songInfo) {
        return pic_1.default.getPic(songInfo);
    },
    getMusicDetailPageUrl(songInfo) {
        return `http://www.kuwo.cn/play_detail/${songInfo.songmid}`;
    },
    // init() {
    //   return getToken()
    // },
};
exports.default = kw;
