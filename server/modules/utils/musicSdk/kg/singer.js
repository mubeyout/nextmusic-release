"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const musicInfo_1 = require("./musicInfo");
const util_1 = require("./util");
exports.default = {
    /**
     * 获取歌手信息
     * @param {*} id
     */
    getInfo(id) {
        if (id == 0)
            throw new Error('歌手不存在'); // kg源某些歌曲在歌手没被kg收录时返回的歌手id为0
        return (0, util_1.createHttpFetch)(`http://mobiles.kugou.com/api/v5/singer/info?singerid=${id}`).then(body => {
            if (!body)
                throw new Error('get singer info faild.');
            return {
                source: 'kg',
                id: body.singerid,
                info: {
                    name: body.singername,
                    desc: body.intro,
                    avatar: body.imgurl.replace('{size}', '1000'),
                    gender: body.grade === 1 ? 'man' : 'woman',
                },
                count: {
                    music: body.songcount,
                    album: body.albumcount,
                },
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
        if (id == 0)
            throw new Error('歌手不存在');
        return (0, util_1.createHttpFetch)(`http://mobiles.kugou.com/api/v5/singer/album?singerid=${id}&page=${page}&pagesize=${limit}`).then(body => {
            if (!body.info)
                throw new Error('get singer album list faild.');
            const list = this.filterAlbumList(body.info);
            return {
                source: 'kg',
                list,
                limit,
                page,
                total: body.total,
            };
        });
    },
    /**
     * 获取歌手歌曲列表
     * @param {*} id
     * @param {*} page
     * @param {*} limit
     */
    async getSongList(id, page = 1, limit = 100) {
        if (id == 0)
            throw new Error('歌手不存在');
        const body = await (0, util_1.createHttpFetch)(`http://mobiles.kugou.com/api/v5/singer/song?singerid=${id}&page=${page}&pagesize=${limit}`);
        if (!body.info)
            throw new Error('get singer song list faild.');
        const list = await (0, musicInfo_1.getMusicInfosByList)(body.info);
        return {
            source: 'kg',
            list,
            limit,
            page,
            total: body.total,
        };
    },
    filterAlbumList(raw) {
        return raw.map(item => {
            return {
                id: item.albumid,
                count: item.songcount,
                info: {
                    name: item.albumname,
                    author: item.singername,
                    img: item.replaceAll('{size}', '1000'),
                    desc: item.intro,
                },
            };
        });
    },
};
