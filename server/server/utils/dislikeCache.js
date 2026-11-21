"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateDislikeCache = invalidateDislikeCache;
exports.getCachedDislikeRuleSet = getCachedDislikeRuleSet;
const match_1 = require("../../modules/dislike/match.js");
/**
 * dislike 规则集解析缓存。
 *
 * 原实现里每次过滤入口都会读取并重新解析整条规则串（parseDislikeRules 会对每个
 * 歌手 / 歌名做 replaceAll + toLowerCase + 版本归一化），一次请求往往触发多次，
 * 列表越大开销越明显。这里按用户缓存解析结果：
 *   - 写入时立即失效（invalidateDislikeCache），保证自己改的规则马上生效；
 *   - 并以 TTL 兜底外部（如 lx-music 客户端同步）对规则的变更。
 */
const cache = new Map();
const mutatedAt = new Map();
const TTL = 30 * 1000;
/** 写入 dislike 规则后调用，使该用户的缓存立即失效 */
function invalidateDislikeCache(username) {
    mutatedAt.set(username, Date.now());
    cache.delete(username);
}
/**
 * 读取并（按需）解析某用户的 dislike 规则集。
 * @param readRules 读取原始规则串的函数（由各调用方封装其 userSpace 读取逻辑）
 */
async function getCachedDislikeRuleSet(username, readRules) {
    const mutated = mutatedAt.get(username) ?? 0;
    const cached = cache.get(username);
    if (cached && cached.mutatedAt >= mutated && Date.now() - cached.ts < TTL) {
        return cached.set;
    }
    let set = null;
    try {
        const rules = await readRules();
        set = (0, match_1.parseDislikeRules)(String(rules || ''));
        // Merge disliked albums and artists from disk library files
        try {
            const { getUserDirname } = require('../../user/index.js');
            const path = require('node:path');
            const fs = require('node:fs');
            const uDir = getUserDirname(username);
            const dLibDir = path.join(global.lx.userPath, uDir, 'dislike', 'library');
            const albumsFile = path.join(dLibDir, 'albums.json');
            if (fs.existsSync(albumsFile)) {
                const albumsArr = JSON.parse(fs.readFileSync(albumsFile, 'utf8'));
                if (Array.isArray(albumsArr)) {
                    const { normalizeText, splitSingers } = require('../../modules/dislike/match.js');
                    for (const x of albumsArr) {
                        const albumName = normalizeText(String(x.name || ''));
                        if (!albumName)
                            continue;
                        let sSet = set.albums.get(albumName);
                        if (!sSet) {
                            sSet = new Set();
                            set.albums.set(albumName, sSet);
                        }
                        const singers = splitSingers(x.artistName);
                        for (const s of singers)
                            sSet.add(s);
                    }
                }
            }
            const artistsFile = path.join(dLibDir, 'artists.json');
            if (fs.existsSync(artistsFile)) {
                const artistsArr = JSON.parse(fs.readFileSync(artistsFile, 'utf8'));
                if (Array.isArray(artistsArr)) {
                    const { normalizeText } = require('../../modules/dislike/match.js');
                    for (const x of artistsArr) {
                        const singerName = normalizeText(String(x.name || ''));
                        if (singerName)
                            set.singerNames.add(singerName);
                    }
                }
            }
        }
        catch (err) {
            console.warn('[DislikeCache] Merge library failed:', err.message);
        }
    }
    catch (e) {
        console.error('[Subsonic] 读取 dislike 规则失败:', e);
        return cached?.set ?? null;
    }
    cache.set(username, { ts: Date.now(), mutatedAt: mutated, set });
    return set;
}
