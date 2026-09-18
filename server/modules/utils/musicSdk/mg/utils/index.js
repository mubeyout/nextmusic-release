"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpFetch = void 0;
const request_1 = require("../../../request");
/**
 * 创建一个适用于MG的Http请求
 * @param {*} url
 * @param {*} options
 * @param {*} retryNum
 */
const createHttpFetch = async (url, options, retryNum = 0) => {
    if (retryNum > 2)
        throw new Error('try max num');
    let result;
    try {
        result = await (0, request_1.httpFetch)(url, options).promise;
    }
    catch (err) {
        console.log(err);
        return (0, exports.createHttpFetch)(url, options, ++retryNum);
    }
    if (result.statusCode !== 200 ||
        ((result.body.code !== undefined
            ? result.body.code
            : result.body.returnCode !== undefined
                ? result.body.returnCode
                : result.body.code) !== '000000'))
        return (0, exports.createHttpFetch)(url, options, ++retryNum);
    if (result.body.data)
        return result.body.data;
    return result.body;
};
exports.createHttpFetch = createHttpFetch;
