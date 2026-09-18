"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./utils/index");
const index_2 = require("../../index");
const utils_1 = require("../utils");
const quality_1 = require("./quality");
exports.default = {
    /**
     * 获取歌手信息
     * @param {*} id
     */
    getInfo(id) {
        return (0, index_1.weapiRequest)('/artist/head/info/get', { id }).promise.then(({ body }) => {
            if (!body || body.code != 200)
                throw new Error('get singer info faild.');
            const data = body.data || {};
            return {
                source: 'wy',
                id: data.artist.id,
                info: {
                    name: data.artist.name,
                    desc: data.artist.briefDesc,
                    avatar: (data.user && data.user.avatarUrl) || (data.artist && data.artist.picUrl) || '',
                    gender: data.user ? (data.user.gender === 1 ? 'man' : 'woman') : 'man',
                },
                count: {
                    music: data.artist.musicSize,
                    album: data.artist.albumSize,
                },
            };
        });
    },
    /**
     * 获取歌手歌曲列表
     * @param {*} id
     * @param {*} page
     * @param {*} limit
     */
    getSongList(id, page = 1, limit = 100) {
        if (page === 1)
            page = 0;
        return (0, index_1.weapiRequest)('/v1/artist/songs', {
            id,
            limit,
            offset: limit * page,
            private_cloud: 'true',
            work_type: 1,
        }).promise.then(({ body }) => {
            if (!body.songs || body.code != 200)
                throw new Error('get singer song list faild.');
            const list = this.filterSongList(body.songs);
            return {
                list,
                limit,
                page,
                total: body.total,
                source: 'wy',
            };
        });
    },
    /**
     * 获取歌手专辑列表
     * @param {*} id
     * @param {*} page
     * @param {*} limit
     */
    getAlbumList(id, page = 1, limit = 10) {
        if (page === 1)
            page = 0;
        return (0, index_1.weapiRequest)(`/artist/albums/${id}`, {
            limit,
            offset: limit * page,
            total: true,
        }).promise.then(({ body }) => {
            if (!body.hotAlbums || body.code != 200)
                throw new Error('get singer album list faild.');
            const list = this.filterAlbumList(body.hotAlbums);
            return {
                source: 'wy',
                list,
                limit,
                page,
                total: body.artist.albumSize,
            };
        });
    },
    filterAlbumList(raw) {
        const list = [];
        raw.forEach(item => {
            if (!item.id)
                return;
            list.push({
                id: item.id,
                count: item.size,
                info: {
                    name: item.name,
                    author: (0, utils_1.formatSingerName)(item.artists),
                    img: item.picUrl,
                    desc: null,
                },
            });
        });
        return list;
    },
    filterSongList(raw) {
        const list = [];
        raw.forEach(item => {
            if (!item.id)
                return;
            const { types, _types } = (0, quality_1.buildQualitys)({
                ...item,
                l: item.lMusic,
                h: item.hMusic,
                sq: item.sqMusic,
                hr: item.hrMusic,
            }, item.privilege);
            list.push({
                singer: (0, utils_1.formatSingerName)(item.artists),
                name: item.name,
                albumName: item.album.name,
                albumId: item.album.id,
                songmid: item.id,
                source: 'wy',
                interval: (0, index_2.formatPlayTime)(item.duration),
                img: null,
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {},
            });
        });
        return list;
    },
};
