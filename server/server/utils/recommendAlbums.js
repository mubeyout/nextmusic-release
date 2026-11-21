"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecommendedAlbums = void 0;
const request_1 = require("../../modules/utils/request");
const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
/**
 * 获取 QQ 音乐专辑封面 URL
 */
const getPicUrl = (mid) => mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg?max_age=2592000` : '';
/**
 * 获取推荐专辑列表
 * @param type 推荐类型: recent, newest, random, frequent
 * @param size 获取数量
 */
const fetchRecommendedAlbums = async (type, size = 20) => {
    let payload = {
        comm: { ct: 24, cv: 0 }
    };
    if (type === 'recent') {
        // [最新上架] 6个地区每个地区前5个组合
        for (let i = 1; i <= 6; i++) {
            payload[`area_${i}`] = {
                module: 'newalbum.NewAlbumServer',
                method: 'get_new_album_info',
                param: { area: i, start: 0, num: 5 },
            };
        }
    }
    else if (type === 'random') {
        // [随机推荐] area 1-6 随机抽取和组合显示30条
        // 从每个地区多取一些(10个)，合并后随机打乱
        for (let i = 1; i <= 6; i++) {
            payload[`area_${i}`] = {
                module: 'newalbum.NewAlbumServer',
                method: 'get_new_album_info',
                param: { area: i, start: 0, num: 10 },
            };
        }
    }
    else {
        return [];
    }
    try {
        const url = new URL(MUSICU_URL);
        url.searchParams.set('format', 'json');
        url.searchParams.set('data', JSON.stringify(payload));
        const { body } = await (0, request_1.httpFetch)(url.toString()).promise;
        let rawList = [];
        // 提取组合结果 (area_1 到 area_6)
        for (let i = 1; i <= 6; i++) {
            const key = `area_${i}`;
            if (body[key]?.data?.albums) {
                rawList.push(...body[key].data.albums);
            }
        }
        // 如果没有多区域数据(兼容旧逻辑或降级情况)
        if (rawList.length === 0) {
            if (body.new_album) {
                rawList = body.new_album.data?.albums || [];
            }
            else if (body.rank) {
                rawList = body.rank.data?.list || [];
            }
        }
        // 针对 random 类型进行打乱并截取 30 条
        if (type === 'random') {
            rawList.sort(() => Math.random() - 0.5);
            rawList = rawList.slice(0, 30);
        }
        else if (type === 'recent') {
            // recent 也限制在 30 条(5*6)
            rawList = rawList.slice(0, 30);
        }
        return rawList.map(item => {
            const mid = item.mid || item.album_mid;
            const name = item.name || item.album_name;
            const artist = (item.singers || []).map((s) => s.name).join('、') || item.singer_name || '未知歌手';
            return {
                id: `alb_tx_${mid}`,
                name: name,
                title: name,
                album: name,
                artist: artist,
                artistId: `artist_${artist}`,
                isDir: true,
                coverArt: getPicUrl(mid),
                songCount: 10,
                duration: 3000,
                created: new Date().toISOString(),
                playCount: 0
            };
        });
    }
    catch (e) {
        console.error('[RecommendAlbums] Fetch error:', e);
        return [];
    }
};
exports.fetchRecommendedAlbums = fetchRecommendedAlbums;
