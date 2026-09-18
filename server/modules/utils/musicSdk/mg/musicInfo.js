"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMusicInfos = exports.getMusicInfo = exports.filterMusicInfoListV5 = exports.filterMusicInfoList = void 0;
const index_1 = require("../../index");
const utils_1 = require("./utils");
const utils_2 = require("../utils");
const createGetMusicInfosTask = (ids) => {
    let list = ids;
    let tasks = [];
    while (list.length) {
        tasks.push(list.slice(0, 100));
        if (list.length < 100)
            break;
        list = list.slice(100);
    }
    let url = 'https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2';
    return Promise.all(tasks.map(task => (0, utils_1.createHttpFetch)(url, {
        method: 'POST',
        form: {
            resourceId: task.join('|'),
        },
    }).then(data => data.resource)));
};
const filterMusicInfoList = (rawList) => {
    // console.log(rawList)
    let ids = new Set();
    const list = [];
    rawList.forEach(item => {
        if (!item.songId || ids.has(item.songId))
            return;
        ids.add(item.songId);
        const types = [];
        const _types = {};
        item.newRateFormats?.forEach(type => {
            let size;
            switch (type.formatType) {
                case 'PQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: '128k', size });
                    _types['128k'] = {
                        size,
                    };
                    break;
                case 'HQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: '320k', size });
                    _types['320k'] = {
                        size,
                    };
                    break;
                case 'SQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: 'flac', size });
                    _types.flac = {
                        size,
                    };
                    break;
                case 'ZQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: 'flac24bit', size });
                    _types.flac24bit = {
                        size,
                    };
                    break;
            }
        });
        const intervalTest = /(\d\d:\d\d)$/.test(item.length);
        list.push({
            singer: (0, utils_2.formatSingerName)(item.artists, 'name'),
            name: item.songName,
            albumName: item.album,
            albumId: item.albumId,
            songmid: item.songId,
            copyrightId: item.copyrightId,
            source: 'mg',
            interval: intervalTest ? RegExp.$1 : null,
            img: item.albumImgs?.length ? item.albumImgs[0].img : null,
            lrc: null,
            lrcUrl: item.lrcUrl,
            mrcUrl: item.mrcUrl,
            trcUrl: item.trcUrl,
            otherSource: null,
            types,
            _types,
            typeUrl: {},
        });
    });
    return list;
};
exports.filterMusicInfoList = filterMusicInfoList;
const filterMusicInfoListV5 = (rawList) => {
    // console.log(rawList)
    let ids = new Set();
    const list = [];
    rawList.forEach(item => {
        if (!item.songId || ids.has(item.songId))
            return;
        ids.add(item.songId);
        const types = [];
        const _types = {};
        item.audioFormats?.forEach(type => {
            let size;
            switch (type.formatType) {
                case 'PQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: '128k', size });
                    _types['128k'] = {
                        size,
                    };
                    break;
                case 'HQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: '320k', size });
                    _types['320k'] = {
                        size,
                    };
                    break;
                case 'SQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: 'flac', size });
                    _types.flac = {
                        size,
                    };
                    break;
                case 'ZQ':
                    size = (0, index_1.sizeFormate)(type.size ?? type.androidSize);
                    types.push({ type: 'flac24bit', size });
                    _types.flac24bit = {
                        size,
                    };
                    break;
            }
        });
        let img = item.img3 || item.img2 || item.img1 || null;
        if (img && !/https?:/.test(img))
            img = 'http://d.musicapp.migu.cn' + img;
        list.push({
            singer: (0, utils_2.formatSingerName)(item.singerList, 'name'),
            name: item.songName,
            albumName: item.album,
            albumId: item.albumId,
            songmid: item.songId,
            copyrightId: item.copyrightId,
            source: 'mg',
            interval: (0, index_1.formatPlayTime)(item.duration),
            img,
            lrc: null,
            lrcUrl: item.lrcUrl,
            mrcUrl: item.mrcUrl,
            trcUrl: item.trcUrl,
            otherSource: null,
            types,
            _types,
            typeUrl: {},
        });
    });
    return list;
};
exports.filterMusicInfoListV5 = filterMusicInfoListV5;
const getMusicInfo = async (copyrightId) => {
    return (0, exports.getMusicInfos)([copyrightId]).then(data => data[0]);
};
exports.getMusicInfo = getMusicInfo;
const getMusicInfos = async (copyrightIds) => {
    return (0, exports.filterMusicInfoList)(await Promise.all(createGetMusicInfosTask(copyrightIds)).then(data => data.flat()));
};
exports.getMusicInfos = getMusicInfos;
