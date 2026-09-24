// libraryAgg.js —— 「我的曲库」聚合层(老板 0924 拍板:自有服务器曲库做成 App 一等公民,P1 接口层)
// 基于 customMusicManager 的 custom_index.json 内存索引做艺/专/最近/随机聚合,纯 CPU 分组(千首毫秒级)。
// 决策口径(MOMO 0924 过审):
//   ① 专辑分组:ID3 album 非空 → 按专辑名分组(跨歌手同名专辑合并为一张,组内多歌手显示 Various);
//      album 空 → 按文件夹路径兜底分组(文件夹=专辑惯例)
//   ② 歌手空归「未知歌手」
//   ③ P1 封面=组内任一嵌入图代打(cover.jpg 识别 P2,不动扫描器)
//   ④ recent/newest 均按 mtime desc(无播放数据,播放统计接入是 P2)
const crypto = require("crypto");
const { customIndexManager } = require("./customMusicManager");

const md5 = (s) => crypto.createHash("md5").update(String(s)).digest("hex");
const normArtist = (s) => String(s || "").trim() || "未知歌手";

// 歌手主名:多歌手串("A/B"、"A、B")取第一段做分组键,展示保留原文
const artistKeyOf = (s) => normArtist(String(s || "").split(/[/、,;&+]/)[0]);

// 专辑分组键
function albumKeyOf(item) {
    const tag = String(item.album || "").trim();
    if (tag) return { key: "tag:" + tag.toLowerCase(), name: tag, byDir: false };
    const dir = String(item.subPath || "").trim();
    // 无 ID3 且在根目录散放:归「未分类」
    if (!dir) return { key: "dir:__uncategorized", name: "未分类", byDir: true };
    return { key: "dir:" + dir.toLowerCase(), name: dir.split("/").pop() || dir, byDir: true };
}

// ── 聚合构建(每用户,30s 内存缓存,防连点重复分组) ──
const aggCache = new Map(); // username -> { at, artists:Map, albums:Map }
const AGG_TTL = 30 * 1000;

function buildAgg(username) {
    const cached = aggCache.get(username);
    if (cached && Date.now() - cached.at < AGG_TTL) return cached;
    const items = customIndexManager.getAll(username); // 已按 mtime 无序,排序在出口做
    const artists = new Map(); // key -> {id,name,songCount,coverFile,albums:Set,latestMtime}
    const albums = new Map();  // key -> {id,name,artistNames:Set,songCount,coverFile,latestMtime,subPath,byDir}
    for (const it of items) {
        const ak = artistKeyOf(it.singer);
        let ar = artists.get(ak);
        if (!ar) {
            ar = { id: "ar_" + md5(ak), name: normArtist(ak), songCount: 0, coverFile: null, albumKeys: new Set(), latestMtime: 0 };
            artists.set(ak, ar);
        }
        ar.songCount++;
        ar.latestMtime = Math.max(ar.latestMtime, it.mtime || 0);
        const ab = albumKeyOf(it);
        let al = albums.get(ab.key);
        if (!al) {
            al = { id: "al_" + md5(ab.key), name: ab.name, artistKeys: new Set(), artistNames: new Set(), songCount: 0, coverFile: null, latestMtime: 0, subPath: it.subPath || "", byDir: ab.byDir };
            albums.set(ab.key, al);
        }
        al.songCount++;
        al.latestMtime = Math.max(al.latestMtime, it.mtime || 0);
        al.artistKeys.add(ak);
        al.artistNames.add(normArtist(it.singer || ""));
        ar.albumKeys.add(ab.key);
        // 封面代表:组内第一个有嵌入图的(不覆盖,保持稳定)
        if (!al.coverFile && it.hasCover) al.coverFile = it.filename;
        if (!ar.coverFile && it.hasCover) ar.coverFile = it.filename;
    }
    const result = { at: Date.now(), artists, albums, items };
    aggCache.set(username, result);
    return result;
}
// 索引变动后调用(扫描/删除/洗版后),清缓存保持新鲜
function invalidate(username) {
    if (username) aggCache.delete(username);
    else aggCache.clear();
}

