"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const singer_1 = __importStar(require("./singer"));
const utils_1 = require("../utils");
const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
// 获取专辑内歌曲 (参考 qq-music-api.js 的 getAlbumSongList)
const getAlbumSongsApi = async (albummid) => {
    return (0, request_1.httpFetch)(`https://i.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?platform=h5page&albummid=${albummid}&g_tk=938407465&uin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=h5&needNewCode=1&_=1459961045571`).promise.then(({ body }) => {
        if (body.code !== 0)
            throw new Error('Get TX album songs failed: ' + body.code);
        return body.data || {};
    });
};
exports.default = {
    /**
     * 获取歌手详情
     * @param {string} id 歌手 MID
     */
    getArtistDetail(id) {
        return Promise.all([
            singer_1.default.getInfo(id),
            singer_1.default.getDesc(id),
        ]).then(([data, desc]) => {
            return {
                source: 'tx',
                id: data.id,
                name: data.info.name || '未知歌手',
                desc: desc || data.info.desc || '',
                avatar: data.info.avatar || `https://y.gtimg.cn/music/photo_new/T001R300x300M000${id}.jpg`,
                musicSize: data.count.music || 0,
                albumSize: data.count.album || 0,
            };
        });
    },
    /**
     * 获取歌手歌曲
     * @param {string} id 歌手 MID
     * @param {number} page
     * @param {number} limit
     * @param {string} order
     */
    getArtistSongs(id, page = 1, limit = 100, order = 'hot') {
        return singer_1.default.getSongList(id, page, limit, order);
    },
    /**
     * 获取歌手专辑列表
     * @param {string} id 歌手 MID
     * @param {number} page
     * @param {number} limit
     * @param {string} order
     */
    getArtistAlbums(id, page = 1, limit = 50, order = 'hot') {
        return singer_1.default.getAlbumList(id, page, limit, order).then(data => {
            // 转换 data.list 以匹配标准格式 { id, name, img, singer, publishTime, total }
            const formattedList = data.list.map(item => ({
                id: item.mid || item.id,
                name: item.info.name,
                img: item.info.img,
                singer: item.info.author,
                publishTime: item.info.publishTime,
                total: item.total || item.count || 0,
                source: 'tx',
            }));
            return {
                source: 'tx',
                list: formattedList,
                total: data.total,
            };
        });
    },
    /**
     * 获取专辑歌曲
     * @param {string} id 专辑 MID
     */
    getAlbumSongs(id) {
        return getAlbumSongsApi(id).then(data => {
            const list = data.list || [];
            const formattedList = list.map(item => {
                // ... (原有映射逻辑保持不变)
                return (0, singer_1.filterMusicInfoItem)({
                    id: item?.songid,
                    mid: item?.songmid,
                    title: item?.songname,
                    singer: item?.singer || [],
                    album: {
                        id: item?.albumid,
                        mid: item?.albummid,
                        name: item?.albumname
                    },
                    interval: item?.interval || 0,
                    file: {
                        media_mid: item?.strMediaMid,
                        size_128mp3: item?.size128 || 0,
                        size_320mp3: item?.size320 || 0,
                        size_flac: item?.sizeflac || 0,
                        size_hires: item?.sizehires || 0,
                    }
                });
            });
            return {
                list: formattedList,
                total: formattedList.length,
                name: data.name,
                publishTime: data.aDate,
                source: 'tx',
            };
        });
    },
};
