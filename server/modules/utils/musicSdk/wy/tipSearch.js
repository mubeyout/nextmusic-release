"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const crypto_1 = require("./utils/crypto");
const utils_1 = require("../utils");
exports.default = {
    requestObj: null,
    cancelTipSearch() {
        if (this.requestObj && this.requestObj.cancelHttp)
            this.requestObj.cancelHttp();
    },
    tipSearchBySong(str) {
        this.cancelTipSearch();
        this.requestObj = (0, request_1.httpFetch)('https://music.163.com/weapi/search/suggest/web', {
            method: 'POST',
            headers: {
                referer: 'https://music.163.com/',
                origin: 'https://music.163.com/',
            },
            form: (0, crypto_1.weapi)({
                s: str,
            }),
        });
        return this.requestObj.promise.then(({ statusCode, body }) => {
            if (statusCode != 200 || body.code != 200)
                return Promise.reject(new Error('请求失败'));
            return body.result.songs;
        });
    },
    handleResult(rawData) {
        return rawData.map(info => `${info.name} - ${(0, utils_1.formatSingerName)(info.artists, 'name')}`);
    },
    async search(str) {
        return this.tipSearchBySong(str).then(result => this.handleResult(result));
    },
};
