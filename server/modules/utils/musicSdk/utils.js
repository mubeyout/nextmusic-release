"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatSingerName = exports.dnsLookup = exports.getHostIp = exports.toMD5 = void 0;
const crypto_1 = __importDefault(require("crypto"));
const dns_1 = __importDefault(require("dns"));
const utils_1 = require("..");
const toMD5 = str => crypto_1.default.createHash('md5').update(str).digest('hex');
exports.toMD5 = toMD5;
const ipMap = new Map();
const getHostIp = hostname => {
    const result = ipMap.get(hostname);
    if (typeof result === 'object')
        return result;
    if (result === true)
        return;
    ipMap.set(hostname, true);
    // console.log(hostname)
    dns_1.default.lookup(hostname, {
        // family: 4,
        all: false,
    }, (err, address, family) => {
        if (err)
            return console.log(err);
        // console.log(address, family)
        ipMap.set(hostname, { address, family });
    });
};
exports.getHostIp = getHostIp;
const dnsLookup = (hostname, options, callback) => {
    const result = (0, exports.getHostIp)(hostname);
    if (result)
        return callback(null, result.address, result.family);
    dns_1.default.lookup(hostname, options, callback);
};
exports.dnsLookup = dnsLookup;
/**
 * 格式化歌手
 * @param singers 歌手数组
 * @param nameKey 歌手名键值
 * @param join 歌手分割字符
 */
const formatSingerName = (singers, nameKey = 'name', join = '、') => {
    if (Array.isArray(singers)) {
        const singer = [];
        singers.forEach(item => {
            let name = item[nameKey];
            if (!name)
                return;
            singer.push(name);
        });
        return (0, utils_1.decodeName)(singer.join(join));
    }
    return (0, utils_1.decodeName)(String(singers ?? ''));
};
exports.formatSingerName = formatSingerName;
