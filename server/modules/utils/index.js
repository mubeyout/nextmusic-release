"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPlayCount = exports.dateFormat2 = exports.dateFormat = exports.formatPlayTime = exports.decodeName = exports.sizeFormate = void 0;
const sizeFormate = (size) => {
    if (!size)
        return '0 B';
    let units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let number = Math.floor(Math.log(size) / Math.log(1024));
    return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`;
};
exports.sizeFormate = sizeFormate;
const numFix = (n) => n < 10 ? (`0${n}`) : n.toString();
// Basic HTML entity decode for Node.js
const decodeName = (str) => {
    if (!str)
        return '';
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&nbsp;': ' '
    };
    return str.replace(/&[a-zA-Z]+;/g, match => entities[match] || match);
};
exports.decodeName = decodeName;
/**
 * 格式化播放时间
 * @param {number} time
 */
const formatPlayTime = (time) => {
    let m = Math.trunc(time / 60);
    let s = Math.trunc(time % 60);
    return m == 0 && s == 0 ? '--/--' : numFix(m) + ':' + numFix(s);
};
exports.formatPlayTime = formatPlayTime;
const dateFormat = (_date, format = 'Y-M-D h:m:s') => {
    const date = new Date(_date);
    if (!date)
        return '';
    return format
        .replace('Y', date.getFullYear().toString())
        .replace('M', numFix(date.getMonth() + 1))
        .replace('D', numFix(date.getDate()))
        .replace('h', numFix(date.getHours()))
        .replace('m', numFix(date.getMinutes()))
        .replace('s', numFix(date.getSeconds()));
};
exports.dateFormat = dateFormat;
/**
 * 格式化相对时间
 * @param {number} time
 */
const dateFormat2 = (time) => {
    let differ = Math.trunc((Date.now() - time) / 1000);
    if (differ < 60) {
        return differ + '秒前';
    }
    else if (differ < 3600) {
        return Math.trunc(differ / 60) + '分钟前';
    }
    else if (differ < 86400) {
        return Math.trunc(differ / 3600) + '小时前';
    }
    else {
        return (0, exports.dateFormat)(time);
    }
};
exports.dateFormat2 = dateFormat2;
const formatPlayCount = (num) => {
    if (num > 100000000)
        return parseInt(num / 10000000) / 10 + '亿';
    if (num > 10000)
        return parseInt(num / 1000) / 10 + '万';
    return num;
};
exports.formatPlayCount = formatPlayCount;
