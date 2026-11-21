"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitSingers = exports.normalizeSongName = exports.normalizeText = void 0;
exports.parseDislikeRules = parseDislikeRules;
exports.isDisliked = isDisliked;
exports.filterDisliked = filterDisliked;
const constants_1 = require("../../constants.js");
const utils_1 = require("./utils");
const songVersion_1 = require("../../server/utils/songVersion.js");
Object.defineProperty(exports, "normalizeText", { enumerable: true, get: function () { return songVersion_1.normalizeText; } });
Object.defineProperty(exports, "normalizeSongName", { enumerable: true, get: function () { return songVersion_1.normalizeSongName; } });
/** 拆分歌手字段：「A、B」「A,B」「A/B」「A feat.B」「A & B」 */
const splitSingers = (singer) => String(singer ?? '')
    .split(/[、,，\/]|\s*(?:feat\.?|ft\.?|featuring|&|;)\s*/i)
    .map(s => (0, songVersion_1.normalizeText)(s))
    .filter(Boolean);
exports.splitSingers = splitSingers;
/**
 * 解析规则串（服务端专用）。
 * 与 filterRules 的区别：这里会把专辑规则（! 前缀）单独分离出来，
 * 而不是混进歌曲规则里。
 */
function parseDislikeRules(rules) {
    const set = {
        exact: new Set(),
        musicNames: new Set(),
        singerNames: new Set(),
        albums: new Map(),
    };
    for (const raw of String(rules || '').split('\n')) {
        const line = raw.trim();
        if (!line)
            continue;
        // 专辑维度（!<专辑名>@<歌手>，按歌手多条，聚合到专辑名 -> 歌手集合）
        const album = (0, utils_1.parseAlbumRule)(line);
        if (album) {
            const name = (0, songVersion_1.normalizeText)(album.albumName);
            const singer = (0, songVersion_1.normalizeText)(album.singer);
            if (!name)
                continue;
            let s = set.albums.get(name);
            if (!s) {
                s = new Set();
                set.albums.set(name, s);
            }
            if (singer)
                s.add(singer);
            continue;
        }
        // 歌曲 / 歌手维度
        const [name, singer] = line.split(constants_1.SPLIT_CHAR.DISLIKE_NAME);
        const n = (0, songVersion_1.normalizeText)(name);
        const s = (0, songVersion_1.normalizeText)(singer);
        // 额外登记「去后缀」版本，让「晴天 (Live)」也能命中「晴天」规则（反之亦然）。
        // 开关关闭时匹配端不会用归一化名，这些额外 key 自然不会被命中。
        if (n && s) {
            set.exact.add(`${n}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${s}`);
            const nn = (0, songVersion_1.normalizeSongName)(n);
            if (nn && nn !== n)
                set.exact.add(`${nn}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${s}`);
            // 多歌手场景：规则整串存储为「歌名@A、B」，但匹配端 splitSingers 后
            // 逐个歌手检查 exact.has('歌名@A')，所以这里也要拆分登记单歌手条目。
            const parts = (0, exports.splitSingers)(singer);
            if (parts.length > 1) {
                for (const ps of parts) {
                    set.exact.add(`${n}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${ps}`);
                    if (nn && nn !== n)
                        set.exact.add(`${nn}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${ps}`);
                }
            }
        }
        else if (n) {
            set.musicNames.add(n);
            const nn = (0, songVersion_1.normalizeSongName)(n);
            if (nn && nn !== n)
                set.musicNames.add(nn);
        }
        else if (s) {
            set.singerNames.add(s);
        }
    }
    return set;
}
/**
 * 判定是否命中不喜欢规则。
 *
 * 匹配顺序（严格 → 宽松）：
 *   1. 专辑：source + albumId 精确匹配，并用歌手做二次校验
 *      （挡住不同歌手的同名专辑，如两张都叫《同名专辑》）
 *   2. 歌手：@歌手 规则
 *   3. 歌曲：歌名@歌手 精确规则，纯歌名规则
 */
function isDisliked(input, set, options = {}) {
    const crossSource = options.crossSource === true;
    const duetMode = options.duetMode || 'any';
    const normalizeName = options.normalizeName !== false;
    const requireSinger = options.requireSinger !== false;
    const name = (0, songVersion_1.normalizeText)(input.name);
    const allSingers = (0, exports.splitSingers)(input.singer);
    // primary 模式只看主唱（第一位歌手）
    const singers = duetMode === 'primary' ? allSingers.slice(0, 1) : allSingers;
    const source = (0, songVersion_1.normalizeText)(input.source);
    // 候选歌名：原名 + 去后缀名（去重），提升对 Live / Remix 等版本的召回
    const candidateNames = Array.from(new Set([name, normalizeName ? (0, songVersion_1.normalizeSongName)(input.name) : ''].filter(Boolean)));
    // 1. 专辑维度（专辑名 + 歌手集合，复用 duetMode 决定多歌手判定方式）
    if (input.albumName) {
        const albumName = (0, songVersion_1.normalizeText)(input.albumName);
        const albumSingers = set.albums.get(albumName);
        if (albumSingers && albumSingers.size > 0) {
            if (singers.length === 0) {
                // 歌曲没有歌手信息：无法确认歌手集合关系，保守放过（避免误杀）
            }
            else if (duetMode === 'all') {
                // all：歌曲全部歌手都落在专辑歌手集合内才屏蔽（不被合作者误伤）
                if (singers.every(s => albumSingers.has(s)))
                    return true;
            }
            else {
                // any / primary：歌曲任一歌手（primary 仅主唱）命中专辑歌手集合即屏蔽（合辑友好）
                if (singers.some(s => albumSingers.has(s)))
                    return true;
            }
        }
    }
    // 2. 歌手维度
    if (singers.length > 0) {
        if (duetMode === 'all') {
            // all：所有歌手都被屏蔽才算命中，避免牵连合作者
            if (singers.every(s => set.singerNames.has(s)))
                return true;
        }
        else {
            for (const s of singers) {
                if (set.singerNames.has(s))
                    return true;
            }
        }
    }
    // 3. 歌曲维度（歌名 + 歌手 双重校验）
    for (const n of candidateNames) {
        if (!n)
            continue;
        // 纯歌名规则（只记了歌名、没记歌手）：
        // requireSinger 时不单独命中，避免不同歌手的同名歌曲被一起屏蔽
        if (set.musicNames.has(n) && !requireSinger)
            return true;
        if (singers.length > 0) {
            if (duetMode === 'all') {
                if (singers.every(s => set.exact.has(`${n}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${s}`)))
                    return true;
            }
            else {
                for (const s of singers) {
                    if (set.exact.has(`${n}${constants_1.SPLIT_CHAR.DISLIKE_NAME}${s}`))
                        return true;
                }
            }
        }
    }
    return false;
}
/** 批量过滤 */
function filterDisliked(items, set, toInput, options = {}) {
    if (!items || items.length === 0)
        return items;
    return items.filter(item => !isDisliked(toInput(item), set, options));
}
