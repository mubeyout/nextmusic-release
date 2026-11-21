"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSongName = exports.VERSION_SUFFIX_RE = exports.normalizeText = void 0;
const constants_1 = require("../../constants.js");
/**
 * 歌名 / 歌手归一化（dislike 匹配、排序、折叠共用）。
 *
 * 这些函数在 filterDisliked 里会被「每首歌 × 每歌手 × 每条规则」反复调用，
 * 因此结果在此处集中缓存，避免重复 replaceAll + toLowerCase 的开销。
 */
const normalizeCache = new Map();
const NORMALIZE_CACHE_LIMIT = 5000;
/** 带容量上限的归一化结果缓存，避免 filterDisliked 中「每首歌 × 每歌手 × 每条规则」重复计算。 */
const cachedNormalize = (key, compute) => {
    const hit = normalizeCache.get(key);
    if (hit !== undefined)
        return hit;
    const out = compute();
    if (normalizeCache.size > NORMALIZE_CACHE_LIMIT)
        normalizeCache.clear();
    normalizeCache.set(key, out);
    return out;
};
/** 归一化：与 filterRules 保持一致（@ → #、去空格、小写） */
const normalizeText = (value) => cachedNormalize(`t:${value ?? ''}`, () => String(value ?? '')
    .replaceAll(constants_1.SPLIT_CHAR.DISLIKE_NAME, constants_1.SPLIT_CHAR.DISLIKE_NAME_ALIAS)
    .trim()
    .toLowerCase());
exports.normalizeText = normalizeText;
/** 歌名版本后缀正则（Live / Remix / 现场 / 伴奏 …），供排序、折叠、归一化共用。
 *  支持两种形式：括号内「晴天 (Live)」「晴天（现场版）」与无括号连字符「晴天 - Remix」「晴天 - Live」 */
exports.VERSION_SUFFIX_RE = /(?:[\s\-–—_]*[（(](?:live|remix|现场|伴奏|纯音乐|demo|翻唱|acoustic|instrumental|off\s*vocal|版)[^）)]*[）)]|[\s]*[-–—]\s*(?:live|remix|现场|伴奏|纯音乐|demo|翻唱|acoustic|instrumental|off\s*vocal))\s*$/i;
/**
 * 归一化歌名：剥离常见版本后缀。
 * 「晴天 (Live)」「晴天 - Remix」「晴天（现场版）」→「晴天」，
 * 提升 dislike / 排序 / 折叠的跨版本召回。
 */
const normalizeSongName = (value) => cachedNormalize(`s:${value ?? ''}`, () => {
    const base = (0, exports.normalizeText)(value);
    return base.replace(exports.VERSION_SUFFIX_RE, '').trim();
});
exports.normalizeSongName = normalizeSongName;
