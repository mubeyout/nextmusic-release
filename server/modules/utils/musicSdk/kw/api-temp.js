"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const message_1 = require("../../message");
const options_1 = require("../options");
const utils_1 = require("../utils");
const api_temp = {
    getMusicUrl(songInfo, type) {
        const requestObj = (0, request_1.httpFetch)(`http://tm.tempmusics.tk/url/kw/${songInfo.songmid}/${type}`, {
            method: 'get',
            headers: options_1.headers,
            timeout: options_1.timeout,
            lookup: utils_1.dnsLookup,
            family: 4,
        });
        requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
            if (statusCode == 429)
                return Promise.reject(new Error(message_1.requestMsg.tooManyRequests));
            switch (body.code) {
                case 0: return Promise.resolve({ type, url: body.data });
                default: return Promise.reject(new Error(body.msg));
            }
        });
        return requestObj;
    },
};
exports.default = api_temp;
