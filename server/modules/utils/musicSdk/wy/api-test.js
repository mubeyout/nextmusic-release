"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const message_1 = require("../../message");
const options_1 = require("../options");
const utils_1 = require("../utils");
const api_test = {
    getMusicUrl(songInfo, type) {
        const requestObj = (0, request_1.httpFetch)(`http://ts.tempmusics.tk/url/wy/${songInfo.songmid}/${type}`, {
            method: 'get',
            timeout: options_1.timeout,
            headers: options_1.headers,
            lookup: utils_1.dnsLookup,
            family: 4,
        });
        requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
            if (statusCode == 429)
                return Promise.reject(new Error(message_1.requestMsg.tooManyRequests));
            switch (body.code) {
                case 0: return Promise.resolve({ type, url: body.data });
                default: return Promise.reject(new Error(message_1.requestMsg.fail));
            }
        });
        return requestObj;
    },
    /*   getPic(songInfo) {
        const requestObj = httpFetch(`http://localhost:3100/pic/wy/${songInfo.songmid}`, {
          method: 'get',
          timeout,
          headers,
          family: 4,
        })
        requestObj.promise = requestObj.promise.then(({ body }) => {
          return body.code === 0 ? Promise.resolve(body.data) : Promise.reject(new Error(requestMsg.fail))
        })
        return requestObj
      },
      getLyric(songInfo) {
        const requestObj = httpFetch(`http://localhost:3100/lrc/wy/${songInfo.songmid}`, {
          method: 'get',
          timeout,
          headers,
          family: 4,
        })
        requestObj.promise = requestObj.promise.then(({ body }) => {
          return body.code === 0 ? Promise.resolve(body.data) : Promise.reject(new Error(requestMsg.fail))
        })
        return requestObj
      }, */
};
exports.default = api_test;
