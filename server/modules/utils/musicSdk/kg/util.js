"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpFetch = exports.signatureParams = void 0;
const utils_1 = require("../utils");
const request_1 = require("../../request");
// s.content[0].lyricContent.forEach(([str]) => {
//   console.log(str)
// })
/**
 * 签名
 * @param {*} params
 * @param {*} apiver
 */
const signatureParams = (params, platform = 'android', body = '') => {
    let keyparam = 'OIlwieks28dk2k092lksi2UIkp';
    if (platform === 'web')
        keyparam = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
    let param_list = params.split('&');
    param_list.sort();
    let sign_params = `${keyparam}${param_list.join('')}${body}${keyparam}`;
    return (0, utils_1.toMD5)(sign_params);
};
exports.signatureParams = signatureParams;
/**
 * 创建一个适用于KG的Http请求
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
    // console.log(result.statusCode, result.body)
    if (result.statusCode !== 200 ||
        (result.body.error_code ??
            result.body.errcode ??
            result.body.err_code) != 0)
        return (0, exports.createHttpFetch)(url, options, ++retryNum);
    if (result.body.data)
        return result.body.data;
    if (Array.isArray(result.body.info))
        return result.body;
    return result.body.info;
};
exports.createHttpFetch = createHttpFetch;