const songOut = (it) => ({
    id: it.id, songmid: it.songmid || it.id,
    name: it.name, singer: it.singer || "", album: it.album || "",
    interval: it.interval || "", quality: it.quality || "",
    filename: it.filename, subPath: it.subPath || "",
    ext: it.ext || "", hasCover: !!it.hasCover, hasLyric: !!it.hasLyric || !!it.hasEmbedLyric,
    mtime: it.mtime || 0, size: it.size || 0,
});
const albumOut = (al) => {
    const names = Array.from(al.artistNames);
    return {
        id: al.id, name: al.name,
        artist: names.length > 1 ? "Various Artists" : (names[0] || "未知歌手"),
        artistCount: names.length,
        songCount: al.songCount, coverFile: al.coverFile || null,
        subPath: al.subPath, byDir: al.byDir, mtime: al.latestMtime,
    };
};

// ── 聚合视图(按需调用,含排序/分页) ──
function listArtists(username, { offset = 0, limit = 0 } = {}) {
    const agg = buildAgg(username);
    const arr = Array.from(agg.artists.values()).map(ar => ({
        id: ar.id, name: ar.name, songCount: ar.songCount,
        albumCount: ar.albumKeys.size, coverFile: ar.coverFile, mtime: ar.latestMtime,
    }));
    // 数量多的在前(主力歌手优先),同数量按名字典序
    arr.sort((a, b) => (b.songCount - a.songCount) || a.name.localeCompare(b.name, "zh"));
    const total = arr.length;
    return { artists: limit ? arr.slice(offset, offset + limit) : arr.slice(offset), total };
}

function getArtist(username, artistId) {
    const agg = buildAgg(username);
    let target = null;
    for (const ar of agg.artists.values()) if (ar.id === artistId) { target = ar; break; }
    if (!target) return null;
    const albums = Array.from(target.albumKeys)
        .map(k => agg.albums.get(k)).filter(Boolean)
        .map(albumOut).sort((a, b) => b.mtime - a.mtime);
    // 该歌手的歌曲:按歌手主名匹配(专辑可能跨歌手,歌曲列表只归属本人)
    const ak = artistKeyOf(target.name);
    const songs = agg.items
        .filter(it => artistKeyOf(it.singer) === ak)
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
        .map(songOut);
    return { artist: { id: target.id, name: target.name, songCount: target.songCount, albumCount: albums.length, coverFile: target.coverFile }, albums, songs };
}

function listAlbums(username, { type = "newest", size = 60, offset = 0 } = {}) {
    const agg = buildAgg(username);
    let arr = Array.from(agg.albums.values()).map(albumOut);
    const total = arr.length;
    if (type === "random") {
        // 洗牌取样(Fisher-Yates 部分洗牌,size 条)
        const n = Math.min(size || 60, arr.length);
        for (let i = 0; i < n; i++) {
            const j = i + Math.floor(Math.random() * (arr.length - i));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return { albums: arr.slice(0, n), total };
    }
    // newest/recent 同义:mtime desc(P2 接播放统计后 recent 改语义)
    arr.sort((a, b) => b.mtime - a.mtime);
    return { albums: arr.slice(offset, offset + (size || 60)), total };
}

function getAlbum(username, albumId) {
    const agg = buildAgg(username);
    let target = null, targetKey = null;
    for (const [k, al] of agg.albums) if (al.id === albumId) { target = al; targetKey = k; break; }
    if (!target) return null;
    const songs = agg.items
        .filter(it => albumKeyOf(it).key === targetKey)
        .sort((a, b) => {
            // 同名优先,其次子路径,再 mtime
            const an = String(a.name || ""), bn = String(b.name || "");
            if (an !== bn) return an.localeCompare(bn, "zh");
            return (a.mtime || 0) - (b.mtime || 0);
        })
        .map(songOut);
    return { album: albumOut(target), songs };
}

function listSongs(username, { type = "recent", size = 30 } = {}) {
    const agg = buildAgg(username);
    size = Math.max(1, Math.min(size || 30, 200));
    if (type === "random") {
        const arr = agg.items.slice();
        const n = Math.min(size, arr.length);
        for (let i = 0; i < n; i++) {
            const j = i + Math.floor(Math.random() * (arr.length - i));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return { songs: arr.slice(0, n).map(songOut) };
    }
    const arr = agg.items.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return { songs: arr.slice(0, size).map(songOut) };
}

function stats(username) {
    const agg = buildAgg(username);
    return {
        songs: agg.items.length,
        artists: agg.artists.size,
        albums: agg.albums.size,
        totalBytes: agg.items.reduce((n, it) => n + (it.size || 0), 0),
    };
}

module.exports = { listArtists, getArtist, listAlbums, getAlbum, listSongs, stats, invalidate, buildAgg };
