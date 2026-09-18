"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const songId_1 = __importDefault(require("./songId"));
exports.default = {
    async getPicUrl(songId, tryNum = 0) {
        let requestObj = (0, request_1.httpFetch)(`http://music.migu.cn/v3/api/music/audioPlayer/getSongPic?songId=${songId}`, {
            headers: {
                Referer: 'http://music.migu.cn/v3/music/player/audio?from=migu',
            },
        });
        requestObj.promise.then(({ body }) => {
            if (body.returnCode !== '000000') {
                if (tryNum > 5)
                    return Promise.reject(new Error('图片获取失败'));
                let tryRequestObj = this.getPic(songId, ++tryNum);
                requestObj.cancelHttp = tryRequestObj.cancelHttp.bind(tryRequestObj);
                return tryRequestObj.promise;
            }
            let url = body.largePic || body.mediumPic || body.smallPic;
            if (!/https?:/.test(url))
                url = 'http:' + url;
            return url;
        });
        return requestObj;
    },
    async getPic(songInfo) {
        const songId = await (0, songId_1.default)(songInfo);
        return this.getPicUrl(songId);
    },
};
