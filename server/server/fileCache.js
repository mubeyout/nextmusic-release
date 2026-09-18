"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSubDirectory = exports.renameSubDirectory = exports.categorizeFiles = exports.createSubDirectory = exports.getSubDirectories = exports.switchBaseLocation = exports.switchFolder = exports.checkAndCleanupCache = exports.clearLyricCache = exports.clearAllCache = exports.getCacheStats = exports.serveCacheFile = exports.setIndexEmbedLyric = exports.getLyricFetcher = exports.getIndexItemByFilename = exports.stopUserTasks = exports.replaceDownloadedMusicItem = exports.getDownloadedMusicItems = exports.downloadAndCache = exports.saveLyricCache = exports.checkLyricCache = exports.checkCache = exports.getCacheLocation = exports.setCacheLocation = exports.removeCacheFile = exports.getCacheCover = exports.linkLocalFile = exports.batchUpdateMetadata = exports.batchRenameCacheFiles = exports.getCacheList = exports.syncCacheIndex = exports.detectDownloadSource = exports.normalizeSongId = exports.embedLyricsIntoFile = exports.getAudioMetadataUnsupportedStatus = exports.indexManager = exports.getCoverCacheDir = exports.getCacheDir = exports.setLyricFetcher = exports.activeTasks = exports.cacheProgress = exports.CACHE_ROOTS = exports.setNamingPattern = exports.normalizeNamingPattern = exports.CACHE_NAMING_PATTERNS = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const { MusicTagger, MetaPicture } = require('music-tag-native');
const lrcTool_1 = require("../utils/lrcTool");
const common_1 = require("../utils/common");
// --- Cache Naming Patterns ---
exports.CACHE_NAMING_PATTERNS = {
    STANDARD: 'standard', // {Name}_-_{Singer}_-_{Source}_-_{ID}_-_{Quality}
    SIMPLE: 'simple', // {Name} - {Singer} - {Quality} - {Album}
    SINGER_NAME_QUALITY_ALBUM: 'singer_name_quality_album', // {Singer} - {Name} - {Quality} - {Album}
    SINGER_NAME: 'singer_name', // {Singer} - {Name}
    NAME_SINGER: 'name_singer' // {Name} - {Singer}
};
let currentNamingPattern = exports.CACHE_NAMING_PATTERNS.SIMPLE;
const normalizeNamingPattern = (pattern) => {
    if (Object.values(exports.CACHE_NAMING_PATTERNS).includes(pattern)) {
        return pattern;
    }
    return exports.CACHE_NAMING_PATTERNS.SIMPLE;
};
exports.normalizeNamingPattern = normalizeNamingPattern;
const setNamingPattern = (pattern) => {
    currentNamingPattern = (0, exports.normalizeNamingPattern)(pattern);
    return currentNamingPattern;
};
exports.setNamingPattern = setNamingPattern;
// Define the two possible cache roots
exports.CACHE_ROOTS = {
    DATA: 'data', // inside global.lx.dataPath (synced)
    ROOT: 'root' // relative to process.cwd() (not synced)
};
let currentCacheLocation = exports.CACHE_ROOTS.ROOT;
const CACHE_LIST_SYNC_TTL = 30 * 1000;
const cacheListSyncState = new Map();
// Helper to get actual directory path
// [Unified Enhancement] Cache Progress Tracker
exports.cacheProgress = new Map();
// [New] Active Cache Tasks Tracker: username -> [ { songKey, controller } ]
exports.activeTasks = new Map();
let _lyricFetcher = null;
const setLyricFetcher = (fn) => { _lyricFetcher = fn; };
exports.setLyricFetcher = setLyricFetcher;
const getCacheDir = (username, isOnlyDownload, location) => {
    const userDirName = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const folderName = isOnlyDownload ? 'music' : 'cache';
    const loc = location || currentCacheLocation;
    let baseDir = '';
    if (loc === exports.CACHE_ROOTS.DATA) {
        baseDir = path_1.default.join(global.lx.dataPath, folderName);
    }
    else {
        baseDir = path_1.default.join(process.cwd(), folderName);
    }
    const fullPath = path_1.default.join(baseDir, userDirName);
    if (!fs_1.default.existsSync(fullPath)) {
        fs_1.default.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
};
exports.getCacheDir = getCacheDir;
const getCoverCacheDir = (username) => {
    const baseDir = path_1.default.join(process.cwd(), 'cover_cache');
    const userDirName = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const fullPath = path_1.default.join(baseDir, userDirName);
    if (!fs_1.default.existsSync(fullPath)) {
        fs_1.default.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
};
exports.getCoverCacheDir = getCoverCacheDir;
class CacheIndexManager {
    indexes = new Map(); // "location:username:folder" -> (songId -> CacheItem)
    getIndexFile(username, folder, location) {
        const userDir = (0, exports.getCacheDir)(username, folder === 'music', location);
        const fileName = folder === 'music' ? 'music_index.json' : 'cache_index.json';
        return path_1.default.join(userDir, fileName);
    }
    getKey(username, folder, location) {
        return `${location || currentCacheLocation}:${username}:${folder}`;
    }
    load(username, folder, location) {
        const key = this.getKey(username, folder, location);
        const file = this.getIndexFile(username, folder, location);
        if (fs_1.default.existsSync(file)) {
            try {
                const data = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
                this.indexes.set(key, new Map(Object.entries(data)));
            }
            catch (e) {
                this.indexes.set(key, new Map());
            }
        }
        else {
            this.indexes.set(key, new Map());
        }
        return this.indexes.get(key);
    }
    save(username, folder, location) {
        const loc = location || currentCacheLocation;
        const key = this.getKey(username, folder, loc);
        const index = this.indexes.get(key);
        if (!index)
            return;
        const file = this.getIndexFile(username, folder, loc);
        try {
            const data = Object.fromEntries(index);
            fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2));
        }
        catch (e) {
            console.error(`[CacheIndex] Failed to save index for ${key}:`, e);
        }
    }
    get(username, songId, folder, quality, exact = false, location) {
        const key = this.getKey(username, folder, location);
        const index = this.indexes.get(key) || this.load(username, folder, location);
        if (quality) {
            const item = index.get(`${songId}_${quality}`);
            if (item)
                return item;
            // exact 模式：精确匹配失败则不 fallback，直接返回 undefined
            if (exact)
                return undefined;
        }
        // Fallback: 非精确模式下扫描同 ID 的任意质量
        const prefix = `${songId}_`;
        for (const [k, item] of index.entries()) {
            if (k === songId || k.startsWith(prefix))
                return item;
        }
        return undefined;
    }
    update(username, item, folder, location) {
        const key = this.getKey(username, folder, location);
        const index = this.indexes.get(key) || this.load(username, folder, location);
        // Use composite key id_quality
        const itemKey = `${item.id}_${item.quality || 'unknown'}`;
        index.set(itemKey, item);
        this.save(username, folder, location);
    }
    remove(username, songId, folder, quality, location) {
        const key = this.getKey(username, folder, location);
        const index = this.indexes.get(key) || this.load(username, folder, location);
        if (quality) {
            if (index.delete(`${songId}_${quality}`)) {
                this.save(username, folder, location);
                return true;
            }
        }
        // Legacy or bulk remove by ID
        let deleted = false;
        const prefix = `${songId}_`;
        for (const k of Array.from(index.keys())) {
            if (k === songId || k.startsWith(prefix)) {
                index.delete(k);
                deleted = true;
            }
        }
        if (deleted)
            this.save(username, folder, location);
        return deleted;
    }
    getAll(username, folder, location) {
        return Array.from((this.indexes.get(this.getKey(username, folder, location)) || this.load(username, folder, location)).values());
    }
    discard(username, folder, location) {
        this.indexes.delete(this.getKey(username, folder, location));
    }
}
exports.indexManager = new CacheIndexManager();
const COVER_CHECK_VERSION = 4;
const getCoverCacheHash = (filename, stats) => {
    const version = stats ? `${stats.size}:${stats.mtimeMs}` : '';
    return crypto_1.default.createHash('md5').update(`${filename}:${version}`).digest('hex');
};
const getCoverCachePaths = (filename, username, stats) => {
    const hash = getCoverCacheHash(filename, stats);
    const coverCacheDir = (0, exports.getCoverCacheDir)(username);
    return {
        binPath: path_1.default.join(coverCacheDir, `${hash}.bin`),
        mimePath: path_1.default.join(coverCacheDir, `${hash}.mime`),
    };
};
const getLegacyCoverCachePaths = (filename, username, stats) => {
    const hash = getCoverCacheHash(filename, stats);
    const userDirName = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const coverCacheDir = path_1.default.join(global.lx.dataPath, 'cover_cache', userDirName);
    return {
        binPath: path_1.default.join(coverCacheDir, `${hash}.bin`),
        mimePath: path_1.default.join(coverCacheDir, `${hash}.mime`),
    };
};
const detectImageMime = (data) => {
    const buffer = Buffer.from(data);
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')))
        return 'image/gif';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
        return 'image/webp';
    if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM')
        return 'image/bmp';
    return null;
};
const readCoverCache = (filename, username, stats) => {
    const candidates = [getCoverCachePaths(filename, username, stats), getLegacyCoverCachePaths(filename, username, stats)];
    for (const candidate of candidates) {
        try {
            if (!fs_1.default.existsSync(candidate.binPath) || !fs_1.default.existsSync(candidate.mimePath))
                continue;
            const data = fs_1.default.readFileSync(candidate.binPath);
            const detectedMime = detectImageMime(data);
            if (!detectedMime)
                continue;
            const storedMime = fs_1.default.readFileSync(candidate.mimePath, 'utf8').trim();
            const persistent = getCoverCachePaths(filename, username, stats);
            if (candidate.binPath !== persistent.binPath) {
                fs_1.default.copyFileSync(candidate.binPath, persistent.binPath);
                fs_1.default.writeFileSync(persistent.mimePath, detectedMime || storedMime || 'image/jpeg');
            }
            return { data, mime: detectedMime || storedMime || 'image/jpeg' };
        }
        catch (e) { }
    }
    return null;
};
const hasCachedCover = (filename, username, stats) => {
    return !!readCoverCache(filename, username, stats);
};
const writeCoverCache = (filename, username, data, mime, stats) => {
    const coverData = Buffer.from(data);
    const detectedMime = detectImageMime(coverData);
    if (!detectedMime)
        return false;
    const { binPath, mimePath } = getCoverCachePaths(filename, username, stats);
    fs_1.default.writeFileSync(binPath, coverData);
    fs_1.default.writeFileSync(mimePath, detectedMime || mime || 'image/jpeg');
    return true;
};
const resolveCacheRelativePath = (dir, filename) => {
    const root = path_1.default.resolve(dir);
    const resolved = path_1.default.resolve(root, filename);
    if (resolved !== root && !resolved.startsWith(root + path_1.default.sep)) {
        return null;
    }
    return resolved;
};
const hasValidPictureData = (picture) => {
    if (!picture || !picture.data)
        return false;
    try {
        return !!detectImageMime(Buffer.from(picture.data));
    }
    catch (e) {
        return false;
    }
};
const hasValidEmbeddedCover = (pictures) => {
    return Array.isArray(pictures) && pictures.some(hasValidPictureData);
};
const isPlaceholderCoverUrl = (url) => {
    return typeof url === 'string' && /\/T002R\d+x\d+M000\.jpg(?:$|\?)/.test(url);
};
const hasUsableRemoteCover = (url) => typeof url === 'string' && /^https?:\/\//i.test(url) && !isPlaceholderCoverUrl(url);
const detectAudioContainer = (filePath) => {
    try {
        const fd = fs_1.default.openSync(filePath, 'r');
        const buffer = Buffer.alloc(16);
        const bytesRead = fs_1.default.readSync(fd, buffer, 0, buffer.length, 0);
        fs_1.default.closeSync(fd);
        const head = buffer.subarray(0, bytesRead);
        if (head.subarray(0, 3).toString('ascii') === 'ID3' || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
            return 'mp3';
        if (head.subarray(0, 4).toString('ascii') === 'fLaC')
            return 'flac';
        if (head.subarray(0, 4).toString('ascii') === 'OggS')
            return 'ogg';
        if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE')
            return 'wav';
        if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp')
            return 'mp4';
        if (head.subarray(0, 4).toString('ascii') === 'MAC ')
            return 'ape';
        if (head[0] === 0x7b)
            return 'encrypted';
        return 'unknown';
    }
    catch (e) {
        return 'unknown';
    }
};
const getMetadataUnsupportedMessage = (container) => (container === 'encrypted'
    ? '音频为加密或非标准容器，无法写入封面和歌词标签'
    : '当前音频容器不支持写入封面和歌词标签');
const getAudioMetadataUnsupportedStatus = (filePath) => {
    const audioContainer = detectAudioContainer(filePath);
    return {
        audioContainer,
        metadataWritable: false,
        error: getMetadataUnsupportedMessage(audioContainer),
    };
};
exports.getAudioMetadataUnsupportedStatus = getAudioMetadataUnsupportedStatus;
const readEmbeddedCoverState = (filePath) => {
    let tagger;
    try {
        tagger = new MusicTagger();
        tagger.loadPath(filePath);
        return hasValidEmbeddedCover(tagger.pictures);
    }
    catch (e) {
        return false;
    }
    finally {
        try {
            if (tagger)
                tagger.dispose();
        }
        catch (e) { }
    }
};
const embedLyricsIntoFile = (filePath, lyricText) => {
    const audioContainer = detectAudioContainer(filePath);
    let tagger;
    try {
        tagger = new MusicTagger();
        tagger.loadPath(filePath);
        tagger.lyrics = lyricText;
        tagger.save();
    }
    catch (e) {
        return {
            success: false,
            hasEmbedLyric: false,
            audioContainer,
            metadataWritable: false,
            error: getMetadataUnsupportedMessage(audioContainer),
        };
    }
    finally {
        try {
            if (tagger)
                tagger.dispose();
        }
        catch (e) { }
    }
    let verifyTagger;
    try {
        verifyTagger = new MusicTagger();
        verifyTagger.loadPath(filePath);
        const embeddedLyrics = verifyTagger.lyrics;
        const hasEmbedLyric = !!(embeddedLyrics && embeddedLyrics.trim().length > 10);
        return {
            success: hasEmbedLyric,
            hasEmbedLyric,
            audioContainer,
            metadataWritable: true,
            error: hasEmbedLyric ? undefined : '歌词标签写入后校验失败，已保留外置歌词文件',
        };
    }
    catch (e) {
        return {
            success: false,
            hasEmbedLyric: false,
            audioContainer,
            metadataWritable: false,
            error: getMetadataUnsupportedMessage(audioContainer),
        };
    }
    finally {
        try {
            if (verifyTagger)
                verifyTagger.dispose();
        }
        catch (e) { }
    }
};
exports.embedLyricsIntoFile = embedLyricsIntoFile;
// Ensure directory exists
const ensureDir = (username, isOnlyDownload) => {
    const dir = (0, exports.getCacheDir)(username, isOnlyDownload);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
};
// Safe rename: try rename, fall back to copy+unlink if rename fails (cross-device, permissions, etc.)
const safeRenameSync = (src, dst) => {
    try {
        fs_1.default.renameSync(src, dst);
        return true;
    }
    catch (err) {
        try {
            fs_1.default.copyFileSync(src, dst);
            fs_1.default.unlinkSync(src);
            return true;
        }
        catch (err2) {
            throw err; // keep original error context
        }
    }
};
/**
 * 规范化歌曲 ID：确保带上 source 前缀，与索引中的 Key 保持一致
 */
const normalizeSongId = (songInfo) => {
    let id = String(songInfo.songmid || songInfo.songId || songInfo.id || '');
    const source = songInfo.source || 'unknown';
    if (id && !id.includes('_') && source !== 'unknown') {
        id = `${source}_${id}`;
    }
    return id;
};
exports.normalizeSongId = normalizeSongId;
/**
 * Extract rich metadata from Lx songInfo object
 */
const extractSongMetadata = (songInfo) => {
    const meta = songInfo.meta || {};
    const id = (0, exports.normalizeSongId)(songInfo);
    return {
        id: id,
        name: songInfo.name || meta.songName || 'Unknown',
        singer: songInfo.singer || meta.singerName || 'Unknown',
        album: songInfo.albumName || meta.albumName ||
            (typeof songInfo.album === 'string' ? songInfo.album : songInfo.album?.name) || '',
        albumId: String(songInfo.albumId || meta.albumId || ''),
        img: songInfo.img || meta.picUrl || '',
        interval: songInfo.interval || meta.interval || '',
        source: songInfo.source || 'unknown'
    };
};
/**
 * Detect quality tag from bitrate and file metadata
 */
const detectQualityFromBitrate = (bitrate, ext, tagger) => {
    const nativeQuality = String(tagger?.quality || '').toLowerCase();
    const isLossless = ext === '.flac' || ext === '.wav' || ext === '.ape' || nativeQuality === 'sq' || nativeQuality === 'hires';
    const br = bitrate || 0; // Already in kbps from music-tag-native
    if (isLossless) {
        const bitDepth = tagger?.bitDepth || 16;
        const sampleRate = tagger?.sampleRate || 44100;
        if (br > 4500 || sampleRate > 96000)
            return 'master';
        if (br > 1000 || bitDepth > 16 || sampleRate > 48000)
            return 'flac24bit';
        return 'flac';
    }
    // Lossy formats (mp3, m4a, etc.)
    if (br >= 240)
        return '320k';
    if (br >= 170)
        return '192k';
    return '128k';
};
const losslessQualitySet = new Set(['flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master', 'ape', 'wav']);
const isClearlyLossyAudio = (container, tagger) => {
    const nativeQuality = String(tagger?.quality || '').toLowerCase();
    return nativeQuality === 'hq' || container === 'mp3' || container === 'ogg';
};
const resolveInspectedQuality = (requestedQuality, detectedQuality, container, tagger) => {
    if (isClearlyLossyAudio(container, tagger))
        return detectedQuality;
    if (requestedQuality && losslessQualitySet.has(requestedQuality))
        return requestedQuality;
    return detectedQuality;
};
const needsQualityCorrection = (quality, container) => (!!quality && losslessQualitySet.has(quality) && (container === 'mp3' || container === 'ogg'));
const inspectAudioFile = (filePath, requestedQuality) => {
    const audioContainer = detectAudioContainer(filePath);
    const ext = audioContainer === 'unknown' || audioContainer === 'encrypted'
        ? path_1.default.extname(filePath).toLowerCase()
        : `.${audioContainer === 'mp4' ? 'm4a' : audioContainer}`;
    let tagger;
    try {
        tagger = new MusicTagger();
        tagger.loadPath(filePath);
        const bitrate = Number(tagger.bitRate) || undefined;
        const detectedQuality = detectQualityFromBitrate(bitrate, ext, tagger);
        return {
            audioContainer,
            extension: ext,
            quality: resolveInspectedQuality(requestedQuality, detectedQuality, audioContainer, tagger),
            bitrate,
            sampleRate: Number(tagger.sampleRate) || undefined,
            bitDepth: Number(tagger.bitDepth) || undefined,
        };
    }
    catch (e) {
        const detectedQuality = detectQualityFromBitrate(undefined, ext);
        return {
            audioContainer,
            extension: ext,
            quality: needsQualityCorrection(requestedQuality, audioContainer) ? detectedQuality : (requestedQuality || detectedQuality),
            bitrate: undefined,
            sampleRate: undefined,
            bitDepth: undefined,
        };
    }
    finally {
        try {
            if (tagger)
                tagger.dispose();
        }
        catch (e) { }
    }
};
const detectDownloadSource = (rawUrl, fallbackSource) => {
    let value = String(rawUrl || '').toLowerCase();
    try {
        value = decodeURIComponent(value);
    }
    catch (e) { }
    const sourcePatterns = [
        ['kw', /(?:^|[./])(?:kuwo\.cn|kuwo\.com)(?:[/:?]|$)/],
        ['wy', /(?:^|[./])(?:music\.126\.net|music\.163\.com|163yun\.com)(?:[/:?]|$)/],
        ['tx', /(?:^|[./])(?:qqmusic\.qq\.com|music\.tc\.qq\.com|stream\.qqmusic\.qq\.com)(?:[/:?]|$)/],
        ['kg', /(?:^|[./])(?:kugou\.com|kugou\.net)(?:[/:?]|$)/],
        ['mg', /(?:^|[./])(?:migu\.cn|miguvideo\.com|cmvideo\.cn)(?:[/:?]|$)/],
    ];
    for (const [source, pattern] of sourcePatterns) {
        if (pattern.test(value))
            return source;
    }
    return fallbackSource || undefined;
};
exports.detectDownloadSource = detectDownloadSource;
// Generate consistent filename based on pattern with collision handling
const getFileName = (songInfo, quality, isOnlyDownload, username) => {
    const sanitizeFilename = (str) => String(str || '').replace(/[\\/:*?"<>|]/g, '_');
    const id = (0, exports.normalizeSongId)(songInfo);
    const source = songInfo.source || 'unknown';
    const q = quality || songInfo.quality || 'unknown';
    const nameStr = sanitizeFilename(songInfo.name || 'Unknown');
    const singerStr = sanitizeFilename(songInfo.singer || 'Unknown');
    const albumValue = songInfo.albumName || songInfo.meta?.albumName ||
        (typeof songInfo.album === 'string' ? songInfo.album : songInfo.album?.name) ||
        'Unknown Album';
    const albumStr = sanitizeFilename(albumValue);
    let baseName = '';
    if (currentNamingPattern === exports.CACHE_NAMING_PATTERNS.SIMPLE) {
        baseName = `${nameStr} - ${singerStr} - ${sanitizeFilename(q)} - ${albumStr}`;
    }
    else if (currentNamingPattern === exports.CACHE_NAMING_PATTERNS.SINGER_NAME_QUALITY_ALBUM) {
        baseName = `${singerStr} - ${nameStr} - ${sanitizeFilename(q)} - ${albumStr}`;
    }
    else if (currentNamingPattern === exports.CACHE_NAMING_PATTERNS.SINGER_NAME) {
        baseName = `${singerStr} - ${nameStr}`;
    }
    else if (currentNamingPattern === exports.CACHE_NAMING_PATTERNS.NAME_SINGER) {
        baseName = `${nameStr} - ${singerStr}`;
    }
    else {
        // Default/Standard: {Name}_-_{Singer}_-_{Source}_-_{ID}_-_{Quality}
        baseName = `${nameStr}_-_${singerStr}_-_${sanitizeFilename(source)}_-_${sanitizeFilename(id)}_-_${sanitizeFilename(q)}`;
    }
    // --- Collision Handling ---
    // Only apply suffix logic if we have a username and it's not the standard pattern (which is already unique)
    if (username && currentNamingPattern !== exports.CACHE_NAMING_PATTERNS.STANDARD) {
        const folder = isOnlyDownload ? 'music' : 'cache';
        const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
        const existingItems = exports.indexManager.getAll(normalizedUsername, folder);
        const normalizedName = nameStr.toLowerCase();
        const normalizedSinger = singerStr.toLowerCase();
        const normalizedQuality = sanitizeFilename(q).toLowerCase();
        const normalizedAlbum = albumStr.toLowerCase();
        // The album is part of the simple filename, so different album editions do not collide.
        const conflict = existingItems.find(item => {
            // 只要不是同一个文件（ID 不同，或者 ID 相同但音质不同），就有可能冲突
            const isDifferentFile = (0, exports.normalizeSongId)(item) !== id || item.quality !== q;
            if (!isDifferentFile)
                return false;
            const itemNormalizedName = sanitizeFilename(item.name || 'Unknown').toLowerCase();
            const itemNormalizedSinger = sanitizeFilename(item.singer || 'Unknown').toLowerCase();
            if (currentNamingPattern === exports.CACHE_NAMING_PATTERNS.SINGER_NAME || currentNamingPattern === exports.CACHE_NAMING_PATTERNS.NAME_SINGER) {
                // 对于仅包含“歌手-歌名”的模式，只要歌手和歌名一样，必定产生同名文件冲突
                return itemNormalizedName === normalizedName && itemNormalizedSinger === normalizedSinger;
            }
            else {
                // 对于包含音质和专辑的模式，还要判断这些字段是否也完全相同
                const itemNormalizedQuality = sanitizeFilename(item.quality || 'unknown').toLowerCase();
                const itemNormalizedAlbum = sanitizeFilename(item.album || 'Unknown Album').toLowerCase();
                return itemNormalizedName === normalizedName &&
                    itemNormalizedSinger === normalizedSinger &&
                    itemNormalizedQuality === normalizedQuality &&
                    itemNormalizedAlbum === normalizedAlbum;
            }
        });
        if (conflict) {
            // The normalized ID already includes the source prefix when needed.
            baseName += ` (${sanitizeFilename(id || source || 'duplicate')})`;
        }
    }
    if (baseName.length > 200)
        baseName = baseName.substring(0, 200);
    return baseName;
};
// Helper to sanitize for URL/Path
const sanitize = (str) => String(str || '').replace(/[\\/:*?"<>|]/g, '_');
// --- Public APIs ---
/**
 * Sync disk files with index database
 */
const syncCacheIndex = async (username, roots = ['cache', 'music']) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav'];
    for (const folder of roots) {
        const index = exports.indexManager.load(normalizedUsername, folder);
        let updated = false;
        const existingKeysInIndex = new Set(index.keys());
        const foundKeysOnDisk = new Set();
        // Pre-build a filename to Item map within this folder for fast lookup
        const filenameToItemMap = new Map();
        for (const [key, item] of index.entries()) {
            filenameToItemMap.set(item.filename, { key, item });
        }
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        if (!fs_1.default.existsSync(dir))
            continue;
        // [Unified Enhancement] Recursive file walker (asynchronous)
        const getAllFilesAsync = async (dirPath, base = dirPath) => {
            const acc = [];
            try {
                const exists = await fs_1.default.promises.access(dirPath).then(() => true).catch(() => false);
                if (!exists)
                    return acc;
                const entries = await fs_1.default.promises.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path_1.default.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        const subFiles = await getAllFilesAsync(fullPath, base);
                        acc.push(...subFiles);
                    }
                    else {
                        acc.push(path_1.default.relative(base, fullPath).replace(/\\/g, '/'));
                    }
                }
            }
            catch (e) {
                console.error(`[fileCache] error walking path: ${dirPath}`, e);
            }
            return acc;
        };
        const files = await getAllFilesAsync(dir);
        for (const file of files) {
            if (file === 'cache_index.json' || file === 'music_index.json')
                continue;
            const ext = path_1.default.extname(file).toLowerCase();
            if (!extensions.includes(ext))
                continue;
            const filePath = path_1.default.join(dir, file);
            const stats = await fs_1.default.promises.stat(filePath);
            // Try to find if this file is already known in index by its filename
            let existingEntry = filenameToItemMap.get(file);
            let existing = existingEntry?.item;
            let oldKey = existingEntry?.key;
            let songId = existing?.id || '';
            let songName = existing?.name || '';
            let singer = existing?.singer || '';
            let source = existing?.source || '';
            let quality = existing?.quality || '';
            let album = existing?.album || '';
            let hasCover = existing?.hasCover || false;
            // subPath calculation: the directory part of the relative path
            const subPath = path_1.default.dirname(file) === '.' ? '' : path_1.default.dirname(file).replace(/\\/g, '/');
            const fileNameOnly = path_1.default.basename(file);
            const nameWithoutExt = path_1.default.basename(fileNameOnly, ext);
            if (!existing) {
                // Not found by filename, try to parse from standard format
                const segments = nameWithoutExt.split('_-_');
                if (segments.length >= 5) {
                    songName = segments[0];
                    singer = segments[1];
                    source = segments[2];
                    songId = segments[3];
                    quality = segments[4];
                }
                else {
                    // Try simple pattern: Name - Singer - Quality - Album
                    const segmentsShort = nameWithoutExt.split(' - ');
                    if (segmentsShort.length >= 2) {
                        songName = segmentsShort[0];
                        singer = segmentsShort[1];
                        quality = segmentsShort[2] || 'unknown';
                        album = segmentsShort.slice(3).join(' - ');
                        songId = nameWithoutExt; // Fallback ID for unknown files
                    }
                    else {
                        // Fallback for completely unknown filenames (e.g. download_4.mp3)
                        songId = nameWithoutExt;
                        source = 'unknown';
                        quality = 'unknown';
                    }
                }
            }
            if (!songId)
                continue;
            // Normalize ID
            const normalizedId = songId.includes('_') ? songId : `${source || 'unknown'}_${songId}`;
            // Always check for companion lyric file
            const lrcFile = file.substring(0, file.length - ext.length) + '.lrc';
            const hasLyricOnDisk = await fs_1.default.promises.access(path_1.default.join(dir, lrcFile)).then(() => true).catch(() => false);
            let finalQuality = quality || 'unknown';
            const needsCoverCheck = !existing ||
                existing.coverCheckedVersion !== COVER_CHECK_VERSION ||
                existing.coverCheckedMtime !== stats.mtimeMs ||
                existing.coverCheckedSize !== stats.size ||
                existing.hasCover === undefined ||
                (existing.coverType === 'cached' && !hasCachedCover(file, normalizedUsername, stats));
            const currentAudioContainer = existing?.audioContainer || detectAudioContainer(filePath);
            const qualityCorrectionNeeded = !!existing && needsQualityCorrection(existing.quality, currentAudioContainer);
            // Update or add to index if anything changed (size, mtime, lyric status, or cover status)
            if (!existing || existing.size !== stats.size || existing.hasLyric !== hasLyricOnDisk || needsCoverCheck || !existing.interval || existing.quality === 'unknown' || !existing.bitrate || qualityCorrectionNeeded) {
                if (existing) {
                    existing.size = stats.size;
                    existing.mtime = stats.mtimeMs;
                    existing.hasLyric = hasLyricOnDisk;
                    existing.lyricFilename = hasLyricOnDisk ? lrcFile : undefined;
                    if (existing.subPath !== subPath) {
                        existing.subPath = subPath;
                        updated = true;
                    }
                    if (needsCoverCheck) {
                        const hasEmbeddedCover = readEmbeddedCoverState(filePath);
                        const hasExternalCover = !hasEmbeddedCover && hasCachedCover(file, normalizedUsername, stats);
                        const coverType = hasEmbeddedCover
                            ? 'embedded'
                            : hasExternalCover
                                ? 'cached'
                                : hasUsableRemoteCover(existing.img)
                                    ? 'remote'
                                    : 'none';
                        const actualHasCover = coverType !== 'none';
                        if (existing.hasCover !== actualHasCover)
                            updated = true;
                        existing.hasCover = actualHasCover;
                        existing.coverType = coverType;
                        existing.coverCheckedVersion = COVER_CHECK_VERSION;
                        existing.coverCheckedMtime = stats.mtimeMs;
                        existing.coverCheckedSize = stats.size;
                    }
                    // If interval or quality/bitrate is missing/unknown, or hasEmbedLyric not yet detected, try to extract it
                    if (!existing.interval || existing.quality === 'unknown' || !existing.bitrate || existing.hasEmbedLyric === undefined || existing.metadataWritable === undefined || qualityCorrectionNeeded) {
                        let tagger;
                        try {
                            tagger = new MusicTagger();
                            tagger.loadPath(filePath);
                            const dur = tagger.duration;
                            if (dur && !existing.interval)
                                existing.interval = (0, common_1.formatPlayTime)(dur / 1000);
                            existing.bitrate = tagger.bitRate;
                            existing.sampleRate = tagger.sampleRate;
                            existing.bitDepth = tagger.bitDepth;
                            if (!existing.quality || existing.quality === 'unknown' || qualityCorrectionNeeded) {
                                const detectedQuality = detectQualityFromBitrate(tagger.bitRate, ext, tagger);
                                existing.quality = resolveInspectedQuality(existing.quality, detectedQuality, currentAudioContainer, tagger);
                            }
                            // [新增] 检测是否已嵌入歌词 USLT 标签
                            if (existing.hasEmbedLyric === undefined) {
                                const lyricsInTag = tagger.lyrics;
                                existing.hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10);
                            }
                            existing.audioContainer = currentAudioContainer;
                            existing.metadataWritable = true;
                            existing.metadataError = undefined;
                        }
                        catch (e) {
                            existing.audioContainer = currentAudioContainer;
                            existing.metadataWritable = false;
                            existing.metadataError = getMetadataUnsupportedMessage(existing.audioContainer);
                            existing.hasEmbedLyric = false;
                        }
                        finally {
                            try {
                                if (tagger)
                                    tagger.dispose();
                            }
                            catch (e) { }
                        }
                        updated = true;
                    }
                    if (existing.size !== stats.size || existing.hasLyric !== hasLyricOnDisk)
                        updated = true;
                    finalQuality = existing.quality;
                }
                else {
                    // (New file logic remains same but uses hasLyricOnDisk)
                    let interval = '';
                    let bitrate;
                    let sampleRate;
                    let bitDepth;
                    let hasEmbedLyric = false;
                    let metadataWritable = false;
                    let metadataError;
                    const audioContainer = detectAudioContainer(filePath);
                    try {
                        const tagger = new MusicTagger();
                        tagger.loadPath(filePath);
                        if (tagger.title && !songName)
                            songName = tagger.title;
                        if (tagger.artist && !singer)
                            singer = tagger.artist;
                        if (tagger.album && !album)
                            album = tagger.album;
                        if (hasValidEmbeddedCover(tagger.pictures))
                            hasCover = true;
                        const dur = tagger.duration;
                        interval = dur ? (0, common_1.formatPlayTime)(dur / 1000) : '';
                        bitrate = tagger.bitRate;
                        sampleRate = tagger.sampleRate;
                        bitDepth = tagger.bitDepth;
                        finalQuality = detectQualityFromBitrate(tagger.bitRate, ext, tagger);
                        // [新增] 检测是否已嵌入歌词 USLT 标签
                        const lyricsInTag = tagger.lyrics;
                        hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10);
                        metadataWritable = true;
                        tagger.dispose();
                    }
                    catch (e) {
                        metadataError = getMetadataUnsupportedMessage(audioContainer);
                    }
                    const hasExternalCover = !hasCover && hasCachedCover(file, normalizedUsername, stats);
                    if (hasExternalCover)
                        hasCover = true;
                    const coverType = hasCover && !hasExternalCover
                        ? 'embedded'
                        : hasExternalCover
                            ? 'cached'
                            : 'none';
                    hasCover = coverType !== 'none';
                    const item = {
                        id: normalizedId,
                        songmid: normalizedId,
                        name: songName || nameWithoutExt || 'Unknown',
                        singer: singer || 'Unknown',
                        album: album || '',
                        albumId: '',
                        img: '',
                        interval: interval,
                        source: source || 'unknown',
                        quality: finalQuality,
                        filename: file,
                        folder: folder,
                        subPath,
                        mtime: stats.mtimeMs,
                        size: stats.size,
                        lyricFilename: hasLyricOnDisk ? lrcFile : undefined,
                        ext: ext.replace('.', ''),
                        hasCover: hasCover,
                        coverType,
                        hasLyric: hasLyricOnDisk,
                        hasEmbedLyric,
                        audioContainer,
                        metadataWritable,
                        metadataError,
                        coverCheckedVersion: COVER_CHECK_VERSION,
                        coverCheckedMtime: stats.mtimeMs,
                        coverCheckedSize: stats.size,
                        bitrate: bitrate,
                        sampleRate: sampleRate,
                        bitDepth: bitDepth
                    };
                    existing = item;
                }
                updated = true;
            }
            const compositeKey = `${normalizedId}_${finalQuality || 'unknown'}`;
            foundKeysOnDisk.add(compositeKey);
            if (oldKey && oldKey !== compositeKey) {
                index.delete(oldKey);
                index.set(compositeKey, existing);
                updated = true;
            }
            else if (!oldKey) {
                index.set(compositeKey, existing);
            }
            // Yield control back to Node.js event loop
            await new Promise(resolve => setImmediate(resolve));
        }
        // Remove deleted files from index
        for (const key of existingKeysInIndex) {
            if (!foundKeysOnDisk.has(key)) {
                index.delete(key);
                updated = true;
            }
        }
        if (updated) {
            exports.indexManager.save(normalizedUsername, folder);
        }
    }
    const syncKey = `${currentCacheLocation}:${normalizedUsername}`;
    const syncState = cacheListSyncState.get(syncKey) || { lastSync: 0 };
    syncState.lastSync = Date.now();
    cacheListSyncState.set(syncKey, syncState);
};
exports.syncCacheIndex = syncCacheIndex;
/**
 * Get detailed cache list for a user (indexed)
 */
const getCacheList = async (username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    // Keep indexed metadata aligned with disk. This also repairs stale hasCover values
    // from older indexes where the cover endpoint may already return 404.
    const cacheDir = (0, exports.getCacheDir)(normalizedUsername, false);
    const musicDir = (0, exports.getCacheDir)(normalizedUsername, true);
    const hasCacheIndex = fs_1.default.existsSync(path_1.default.join(cacheDir, 'cache_index.json'));
    const hasMusicIndex = fs_1.default.existsSync(path_1.default.join(musicDir, 'music_index.json'));
    const syncKey = `${currentCacheLocation}:${normalizedUsername}`;
    const syncState = cacheListSyncState.get(syncKey) || { lastSync: 0 };
    const mustSync = !hasCacheIndex || !hasMusicIndex;
    const shouldSync = mustSync || Date.now() - syncState.lastSync > CACHE_LIST_SYNC_TTL;
    if (shouldSync) {
        if (!syncState.pending) {
            syncState.pending = (0, exports.syncCacheIndex)(normalizedUsername)
                .then(() => { syncState.lastSync = Date.now(); })
                .finally(() => { syncState.pending = undefined; });
            cacheListSyncState.set(syncKey, syncState);
        }
        await syncState.pending;
    }
    const cacheItems = exports.indexManager.getAll(normalizedUsername, 'cache');
    const musicItems = exports.indexManager.getAll(normalizedUsername, 'music');
    const items = [...cacheItems, ...musicItems];
    return items.map(item => ({
        ...item,
        songInfo: {
            id: item.id,
            songmid: item.songmid || item.id,
            name: item.name,
            singer: item.singer,
            source: item.source,
            quality: item.quality,
            albumName: item.album,
            albumId: item.albumId,
            img: item.img,
            interval: item.interval,
            type: item.quality, // Compatibility
            types: {} // To be filled if needed
        },
        hasLyric: item.hasLyric || !!item.lyricFilename
    }));
};
exports.getCacheList = getCacheList;
/**
 * Batch rename existing files to the current naming pattern
 */
const batchRenameCacheFiles = async (username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const folders = ['cache', 'music'];
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    for (const folder of folders) {
        const index = exports.indexManager.load(normalizedUsername, folder);
        const items = Array.from(index.values());
        let folderUpdated = false;
        for (const item of items) {
            const songInfo = {
                id: item.id,
                songmid: item.songmid || item.id,
                name: item.name,
                singer: item.singer,
                source: item.source,
                quality: item.quality,
                albumName: item.album,
                albumId: item.albumId,
                img: item.img,
                interval: item.interval
            };
            const newBaseName = getFileName(songInfo, item.quality, folder === 'music', normalizedUsername);
            const newFilename = `${newBaseName}.${item.ext}`;
            if (newFilename === item.filename) {
                skipCount++;
                continue;
            }
            const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
            const oldPath = path_1.default.join(dir, item.filename);
            const newPath = path_1.default.join(dir, newFilename);
            try {
                if (fs_1.default.existsSync(oldPath)) {
                    if (!fs_1.default.existsSync(newPath)) {
                        const oldStats = fs_1.default.statSync(oldPath);
                        const externalCover = readCoverCache(item.filename, normalizedUsername, oldStats);
                        fs_1.default.renameSync(oldPath, newPath);
                        if (item.lyricFilename) {
                            const oldLrcPath = path_1.default.join(dir, item.lyricFilename);
                            const newLrcFilename = `${newBaseName}.lrc`;
                            const newLrcPath = path_1.default.join(dir, newLrcFilename);
                            if (fs_1.default.existsSync(oldLrcPath)) {
                                fs_1.default.renameSync(oldLrcPath, newLrcPath);
                                item.lyricFilename = newLrcFilename;
                            }
                        }
                        item.filename = newFilename;
                        if (externalCover) {
                            writeCoverCache(newFilename, normalizedUsername, externalCover.data, externalCover.mime, fs_1.default.statSync(newPath));
                            item.coverType = 'cached';
                            item.hasCover = true;
                        }
                        successCount++;
                        folderUpdated = true;
                    }
                    else {
                        failCount++;
                    }
                }
                else {
                    failCount++;
                }
            }
            catch (e) {
                console.error(`[FileCache] Failed to rename ${item.filename} in ${folder}:`, e);
                failCount++;
            }
        }
        if (folderUpdated) {
            exports.indexManager.save(normalizedUsername, folder);
        }
    }
    return { success: true, successCount, failCount, skipCount };
};
exports.batchRenameCacheFiles = batchRenameCacheFiles;
/**
 * Batch update ID3 metadata (title, artist, album, cover) from index to physical files
 */
const batchUpdateMetadata = async (filenames, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    let successCount = 0;
    let failCount = 0;
    const allItems = [
        ...exports.indexManager.getAll(normalizedUsername, 'cache'),
        ...exports.indexManager.getAll(normalizedUsername, 'music')
    ];
    for (const filename of filenames) {
        const item = allItems.find(i => i.filename === filename);
        if (!item) {
            failCount++;
            continue;
        }
        const dir = (0, exports.getCacheDir)(normalizedUsername, item.folder === 'music');
        const filePath = path_1.default.join(dir, item.filename);
        if (!fs_1.default.existsSync(filePath)) {
            failCount++;
            continue;
        }
        try {
            let imageBuffer;
            let imageMime = 'image/jpeg';
            const imageUrl = item.img;
            if (imageUrl && imageUrl.startsWith('http') && !isPlaceholderCoverUrl(imageUrl)) {
                const chunks = [];
                const p = imageUrl.startsWith('https') ? https_1.default : http_1.default;
                imageBuffer = await new Promise((resolveI, rejectI) => {
                    const req = p.get(imageUrl, ires => {
                        if ((ires.statusCode || 500) >= 400) {
                            ires.resume();
                            rejectI(new Error(`Cover status: ${ires.statusCode}`));
                            return;
                        }
                        imageMime = String(ires.headers['content-type'] || 'image/jpeg').split(';')[0];
                        ires.on('data', c => chunks.push(c));
                        ires.on('end', () => resolveI(Buffer.concat(chunks)));
                        ires.on('error', rejectI);
                    });
                    req.on('error', rejectI);
                    setTimeout(() => { req.destroy(); rejectI(new Error('Timeout')); }, 8000);
                }).catch(() => undefined);
            }
            let tagger;
            let taggerError;
            try {
                tagger = new MusicTagger();
                tagger.loadPath(filePath);
                tagger.title = item.name || 'Unknown';
                tagger.artist = item.singer || 'Unknown';
                if (item.album)
                    tagger.album = item.album;
                if (imageBuffer && imageBuffer.length > 0) {
                    tagger.pictures = [new MetaPicture(imageMime, new Uint8Array(imageBuffer), 'Cover')];
                }
                tagger.save();
            }
            catch (e) {
                taggerError = e;
            }
            finally {
                try {
                    if (tagger)
                        tagger.dispose();
                }
                catch (e) { }
            }
            const stats = fs_1.default.statSync(filePath);
            const hasEmbeddedCover = readEmbeddedCoverState(filePath);
            let hasCover = hasEmbeddedCover || hasCachedCover(item.filename, normalizedUsername, stats);
            if (!hasCover && imageBuffer?.length) {
                hasCover = writeCoverCache(item.filename, normalizedUsername, imageBuffer, imageMime, stats);
                if (taggerError) {
                    console.warn(`[FileCache] Audio tags are unavailable for ${filename}; using external cover cache`);
                }
            }
            if (taggerError && !hasCover)
                throw taggerError;
            item.hasCover = hasCover;
            item.coverType = hasEmbeddedCover ? 'embedded' : hasCover ? 'cached' : hasUsableRemoteCover(item.img) ? 'remote' : 'none';
            item.metadataWritable = !taggerError;
            item.audioContainer = detectAudioContainer(filePath);
            item.metadataError = taggerError ? getMetadataUnsupportedMessage(item.audioContainer) : undefined;
            item.coverCheckedVersion = COVER_CHECK_VERSION;
            item.coverCheckedMtime = stats.mtimeMs;
            item.coverCheckedSize = stats.size;
            item.mtime = stats.mtimeMs;
            item.size = stats.size;
            exports.indexManager.update(normalizedUsername, item, item.folder);
            successCount++;
        }
        catch (e) {
            console.error(`[FileCache] Failed to update metadata for ${filename}:`, e);
            failCount++;
        }
    }
    return { successCount, failCount };
};
exports.batchUpdateMetadata = batchUpdateMetadata;
/**
 * Link an unindexed local file to a specific online song identity
 */
const linkLocalFile = async (oldFilename, songInfo, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    // Find the item in all possible folders
    const allItems = [
        ...exports.indexManager.getAll(normalizedUsername, 'cache'),
        ...exports.indexManager.getAll(normalizedUsername, 'music')
    ];
    const item = allItems.find(i => i.filename === oldFilename);
    if (!item)
        throw new Error('File not found in index');
    const folder = item.folder;
    const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
    const oldPath = path_1.default.join(dir, item.filename);
    if (!fs_1.default.existsSync(oldPath))
        throw new Error('Physical file not found');
    // Prepare new metadata from songInfo
    const metadata = extractSongMetadata(songInfo);
    const newId = metadata.id;
    const quality = item.quality || 'unknown';
    const ext = item.ext ? `.${item.ext}` : path_1.default.extname(oldFilename);
    // Generate new filename based on pattern (preserving subPath)
    const newBaseName = getFileName(songInfo, quality, folder === 'music', normalizedUsername);
    const subPath = item.subPath || '';
    const newFilename = subPath ? path_1.default.join(subPath, newBaseName + ext).replace(/\\/g, '/') : newBaseName + ext;
    const newPath = path_1.default.join(dir, newFilename);
    // Check collision
    if (newFilename !== oldFilename && fs_1.default.existsSync(newPath)) {
        throw new Error('Target filename already exists on disk');
    }
    // 1. Rename physical file
    if (newFilename !== oldFilename) {
        fs_1.default.renameSync(oldPath, newPath);
        // Also rename lyrics if exists
        if (item.lyricFilename) {
            const oldLrcPath = path_1.default.join(dir, item.lyricFilename);
            const newLrcFilename = subPath ? path_1.default.join(subPath, newBaseName + '.lrc').replace(/\\/g, '/') : newBaseName + '.lrc';
            const newLrcPath = path_1.default.join(dir, newLrcFilename);
            if (fs_1.default.existsSync(oldLrcPath)) {
                fs_1.default.renameSync(oldLrcPath, newLrcPath);
                item.lyricFilename = newLrcFilename;
            }
        }
    }
    // 2. Update Index
    // Remove old entry (keyed by old ID and quality)
    exports.indexManager.remove(normalizedUsername, item.id, folder, item.quality);
    // Update item properties
    item.id = newId;
    item.songmid = newId;
    item.name = metadata.name;
    item.singer = metadata.singer;
    item.album = metadata.album;
    item.albumId = metadata.albumId;
    item.img = metadata.img;
    item.source = metadata.source;
    item.filename = newFilename;
    item.mtime = Date.now();
    // Add back to index with new identity
    exports.indexManager.update(normalizedUsername, item, folder);
    // 3. Post-link processing: Update ID3 tags and cover
    await (0, exports.batchUpdateMetadata)([newFilename], normalizedUsername);
    return {
        success: true,
        filename: newFilename,
        id: newId,
        metadata
    };
};
exports.linkLocalFile = linkLocalFile;
const downloadCoverImage = async (imageUrl, redirects = 0) => {
    if (!hasUsableRemoteCover(imageUrl) || redirects > 3)
        return null;
    return await new Promise((resolve) => {
        const client = imageUrl.startsWith('https:') ? https_1.default : http_1.default;
        const req = client.get(imageUrl, response => {
            const statusCode = response.statusCode || 500;
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                response.resume();
                const redirectedUrl = new URL(response.headers.location, imageUrl).toString();
                void downloadCoverImage(redirectedUrl, redirects + 1).then(resolve);
                return;
            }
            if (statusCode >= 400) {
                response.resume();
                resolve(null);
                return;
            }
            const chunks = [];
            let received = 0;
            response.on('data', chunk => {
                const buffer = Buffer.from(chunk);
                received += buffer.length;
                if (received <= 20 * 1024 * 1024)
                    chunks.push(buffer);
            });
            response.on('end', () => {
                if (received > 20 * 1024 * 1024) {
                    resolve(null);
                    return;
                }
                const data = Buffer.concat(chunks);
                const mime = detectImageMime(data);
                resolve(mime ? { data, mime } : null);
            });
            response.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(10000, () => {
            req.destroy();
            resolve(null);
        });
    });
};
const setIndexCoverState = (filename, username, coverType, stats, location) => {
    for (const folder of ['cache', 'music']) {
        const item = exports.indexManager.getAll(username, folder, location).find(candidate => candidate.filename === filename);
        if (!item)
            continue;
        item.coverType = coverType;
        item.hasCover = coverType !== 'none';
        item.coverCheckedVersion = COVER_CHECK_VERSION;
        if (stats) {
            item.coverCheckedMtime = stats.mtimeMs;
            item.coverCheckedSize = stats.size;
        }
        exports.indexManager.save(username, folder, location);
        return item;
    }
    return null;
};
/**
 * Get cover image for a cached file
 */
const getCacheCover = async (filename, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const locations = [
        currentCacheLocation,
        currentCacheLocation === exports.CACHE_ROOTS.DATA ? exports.CACHE_ROOTS.ROOT : exports.CACHE_ROOTS.DATA
    ];
    const roots = ['cache', 'music'];
    for (const loc of locations) {
        for (const folder of roots) {
            const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music', loc);
            const filePath = resolveCacheRelativePath(dir, filename); // [Fix] Allow subfolders safely
            if (filePath && fs_1.default.existsSync(filePath)) {
                let stats;
                try {
                    stats = fs_1.default.statSync(filePath);
                    const cachedCover = readCoverCache(filename, normalizedUsername, stats);
                    if (cachedCover) {
                        setIndexCoverState(filename, normalizedUsername, 'cached', stats, loc);
                        return cachedCover;
                    }
                }
                catch (e) {
                    console.error(`[Cache] Error reading cover cache for: ${filename}`, e);
                }
                let tagger;
                try {
                    tagger = new MusicTagger();
                    tagger.loadPath(filePath);
                    const pics = tagger.pictures;
                    const pic = Array.isArray(pics) ? pics.find(hasValidPictureData) : null;
                    if (pic) {
                        const mime = pic.mimeType || 'image/jpeg';
                        const data = Buffer.from(pic.data);
                        writeCoverCache(filename, normalizedUsername, data, mime, stats);
                        setIndexCoverState(filename, normalizedUsername, 'embedded', stats, loc);
                        return { data, mime: detectImageMime(data) || mime };
                    }
                }
                catch (e) {
                    // console.error(`[Cache] Error reading tags for cover: ${filename}`, e)
                }
                finally {
                    try {
                        if (tagger)
                            tagger.dispose();
                    }
                    catch (e) { }
                }
                const item = [...exports.indexManager.getAll(normalizedUsername, 'cache', loc), ...exports.indexManager.getAll(normalizedUsername, 'music', loc)]
                    .find(candidate => candidate.filename === filename);
                if (item && hasUsableRemoteCover(item.img)) {
                    const remoteCover = await downloadCoverImage(item.img);
                    if (remoteCover && writeCoverCache(filename, normalizedUsername, remoteCover.data, remoteCover.mime, stats)) {
                        setIndexCoverState(filename, normalizedUsername, 'cached', stats, loc);
                        return remoteCover;
                    }
                }
                setIndexCoverState(filename, normalizedUsername, 'none', stats, loc);
            }
        }
    }
    return null;
};
exports.getCacheCover = getCacheCover;
/**
 * Remove a specific cache file
 */
const removeCacheFile = (filename, username, requestedFolder) => {
    if (!filename || typeof filename !== 'string')
        throw new Error('Invalid filename');
    if (requestedFolder && requestedFolder !== 'cache' && requestedFolder !== 'music')
        throw new Error('Invalid folder');
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const candidateFolders = requestedFolder ? [requestedFolder] : ['cache', 'music'];
    const matches = candidateFolders.map(folder => {
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        const filePath = resolveCacheRelativePath(dir, filename);
        return filePath && fs_1.default.existsSync(filePath) ? { folder, dir, filePath } : null;
    }).filter((entry) => entry !== null);
    // Older clients only sent a filename. Keep that format safe when the file has
    // a unique location, but never guess if cache and download both contain it.
    if (!requestedFolder && matches.length > 1) {
        throw new Error(`Ambiguous file location for ${filename}; folder is required`);
    }
    if (matches.length === 0)
        return { deleted: false };
    const { folder, dir, filePath } = matches[0];
    let coverCacheHash = '';
    try {
        coverCacheHash = getCoverCacheHash(filename, fs_1.default.statSync(filePath));
    }
    catch (e) { }
    try {
        fs_1.default.unlinkSync(filePath);
    }
    catch (e) {
        if (e?.code !== 'ENOENT')
            throw e;
    }
    console.log(`[FileCache] Deleted from ${folder}: ${filename}`);
    const ext = path_1.default.extname(filename);
    if (ext !== '.lrc') {
        const baseWithoutExt = filename.substring(0, filename.length - ext.length);
        const lrcPath = resolveCacheRelativePath(dir, baseWithoutExt + '.lrc');
        if (lrcPath && fs_1.default.existsSync(lrcPath)) {
            try {
                fs_1.default.unlinkSync(lrcPath);
            }
            catch (e) {
                if (e?.code !== 'ENOENT')
                    throw e;
            }
        }
    }
    const items = exports.indexManager.getAll(normalizedUsername, folder);
    const item = items.find(i => i.filename === filename);
    if (item)
        exports.indexManager.remove(normalizedUsername, item.id, folder, item.quality);
    // Cover cache is shared by filename. Preserve it while the same relative file
    // still exists in the other root so deleting cache does not affect downloads.
    const otherFolder = folder === 'cache' ? 'music' : 'cache';
    const otherDir = (0, exports.getCacheDir)(normalizedUsername, otherFolder === 'music');
    const otherPath = resolveCacheRelativePath(otherDir, filename);
    const hasCounterpart = !!otherPath && fs_1.default.existsSync(otherPath);
    if (!hasCounterpart) {
        try {
            const coverCacheDir = (0, exports.getCoverCacheDir)(normalizedUsername);
            const hashes = [coverCacheHash, crypto_1.default.createHash('md5').update(filename).digest('hex')].filter(Boolean);
            for (const hash of hashes) {
                const binPath = path_1.default.join(coverCacheDir, `${hash}.bin`);
                const mimePath = path_1.default.join(coverCacheDir, `${hash}.mime`);
                if (fs_1.default.existsSync(binPath))
                    fs_1.default.unlinkSync(binPath);
                if (fs_1.default.existsSync(mimePath))
                    fs_1.default.unlinkSync(mimePath);
            }
        }
        catch (e) { }
    }
    return { deleted: true, folder };
};
exports.removeCacheFile = removeCacheFile;
const setCacheLocation = (location) => {
    if (location === exports.CACHE_ROOTS.DATA || location === exports.CACHE_ROOTS.ROOT) {
        currentCacheLocation = location;
        console.log(`[FileCache] Base cache location set to: ${location}`);
    }
};
exports.setCacheLocation = setCacheLocation;
const getCacheLocation = () => currentCacheLocation;
exports.getCacheLocation = getCacheLocation;
const checkCache = (songInfo, username, isLyricCheck = false) => {
    try {
        const id = (0, exports.normalizeSongId)(songInfo);
        const quality = songInfo.quality || 'unknown';
        const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
        // 1. Search by exact ID and Quality (Primary Check)
        // exactQuality=true 时：精确匹配，不允许 fallback 到不同音质
        const useExact = !!songInfo.exactQuality;
        const folderTypes = ['cache', 'music'];
        for (const folder of folderTypes) {
            const cached = exports.indexManager.get(normalizedUsername, id, folder, quality, useExact);
            if (cached) {
                // 二次校验：exactQuality 模式下确保音质匹配
                if (useExact && quality && cached.quality !== quality)
                    continue;
                const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
                const fileName = isLyricCheck ? cached.lyricFilename : cached.filename;
                if (!fileName)
                    continue;
                const filePath = path_1.default.join(dir, fileName);
                if (fs_1.default.existsSync(filePath)) {
                    return {
                        exists: true,
                        path: filePath,
                        filename: fileName,
                        foundIn: normalizedUsername,
                        quality: cached.quality,
                        folder: folder,
                        url: `/api/music/cache/file/${encodeURIComponent(normalizedUsername)}/${encodeURIComponent(fileName)}?folder=${folder}`
                    };
                }
                else {
                    // Stale index entry, cleanup
                    if (!isLyricCheck)
                        exports.indexManager.remove(normalizedUsername, id, folder, cached.quality);
                }
            }
        }
        // 2. Search for Naming Collisions (Same Name + Singer + Quality, but different ID)
        const allItems = [
            ...exports.indexManager.getAll(normalizedUsername, 'cache'),
            ...exports.indexManager.getAll(normalizedUsername, 'music')
        ];
        const collision = allItems.find(item => item.id !== id && // 排除当前正在查询的 ID 本身
            item.name.toLowerCase() === String(songInfo.name || '').toLowerCase() &&
            item.singer.toLowerCase() === String(songInfo.singer || '').toLowerCase() &&
            item.quality === quality &&
            (!isLyricCheck || item.hasLyric));
        if (collision) {
            return {
                exists: true,
                isCollision: true,
                collisionSource: collision.source,
                collisionSongmid: collision.songmid,
                filename: isLyricCheck ? collision.lyricFilename : collision.filename,
                quality: collision.quality,
                foundIn: normalizedUsername,
                folder: collision.folder
            };
        }
        // 3. Fallback for non-exact (only if requested)
        if (!songInfo.exactQuality && !isLyricCheck) {
            const folderTypes = ['cache', 'music'];
            for (const folder of folderTypes) {
                const cachedAny = exports.indexManager.get(normalizedUsername, id, folder);
                if (cachedAny) {
                    const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
                    const fileName = cachedAny.filename;
                    const filePath = path_1.default.join(dir, fileName);
                    if (fs_1.default.existsSync(filePath)) {
                        return {
                            exists: true,
                            path: filePath,
                            filename: fileName,
                            foundIn: normalizedUsername,
                            quality: cachedAny.quality,
                            folder: folder,
                            url: `/api/music/cache/file/${encodeURIComponent(normalizedUsername)}/${encodeURIComponent(fileName)}?folder=${folder}`
                        };
                    }
                }
            }
        }
    }
    catch (e) {
        console.error('[FileCache] checkCache error:', e);
    }
    return { exists: false };
};
exports.checkCache = checkCache;
const checkLyricCache = (songInfo, username) => {
    const id = (0, exports.normalizeSongId)(songInfo);
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    // Check index first
    const folderTypes = ['cache', 'music'];
    for (const folder of folderTypes) {
        const cached = exports.indexManager.get(normalizedUsername, id, folder, songInfo.quality);
        if (cached && cached.hasLyric && cached.lyricFilename) {
            const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
            const lrcPath = path_1.default.join(dir, cached.lyricFilename);
            if (fs_1.default.existsSync(lrcPath)) {
                return {
                    exists: true,
                    path: lrcPath,
                    content: (0, lrcTool_1.parseLyrics)(fs_1.default.readFileSync(lrcPath, 'utf-8')),
                    filename: cached.lyricFilename
                };
            }
        }
    }
    // [Fix] Index-based name+singer fallback for the simple naming pattern
    // When the lrc filename does not contain a song ID, match by name + singer from the index
    if (songInfo.name && songInfo.singer) {
        const targetName = String(songInfo.name).toLowerCase();
        const targetSinger = String(songInfo.singer).toLowerCase();
        for (const folder of folderTypes) {
            const allItems = exports.indexManager.getAll(normalizedUsername, folder);
            const matched = allItems.find(item => item.hasLyric &&
                item.lyricFilename &&
                item.name.toLowerCase() === targetName &&
                item.singer.toLowerCase() === targetSinger);
            if (matched && matched.lyricFilename) {
                const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
                const lrcPath = path_1.default.join(dir, matched.lyricFilename);
                if (fs_1.default.existsSync(lrcPath)) {
                    return {
                        exists: true,
                        path: lrcPath,
                        content: (0, lrcTool_1.parseLyrics)(fs_1.default.readFileSync(lrcPath, 'utf-8')),
                        filename: matched.lyricFilename
                    };
                }
            }
        }
    }
    // Physical scan fallback (for standard naming pattern: Name_-_Singer_-_Source_-_ID_-_Quality)
    const roots = ['cache', 'music'];
    const basePaths = roots.map(folder => (0, exports.getCacheDir)(normalizedUsername, folder === 'music'));
    // [Fix] Recursively search for lyrics if not in index
    const getAllLrcFiles = (dirPath, acc = []) => {
        if (!fs_1.default.existsSync(dirPath))
            return acc;
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                getAllLrcFiles(fullPath, acc);
            }
            else if (entry.name.endsWith('.lrc')) {
                acc.push(fullPath);
            }
        }
        return acc;
    };
    const cleanId = (sid) => String(sid || '').replace(/^(tx|mg|wy|kg|kw|bd|mg)_/, '');
    const targetCleanId = cleanId(id);
    for (const dirPath of basePaths) {
        const lrcFiles = getAllLrcFiles(dirPath);
        for (const filePath of lrcFiles) {
            const file = path_1.default.basename(filePath);
            const fileNameWithoutExt = file.substring(0, file.lastIndexOf('.'));
            const segments = fileNameWithoutExt.split('_-_');
            if (segments.length >= 2) {
                const fileId = segments[segments.length - 2];
                const fileCleanId = cleanId(fileId);
                if (fileId === id || fileCleanId === id || fileId === targetCleanId || fileCleanId === targetCleanId) {
                    return {
                        exists: true,
                        path: filePath,
                        content: (0, lrcTool_1.parseLyrics)(fs_1.default.readFileSync(filePath, 'utf-8')),
                        filename: path_1.default.relative(dirPath, filePath).replace(/\\/g, '/')
                    };
                }
            }
        }
    }
    return { exists: false };
};
exports.checkLyricCache = checkLyricCache;
const saveLyricCache = (songInfo, lyricsObj, username, isOnlyDownload) => {
    try {
        let baseName;
        let quality = songInfo.quality || 'unknown';
        let dir;
        const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
        const id = (0, exports.normalizeSongId)(songInfo);
        const preferredFolders = isOnlyDownload ? ['music', 'cache'] : ['cache', 'music'];
        let audioResult = { exists: false };
        for (const folder of preferredFolders) {
            const cached = exports.indexManager.get(normalizedUsername, id, folder, songInfo.quality, false);
            if (!cached?.filename)
                continue;
            const root = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
            const filePath = path_1.default.join(root, cached.filename);
            if (fs_1.default.existsSync(filePath)) {
                audioResult = {
                    exists: true,
                    path: filePath,
                    quality: cached.quality,
                    folder,
                    filename: cached.filename
                };
                break;
            }
        }
        if (audioResult.exists && audioResult.path) {
            // If audio exists, save lyric in the same folder
            dir = path_1.default.dirname(audioResult.path);
            quality = audioResult.quality || quality;
            baseName = path_1.default.basename(audioResult.path, path_1.default.extname(audioResult.path));
        }
        else {
            // Audio not found, fallback to target dir
            dir = ensureDir(username, isOnlyDownload);
            if (songInfo.quality) {
                baseName = getFileName(songInfo, songInfo.quality, isOnlyDownload, username);
            }
            else {
                baseName = getFileName(songInfo, 'unknown', isOnlyDownload, username);
            }
        }
        const lyricFile = baseName + '.lrc';
        const finalPath = path_1.default.join(dir, lyricFile);
        const formattedLrc = (0, lrcTool_1.buildLyrics)(lyricsObj);
        if (!formattedLrc) {
            console.log(`[FileCache] Empty lyrics for ${baseName}, skip saving.`);
            return false;
        }
        fs_1.default.writeFileSync(finalPath, formattedLrc, { encoding: 'utf-8' });
        console.log(`[FileCache] Lyric cached saved to: ${finalPath}`);
        // Update index — use normalizeSongId to ensure the ID has source prefix, matching index keys
        const foldersToUpdate = isOnlyDownload ? ['music', 'cache'] : ['cache', 'music'];
        for (const folder of foldersToUpdate) {
            const existing = exports.indexManager.get(normalizedUsername, id, folder, quality);
            if (existing) {
                const root = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
                existing.lyricFilename = path_1.default.relative(root, finalPath).replace(/\\/g, '/');
                existing.hasLyric = true;
                exports.indexManager.save(normalizedUsername, folder);
                break;
            }
        }
        void (0, exports.checkAndCleanupCache)(username);
        return true;
    }
    catch (err) {
        console.error(`[FileCache] Lyric cache save failed: ${err.message}`);
        return false;
    }
};
exports.saveLyricCache = saveLyricCache;
const ensureCachedLyrics = async (songInfo, quality, username, isOnlyDownload, audioPath, folder, shouldCacheLyric, shouldEmbedLyric) => {
    if ((!shouldCacheLyric && !shouldEmbedLyric) || !_lyricFetcher || !fs_1.default.existsSync(audioPath))
        return;
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const id = (0, exports.normalizeSongId)(songInfo);
    const resolvedQuality = quality || 'unknown';
    const relativeAudioPath = path_1.default.relative((0, exports.getCacheDir)(normalizedUsername, folder === 'music'), audioPath).replace(/\\/g, '/');
    const item = exports.indexManager.get(normalizedUsername, id, folder, resolvedQuality, true)
        || exports.indexManager.getAll(normalizedUsername, folder).find(candidate => candidate.filename === relativeAudioPath);
    const lyricPath = audioPath.substring(0, audioPath.length - path_1.default.extname(audioPath).length) + '.lrc';
    let hasCachedLyric = fs_1.default.existsSync(lyricPath);
    let hasEmbedLyric = item?.hasEmbedLyric === true;
    let metadataWritable = item?.metadataWritable !== false;
    let metadataError = item?.metadataError;
    let embedLyricError = item?.embedLyricError;
    const audioContainer = item?.audioContainer || detectAudioContainer(audioPath);
    if (shouldEmbedLyric && !hasEmbedLyric && metadataWritable) {
        let tagger;
        try {
            tagger = new MusicTagger();
            tagger.loadPath(audioPath);
            const lyricsInTag = tagger.lyrics;
            hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10);
        }
        catch (e) {
            metadataWritable = false;
            metadataError = getMetadataUnsupportedMessage(audioContainer);
            embedLyricError = metadataError;
        }
        finally {
            try {
                if (tagger)
                    tagger.dispose();
            }
            catch (e) { }
        }
    }
    const embedRequirementHandled = !shouldEmbedLyric || hasEmbedLyric || !metadataWritable;
    if ((!shouldCacheLyric || hasCachedLyric) && embedRequirementHandled) {
        if (item && (item.hasLyric !== hasCachedLyric || item.hasEmbedLyric !== hasEmbedLyric || item.metadataWritable !== metadataWritable || item.embedLyricError !== embedLyricError)) {
            item.hasLyric = hasCachedLyric;
            item.lyricFilename = hasCachedLyric
                ? path_1.default.relative((0, exports.getCacheDir)(normalizedUsername, folder === 'music'), lyricPath).replace(/\\/g, '/')
                : undefined;
            item.hasEmbedLyric = hasEmbedLyric;
            item.audioContainer = audioContainer;
            item.metadataWritable = metadataWritable;
            item.metadataError = metadataError;
            item.embedLyricError = embedLyricError;
            exports.indexManager.save(normalizedUsername, folder);
        }
        return;
    }
    try {
        const lyricText = await _lyricFetcher({ ...songInfo, quality: resolvedQuality });
        if (!lyricText)
            return;
        if (shouldCacheLyric && !hasCachedLyric) {
            const lyricsObj = (0, lrcTool_1.parseLyrics)(lyricText);
            hasCachedLyric = (0, exports.saveLyricCache)({ ...songInfo, quality: resolvedQuality }, lyricsObj, username, isOnlyDownload) || fs_1.default.existsSync(lyricPath);
        }
        if (shouldEmbedLyric && !hasEmbedLyric && metadataWritable) {
            const embedResult = (0, exports.embedLyricsIntoFile)(audioPath, lyricText);
            hasEmbedLyric = embedResult.hasEmbedLyric;
            metadataWritable = embedResult.metadataWritable;
            metadataError = embedResult.metadataWritable ? undefined : embedResult.error;
            embedLyricError = embedResult.error;
            if (embedResult.success) {
                console.log(`[FileCache] USLT lyric embedded for: ${songInfo.name || songInfo.title || path_1.default.basename(audioPath)}`);
            }
            else {
                console.warn(`[FileCache] Lyric tag unavailable for ${path_1.default.basename(audioPath)}: ${embedResult.error}`);
            }
        }
        const finalItem = exports.indexManager.get(normalizedUsername, id, folder, resolvedQuality, true) || item;
        if (finalItem) {
            if (shouldCacheLyric && hasCachedLyric) {
                finalItem.hasLyric = true;
                finalItem.lyricFilename = path_1.default.relative((0, exports.getCacheDir)(normalizedUsername, folder === 'music'), lyricPath).replace(/\\/g, '/');
            }
            if (shouldEmbedLyric) {
                finalItem.hasEmbedLyric = hasEmbedLyric;
                finalItem.audioContainer = audioContainer;
                finalItem.metadataWritable = metadataWritable;
                finalItem.metadataError = metadataError;
                finalItem.embedLyricError = embedLyricError;
            }
            exports.indexManager.save(normalizedUsername, folder);
        }
    }
    catch (err) {
        console.warn(`[FileCache] Failed to ensure lyrics for ${path_1.default.basename(audioPath)}: ${err?.message || err}`);
    }
};
const downloadAndCache = async (songInfo, url, quality, username, signal, isOnlyDownload, shouldCacheLyric = true, shouldEmbedLyric = true, provenance = {}) => {
    const dir = ensureDir(username, isOnlyDownload);
    const baseName = getFileName(songInfo, quality, isOnlyDownload, username);
    const tempPath = path_1.default.join(dir, baseName + '.tmp');
    const songKey = (0, exports.normalizeSongId)(songInfo) + '_' + (quality || 'unknown');
    const requestedSource = provenance.requestedSource || songInfo.requestedSource || songInfo.source || 'unknown';
    const downloadSource = (0, exports.detectDownloadSource)(url, provenance.downloadSource || songInfo.downloadSource || songInfo.source);
    const sourceName = provenance.sourceName || songInfo.sourceName;
    const result = (0, exports.checkCache)({ ...songInfo, quality, exactQuality: true }, username, false);
    if (result.exists && !result.isCollision) {
        const targetFolder = isOnlyDownload ? 'music' : 'cache';
        if (result.folder === targetFolder && result.path) {
            await ensureCachedLyrics(songInfo, quality || result.quality, username, isOnlyDownload, result.path, targetFolder, shouldCacheLyric, shouldEmbedLyric);
            console.log(`[FileCache] Song already exists in ${targetFolder}, skipping download: ${result.filename}`);
            // 通知前端轮询：目标目录文件已存在，视为立即完成
            exports.cacheProgress.set(songKey, { progress: 100, status: 'exists' });
            setTimeout(() => exports.cacheProgress.delete(songKey), 30000);
            return Promise.resolve();
        }
        if (isOnlyDownload && result.folder === 'cache' && result.path) {
            const requestedOrCachedQuality = quality || result.quality || 'unknown';
            const inspection = inspectAudioFile(result.path, requestedOrCachedQuality);
            const actualQuality = inspection.quality || requestedOrCachedQuality;
            const sourceExt = path_1.default.extname(result.filename || result.path) || '.mp3';
            const ext = inspection.extension || sourceExt;
            const finalBaseName = getFileName(songInfo, actualQuality, isOnlyDownload, username);
            const finalPath = path_1.default.join(dir, finalBaseName + ext);
            if (!fs_1.default.existsSync(finalPath)) {
                fs_1.default.copyFileSync(result.path, finalPath);
            }
            const metadata = extractSongMetadata(songInfo);
            const id = metadata.id || String(songInfo.id || songInfo.songmid);
            const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
            const cachedItem = (0, exports.getIndexItemByFilename)(result.filename, normalizedUsername);
            const actualDownloadSource = cachedItem?.downloadSource || downloadSource;
            const actualSourceName = cachedItem?.sourceName || sourceName;
            const stat = fs_1.default.statSync(finalPath);
            let hasCover = false;
            let hasEmbedLyric = false;
            let metadataWritable = false;
            const audioContainer = inspection.audioContainer;
            try {
                const tagger = new MusicTagger();
                tagger.loadPath(finalPath);
                hasCover = hasValidEmbeddedCover(tagger.pictures);
                const lyricsInTag = tagger.lyrics;
                hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10);
                metadataWritable = true;
                tagger.dispose();
            }
            catch (e) { }
            let coverType = hasCover ? 'embedded' : 'none';
            if (!hasCover) {
                const sourceCover = await (0, exports.getCacheCover)(result.filename, normalizedUsername);
                if (sourceCover?.data?.length && writeCoverCache(path_1.default.basename(finalPath), normalizedUsername, sourceCover.data, sourceCover.mime, stat)) {
                    hasCover = true;
                    coverType = 'cached';
                }
                else if (hasUsableRemoteCover(metadata.img)) {
                    hasCover = true;
                    coverType = 'remote';
                }
            }
            let lyricFilename;
            const sourceLyricPath = result.path.substring(0, result.path.length - sourceExt.length) + '.lrc';
            if (shouldCacheLyric && fs_1.default.existsSync(sourceLyricPath)) {
                const targetLyricPath = path_1.default.join(dir, finalBaseName + '.lrc');
                fs_1.default.copyFileSync(sourceLyricPath, targetLyricPath);
                lyricFilename = path_1.default.basename(targetLyricPath);
            }
            exports.indexManager.update(normalizedUsername, {
                id, songmid: id, name: metadata.name, singer: metadata.singer,
                album: metadata.album, albumId: metadata.albumId, img: metadata.img,
                interval: metadata.interval, source: metadata.source, requestedSource,
                downloadSource: actualDownloadSource, sourceName: actualSourceName,
                quality: actualQuality, filename: path_1.default.basename(finalPath),
                folder: 'music', mtime: Date.now(), size: stat.size,
                lyricFilename,
                ext: ext.replace('.', ''),
                hasCover,
                coverType,
                hasLyric: !!lyricFilename,
                hasEmbedLyric,
                audioContainer,
                bitrate: inspection.bitrate,
                sampleRate: inspection.sampleRate,
                bitDepth: inspection.bitDepth,
                metadataWritable,
                metadataError: metadataWritable ? undefined : getMetadataUnsupportedMessage(audioContainer)
            }, 'music');
            await ensureCachedLyrics(songInfo, actualQuality, username, true, finalPath, 'music', shouldCacheLyric, shouldEmbedLyric);
            console.log(`[FileCache] Copied cached song to music folder: ${path_1.default.basename(finalPath)}`);
            exports.cacheProgress.set(songKey, { progress: 100, status: 'finished', total: stat.size, received: stat.size });
            setTimeout(() => exports.cacheProgress.delete(songKey), 30000);
            return Promise.resolve();
        }
        console.log(`[FileCache] Song already exists in ${result.folder}, skipping download: ${result.filename}`);
        exports.cacheProgress.set(songKey, { progress: 100, status: 'exists' });
        setTimeout(() => exports.cacheProgress.delete(songKey), 30000);
        return Promise.resolve();
    }
    // [去重] 同一 songKey 正在下载/写标签时直接跳过，避免并发重复下载
    // (如 Subsonic 客户端反复请求 stream、或音流并行触发原生缓存)
    const inFlight = exports.cacheProgress.get(songKey);
    if (inFlight && (inFlight.status === 'downloading' || inFlight.status === 'tagging')) {
        const age = Date.now() - (inFlight.updatedAt || 0);
        // 超过 10 分钟仍无进展视为卡死，允许本次重新下载（避免永久阻塞该歌曲，
        // 尤其 fire-and-forget 的 Subsonic 缓存触发没有 abort 信号）
        if (age < 10 * 60 * 1000) {
            console.log(`[FileCache] Download already in progress for ${songKey}, skipping duplicate`);
            return Promise.resolve();
        }
    }
    if (signal?.aborted)
        return;
    // 立即同步占坑标记下载中，关闭“拿到 200 响应前”的并发竞态窗口；
    // 后续到达的相同 songKey 请求会被上面的守卫跳过，不再重复下载。
    exports.cacheProgress.set(songKey, { progress: 0, status: 'downloading', total: 0, received: 0, speed: 0, updatedAt: Date.now() });
    console.log(`[FileCache] Starting download for: ${baseName}`);
    return new Promise((resolve, reject) => {
        let req;
        let settled = false;
        let redirectCount = 0;
        const MAX_REDIRECTS = 10;
        const fail = (err) => {
            if (settled)
                return;
            const message = err.message || 'Download failed';
            exports.cacheProgress.set(songKey, { progress: 0, status: 'error', errorMsg: message });
            settle(() => reject(err));
        };
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            if (signal)
                signal.removeEventListener('abort', abortHandler);
            fn();
        };
        const abortHandler = () => {
            if (req)
                req.destroy();
            if (fs_1.default.existsSync(tempPath))
                fs_1.default.unlink(tempPath, () => { });
            exports.cacheProgress.delete(songKey);
            settle(() => reject(new Error('Aborted')));
        };
        if (signal)
            signal.addEventListener('abort', abortHandler);
        // 递归下载，自动跟随 3xx 重定向（浏览器会自动跟随，但 http.get 不会）
        const downloadFrom = (currentUrl) => {
            if (signal?.aborted) {
                fail(new Error('Aborted'));
                return;
            }
            const protocol = currentUrl.startsWith('https') ? https_1.default : http_1.default;
            req = protocol.get(currentUrl, (res) => {
                const status = res.statusCode || 0;
                // 处理重定向：301/302/303/307/308
                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = res.headers['location'];
                    res.resume(); // 消费响应体，避免连接挂起
                    if (!location) {
                        fs_1.default.unlink(tempPath, () => { });
                        fail(new Error(`Status: ${status} (missing Location header)`));
                        return;
                    }
                    if (redirectCount >= MAX_REDIRECTS) {
                        fs_1.default.unlink(tempPath, () => { });
                        fail(new Error(`Too many redirects (${MAX_REDIRECTS})`));
                        return;
                    }
                    redirectCount++;
                    const nextUrl = new URL(location, currentUrl).toString();
                    console.log(`[FileCache] Redirect ${status} -> ${nextUrl} (${redirectCount}/${MAX_REDIRECTS})`);
                    downloadFrom(nextUrl);
                    return;
                }
                if (status !== 200) {
                    fs_1.default.unlink(tempPath, () => { });
                    fail(new Error(`Status: ${status}`));
                    return;
                }
                exports.cacheProgress.set(songKey, { progress: 0, status: 'downloading', total: 0, received: 0, speed: 0, updatedAt: Date.now() });
                const total = parseInt(res.headers['content-length'] || '0', 10);
                let received = 0;
                let lastSpeedAt = Date.now();
                let lastSpeedBytes = 0;
                let currentSpeed = 0;
                const contentType = res.headers['content-type'] || '';
                let headerExt = '.mp3';
                if (contentType.includes('audio/flac'))
                    headerExt = '.flac';
                else if (contentType.includes('audio/ogg'))
                    headerExt = '.ogg';
                else if (contentType.includes('audio/x-m4a') || contentType.includes('audio/mp4'))
                    headerExt = '.m4a';
                else if (contentType.includes('audio/wav'))
                    headerExt = '.wav';
                const fileStream = fs_1.default.createWriteStream(tempPath);
                let writeFinished = false;
                res.on('data', (chunk) => {
                    received += chunk.length;
                    const now = Date.now();
                    if (now - lastSpeedAt >= 1000) {
                        currentSpeed = Math.max(0, (received - lastSpeedBytes) / ((now - lastSpeedAt) / 1000));
                        lastSpeedAt = now;
                        lastSpeedBytes = received;
                    }
                    const progress = total > 0 ? Math.round((received / total) * 100) : 0;
                    exports.cacheProgress.set(songKey, { progress, status: 'downloading', total, received, speed: currentSpeed, updatedAt: now });
                });
                res.pipe(fileStream);
                fileStream.on('finish', () => { writeFinished = true; });
                fileStream.on('close', async () => {
                    if (settled)
                        return;
                    if (!writeFinished) {
                        fs_1.default.unlink(tempPath, () => { });
                        fail(new Error('Download stream closed before write finished'));
                        return;
                    }
                    if (total > 0 && received < total) {
                        fs_1.default.unlink(tempPath, () => { });
                        fail(new Error(`Download incomplete: ${received}/${total}`));
                        return;
                    }
                    exports.cacheProgress.set(songKey, { progress: 100, status: 'tagging', total, received, speed: 0, updatedAt: Date.now() });
                    let ext = headerExt;
                    if (fs_1.default.existsSync(tempPath)) {
                        try {
                            const { fileTypeFromFile } = await import('file-type');
                            const type = await fileTypeFromFile(tempPath);
                            if (type)
                                ext = `.${type.ext}`;
                        }
                        catch (e) { }
                    }
                    const inspection = inspectAudioFile(tempPath, quality);
                    ext = inspection.extension || ext;
                    const actualQuality = inspection.quality || quality || 'unknown';
                    const finalBaseName = getFileName(songInfo, actualQuality, isOnlyDownload, username);
                    const finalPath = path_1.default.join(dir, finalBaseName + ext);
                    fs_1.default.rename(tempPath, finalPath, async (err) => {
                        if (err) {
                            fs_1.default.unlink(tempPath, () => { });
                            fail(err);
                            return;
                        }
                        let imageBuffer;
                        let imageMime = 'image/jpeg';
                        try {
                            const imageUrl = songInfo.img || (songInfo.meta && songInfo.meta.picUrl);
                            if (imageUrl && imageUrl.startsWith('http') && !isPlaceholderCoverUrl(imageUrl)) {
                                const chunks = [];
                                const p = imageUrl.startsWith('https') ? https_1.default : http_1.default;
                                imageBuffer = await new Promise((resolveI, rejectI) => {
                                    const imgReq = p.get(imageUrl, ires => {
                                        if (ires.statusCode && ires.statusCode >= 400) {
                                            ires.resume();
                                            rejectI(new Error(`Cover status: ${ires.statusCode}`));
                                            return;
                                        }
                                        imageMime = String(ires.headers['content-type'] || 'image/jpeg').split(';')[0];
                                        ires.on('data', c => chunks.push(c));
                                        ires.on('end', () => resolveI(Buffer.concat(chunks)));
                                        ires.on('error', rejectI);
                                    });
                                    imgReq.on('error', rejectI);
                                    imgReq.setTimeout(10000, () => {
                                        imgReq.destroy(new Error('Cover download timeout'));
                                    });
                                });
                            }
                        }
                        catch (e) { }
                        const metadata = extractSongMetadata(songInfo);
                        const id = metadata.id || String(songInfo.id || songInfo.songmid);
                        const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
                        const folderType = isOnlyDownload ? 'music' : 'cache';
                        exports.indexManager.update(normalizedUsername, {
                            id, songmid: id, name: metadata.name, singer: metadata.singer,
                            album: metadata.album, albumId: metadata.albumId, img: metadata.img,
                            interval: metadata.interval, source: metadata.source, requestedSource,
                            downloadSource, sourceName,
                            quality: actualQuality, filename: finalBaseName + ext,
                            folder: folderType, mtime: Date.now(), size: received,
                            ext: ext.replace('.', ''), hasCover: false, hasLyric: false,
                            audioContainer: inspection.audioContainer,
                            bitrate: inspection.bitrate,
                            sampleRate: inspection.sampleRate,
                            bitDepth: inspection.bitDepth,
                        }, folderType);
                        let tagger;
                        let metadataWritable = false;
                        try {
                            tagger = new MusicTagger();
                            tagger.loadPath(finalPath);
                            tagger.title = metadata.name;
                            tagger.artist = metadata.singer;
                            tagger.album = metadata.album;
                            if (imageBuffer && imageBuffer.length > 0)
                                tagger.pictures = [new MetaPicture(imageMime, new Uint8Array(imageBuffer), 'Cover')];
                            tagger.save();
                            metadataWritable = true;
                        }
                        catch (e) {
                        }
                        finally {
                            try {
                                if (tagger)
                                    tagger.dispose();
                            }
                            catch (e) { }
                        }
                        const taggedStats = fs_1.default.statSync(finalPath);
                        let finalHasCover = readEmbeddedCoverState(finalPath);
                        if (!finalHasCover && imageBuffer?.length) {
                            finalHasCover = writeCoverCache(finalBaseName + ext, normalizedUsername, imageBuffer, imageMime, taggedStats);
                        }
                        const taggedItem = exports.indexManager.get(normalizedUsername, id, folderType, actualQuality);
                        if (taggedItem) {
                            taggedItem.coverType = readEmbeddedCoverState(finalPath)
                                ? 'embedded'
                                : finalHasCover
                                    ? 'cached'
                                    : hasUsableRemoteCover(metadata.img)
                                        ? 'remote'
                                        : 'none';
                            taggedItem.hasCover = taggedItem.coverType !== 'none';
                            taggedItem.audioContainer = inspection.audioContainer;
                            taggedItem.metadataWritable = metadataWritable;
                            taggedItem.metadataError = metadataWritable ? undefined : getMetadataUnsupportedMessage(taggedItem.audioContainer);
                            taggedItem.coverCheckedVersion = COVER_CHECK_VERSION;
                            taggedItem.coverCheckedMtime = taggedStats.mtimeMs;
                            taggedItem.coverCheckedSize = taggedStats.size;
                            taggedItem.mtime = taggedStats.mtimeMs;
                            taggedItem.size = taggedStats.size;
                            exports.indexManager.save(normalizedUsername, folderType);
                        }
                        await ensureCachedLyrics(songInfo, actualQuality, username, isOnlyDownload, finalPath, folderType, shouldCacheLyric, shouldEmbedLyric);
                        exports.cacheProgress.set(songKey, { progress: 100, status: 'finished', total: total || received, received, speed: 0, updatedAt: Date.now() });
                        setTimeout(() => exports.cacheProgress.delete(songKey), 30000);
                        settle(() => { resolve(); void (0, exports.checkAndCleanupCache)(username); });
                    });
                });
                fileStream.on('error', (err) => { fs_1.default.unlink(tempPath, () => { }); fail(err); });
            });
            req.on('error', (err) => { fs_1.default.unlink(tempPath, () => { }); fail(err); });
            req.setTimeout(30000, () => {
                req.destroy(new Error('Download request timeout'));
            });
        };
        downloadFrom(url);
    });
};
exports.downloadAndCache = downloadAndCache;
const normalizeCacheUsername = (username) => (username && username !== '_open' && username !== 'default' ? username : '_open');
const resolveMusicPath = (root, relativePath) => {
    const resolvedRoot = path_1.default.resolve(root);
    const resolvedPath = path_1.default.resolve(root, relativePath);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path_1.default.sep)) {
        throw new Error('Invalid music file path');
    }
    return resolvedPath;
};
const getAvailableRemasterTarget = (root, subPath, preferredBaseName, extension, oldAudioPath, oldLyricPath, needsLyric) => {
    for (let index = 0; index < 10000; index++) {
        const suffix = index === 0 ? '' : ` (${index + 1})`;
        const baseName = preferredBaseName.substring(0, Math.max(1, 200 - suffix.length)) + suffix;
        const audioFilename = path_1.default.join(subPath, baseName + extension).replace(/\\/g, '/').replace(/^\.\//, '');
        const lyricFilename = path_1.default.join(subPath, baseName + '.lrc').replace(/\\/g, '/').replace(/^\.\//, '');
        const audioPath = resolveMusicPath(root, audioFilename);
        const lyricPath = resolveMusicPath(root, lyricFilename);
        const audioConflict = audioPath !== oldAudioPath && fs_1.default.existsSync(audioPath);
        const lyricConflict = needsLyric && lyricPath !== oldLyricPath && fs_1.default.existsSync(lyricPath);
        if (!audioConflict && !lyricConflict) {
            return { audioFilename, lyricFilename, audioPath, lyricPath };
        }
    }
    throw new Error('无法生成不冲突的目标文件名');
};
const getDownloadedMusicItems = async (username) => {
    const normalizedUsername = normalizeCacheUsername(username);
    await (0, exports.syncCacheIndex)(normalizedUsername, ['music']);
    return exports.indexManager.getAll(normalizedUsername, 'music').map(item => ({ ...item }));
};
exports.getDownloadedMusicItems = getDownloadedMusicItems;
const replaceDownloadedMusicItem = async (username, originalItem, songInfo, url, quality, signal) => {
    const normalizedUsername = normalizeCacheUsername(username);
    const root = (0, exports.getCacheDir)(normalizedUsername, true);
    const currentItem = exports.indexManager.get(normalizedUsername, originalItem.id, 'music', originalItem.quality, true);
    if (!currentItem || currentItem.filename !== originalItem.filename) {
        throw new Error('原文件已发生变化或已不存在');
    }
    if (quality === currentItem.quality)
        throw new Error('实际音质与原音质相同，无需替换');
    const oldAudioPath = resolveMusicPath(root, currentItem.filename);
    if (!fs_1.default.existsSync(oldAudioPath))
        throw new Error('原文件已不存在');
    const stageId = crypto_1.default.randomBytes(12).toString('hex');
    const stageUsername = `.remaster-staging/${stageId}`;
    const stageRoot = (0, exports.getCacheDir)(stageUsername, true);
    const stageCoverRoot = (0, exports.getCoverCacheDir)(stageUsername);
    const backupSuffix = `.remaster-${crypto_1.default.randomBytes(6).toString('hex')}.bak`;
    const oldAudioBackup = oldAudioPath + backupSuffix;
    let oldLyricPath = '';
    let oldLyricBackup = '';
    let targetAudioPath = '';
    let targetLyricPath = '';
    let replacementItem = null;
    let backedUpOldAudio = false;
    let backedUpOldLyric = false;
    let installedNewAudio = false;
    let installedNewLyric = false;
    let updatedNewIndex = false;
    let removedOldIndex = false;
    try {
        await (0, exports.downloadAndCache)(songInfo, url, quality, stageUsername, signal, true, true, true);
        if (signal?.aborted)
            throw new Error('Aborted');
        const stagedItems = exports.indexManager.getAll(stageUsername, 'music');
        const targetId = (0, exports.normalizeSongId)(songInfo);
        const downloadedItem = stagedItems.find(item => item.id === targetId) || stagedItems[0];
        if (!downloadedItem)
            throw new Error('新音质文件未写入暂存索引');
        const sourceAudioPath = resolveMusicPath(stageRoot, downloadedItem.filename);
        const sourceStats = fs_1.default.existsSync(sourceAudioPath) ? fs_1.default.statSync(sourceAudioPath) : null;
        if (!sourceStats?.isFile() || sourceStats.size <= 0)
            throw new Error('新音质文件无效或为空');
        const stagedHasCover = readEmbeddedCoverState(sourceAudioPath);
        const originalCover = stagedHasCover
            ? null
            : ((await (0, exports.getCacheCover)(downloadedItem.filename, stageUsername)) || (await (0, exports.getCacheCover)(currentItem.filename, normalizedUsername)));
        oldLyricPath = currentItem.lyricFilename ? resolveMusicPath(root, currentItem.lyricFilename) : '';
        oldLyricBackup = oldLyricPath ? oldLyricPath + backupSuffix : '';
        const sourceLyricPath = downloadedItem.lyricFilename
            ? resolveMusicPath(stageRoot, downloadedItem.lyricFilename)
            : '';
        const targetSubPath = currentItem.subPath || '';
        const downloadedExtension = path_1.default.extname(downloadedItem.filename) || `.${downloadedItem.ext || 'mp3'}`;
        const preferredBaseName = getFileName(songInfo, quality, true, normalizedUsername);
        const target = getAvailableRemasterTarget(root, targetSubPath, preferredBaseName, downloadedExtension, oldAudioPath, oldLyricPath, !!((sourceLyricPath && fs_1.default.existsSync(sourceLyricPath)) || (oldLyricPath && fs_1.default.existsSync(oldLyricPath))));
        const targetFilename = target.audioFilename;
        const targetLyricFilename = target.lyricFilename;
        targetAudioPath = target.audioPath;
        targetLyricPath = target.lyricPath;
        fs_1.default.renameSync(oldAudioPath, oldAudioBackup);
        backedUpOldAudio = true;
        if (oldLyricPath && fs_1.default.existsSync(oldLyricPath)) {
            fs_1.default.renameSync(oldLyricPath, oldLyricBackup);
            backedUpOldLyric = true;
        }
        fs_1.default.mkdirSync(path_1.default.dirname(targetAudioPath), { recursive: true });
        safeRenameSync(sourceAudioPath, targetAudioPath);
        installedNewAudio = true;
        let finalHasCover = readEmbeddedCoverState(targetAudioPath);
        if (!finalHasCover && originalCover?.data?.length) {
            let tagger;
            try {
                tagger = new MusicTagger();
                tagger.loadPath(targetAudioPath);
                tagger.pictures = [
                    new MetaPicture(originalCover.mime || 'image/jpeg', new Uint8Array(originalCover.data), 'Cover'),
                ];
                tagger.save();
            }
            catch (e) {
                console.warn(`[FileCache] Unable to embed the original cover in ${targetFilename}; using external cover cache`);
            }
            finally {
                try {
                    if (tagger)
                        tagger.dispose();
                }
                catch (e) { }
            }
            finalHasCover = readEmbeddedCoverState(targetAudioPath);
        }
        let finalLyricFilename;
        if (sourceLyricPath && fs_1.default.existsSync(sourceLyricPath)) {
            fs_1.default.mkdirSync(path_1.default.dirname(targetLyricPath), { recursive: true });
            if (sourceLyricPath !== targetLyricPath) {
                safeRenameSync(sourceLyricPath, targetLyricPath);
                installedNewLyric = true;
            }
            finalLyricFilename = targetLyricFilename;
        }
        else if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup)) {
            fs_1.default.mkdirSync(path_1.default.dirname(targetLyricPath), { recursive: true });
            fs_1.default.copyFileSync(oldLyricBackup, targetLyricPath);
            installedNewLyric = true;
            finalLyricFilename = targetLyricFilename;
        }
        const finalStats = fs_1.default.statSync(targetAudioPath);
        if (!finalHasCover && originalCover?.data?.length) {
            finalHasCover = writeCoverCache(targetFilename, normalizedUsername, originalCover.data, originalCover.mime || 'image/jpeg', finalStats);
        }
        replacementItem = {
            ...downloadedItem,
            id: currentItem.id,
            songmid: currentItem.songmid || currentItem.id,
            source: currentItem.source,
            filename: targetFilename,
            folder: 'music',
            subPath: targetSubPath,
            lyricFilename: finalLyricFilename,
            hasLyric: !!finalLyricFilename,
            hasCover: finalHasCover,
            coverType: readEmbeddedCoverState(targetAudioPath) ? 'embedded' : finalHasCover ? 'cached' : hasUsableRemoteCover(downloadedItem.img) ? 'remote' : 'none',
            coverCheckedVersion: COVER_CHECK_VERSION,
            coverCheckedMtime: finalStats.mtimeMs,
            coverCheckedSize: finalStats.size,
            mtime: finalStats.mtimeMs,
            size: finalStats.size,
        };
        replacementItem.hasCover = replacementItem.coverType !== 'none';
        exports.indexManager.update(normalizedUsername, replacementItem, 'music');
        updatedNewIndex = true;
        exports.indexManager.remove(normalizedUsername, currentItem.id, 'music', currentItem.quality);
        removedOldIndex = true;
        try {
            if (backedUpOldAudio && fs_1.default.existsSync(oldAudioBackup))
                fs_1.default.unlinkSync(oldAudioBackup);
        }
        catch (cleanupError) {
            console.warn('[FileCache] Failed to remove remaster audio backup:', cleanupError);
        }
        try {
            if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup))
                fs_1.default.unlinkSync(oldLyricBackup);
        }
        catch (cleanupError) {
            console.warn('[FileCache] Failed to remove remaster lyric backup:', cleanupError);
        }
        return { ...replacementItem };
    }
    catch (err) {
        try {
            if (updatedNewIndex && replacementItem) {
                exports.indexManager.remove(normalizedUsername, replacementItem.id, 'music', replacementItem.quality);
            }
            if (installedNewLyric && targetLyricPath && fs_1.default.existsSync(targetLyricPath))
                fs_1.default.unlinkSync(targetLyricPath);
            if (installedNewAudio && targetAudioPath && fs_1.default.existsSync(targetAudioPath))
                fs_1.default.unlinkSync(targetAudioPath);
            if (backedUpOldAudio && fs_1.default.existsSync(oldAudioBackup) && !fs_1.default.existsSync(oldAudioPath)) {
                fs_1.default.renameSync(oldAudioBackup, oldAudioPath);
            }
            if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup) && !fs_1.default.existsSync(oldLyricPath)) {
                fs_1.default.renameSync(oldLyricBackup, oldLyricPath);
            }
            if (removedOldIndex || updatedNewIndex) {
                exports.indexManager.update(normalizedUsername, currentItem, 'music');
            }
        }
        catch (rollbackError) {
            console.error('[FileCache] Failed to roll back remaster replacement:', rollbackError);
        }
        throw err;
    }
    finally {
        exports.indexManager.discard(stageUsername, 'music');
        try {
            if (fs_1.default.existsSync(stageRoot))
                fs_1.default.rmSync(stageRoot, { recursive: true, force: true });
        }
        catch (cleanupError) {
            console.warn('[FileCache] Failed to clean remaster staging directory:', cleanupError);
        }
        try {
            if (fs_1.default.existsSync(stageCoverRoot))
                fs_1.default.rmSync(stageCoverRoot, { recursive: true, force: true });
        }
        catch (cleanupError) {
            console.warn('[FileCache] Failed to clean remaster cover staging directory:', cleanupError);
        }
    }
};
exports.replaceDownloadedMusicItem = replaceDownloadedMusicItem;
const stopUserTasks = (username, songKey) => {
    const tasks = exports.activeTasks.get(username);
    if (!tasks)
        return;
    if (songKey) {
        const idx = tasks.findIndex(t => t.songKey === songKey);
        if (idx !== -1) {
            tasks[idx].controller.abort();
            tasks.splice(idx, 1);
        }
    }
    else {
        tasks.forEach(t => t.controller.abort());
        exports.activeTasks.delete(username);
    }
};
exports.stopUserTasks = stopUserTasks;
// [新增] 根据文件名从索引中查找对应条目（跨 cache/music 两个目录）
const getIndexItemByFilename = (filename, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of ['cache', 'music']) {
        const items = exports.indexManager.getAll(normalizedUsername, folder);
        const found = items.find((i) => i.filename === filename);
        if (found)
            return { ...found, folder };
    }
    return null;
};
exports.getIndexItemByFilename = getIndexItemByFilename;
// [新增] 暴露 lyricFetcher 引用，供外部接口（如 embedLyric）使用
const getLyricFetcher = () => _lyricFetcher;
exports.getLyricFetcher = getLyricFetcher;
// [新增] 更新索引中指定文件的 hasEmbedLyric 状态（由 embedLyric 接口成功写入后调用）
const setIndexEmbedLyric = (filename, username, value, metadata) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of ['cache', 'music']) {
        const items = exports.indexManager.getAll(normalizedUsername, folder);
        const found = items.find((i) => i.filename === filename);
        if (found) {
            found.hasEmbedLyric = value;
            if (metadata)
                Object.assign(found, metadata);
            exports.indexManager.save(normalizedUsername, folder);
            return true;
        }
    }
    return false;
};
exports.setIndexEmbedLyric = setIndexEmbedLyric;
const serveCacheFile = (req, res, filename, username) => {
    const locations = [
        currentCacheLocation,
        currentCacheLocation === exports.CACHE_ROOTS.DATA ? exports.CACHE_ROOTS.ROOT : exports.CACHE_ROOTS.DATA
    ];
    const roots = ['cache', 'music'];
    let filePath = '';
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const loc of locations) {
        for (const folder of roots) {
            const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music', loc);
            const checkPath = path_1.default.join(dir, filename); // [Fix] Allow subfolders
            if (fs_1.default.existsSync(checkPath)) {
                filePath = checkPath;
                break;
            }
        }
        if (filePath)
            break;
    }
    if (!filePath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    const stat = fs_1.default.statSync(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = (end - start) + 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': contentType,
        });
        fs_1.default.createReadStream(filePath, { start, end }).pipe(res);
    }
    else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
        fs_1.default.createReadStream(filePath).pipe(res);
    }
};
exports.serveCacheFile = serveCacheFile;
const getCacheStats = (username) => {
    const roots = ['cache', 'music'];
    const result = { cache: { totalSize: 0, fileCount: 0 }, music: { totalSize: 0, fileCount: 0 }, totalSize: 0, fileCount: 0 };
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of roots) {
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        if (!fs_1.default.existsSync(dir))
            continue;
        const files = fs_1.default.readdirSync(dir);
        const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.lrc'];
        for (const file of files) {
            const ext = path_1.default.extname(file).toLowerCase();
            if (extensions.includes(ext)) {
                try {
                    const stats = fs_1.default.statSync(path_1.default.join(dir, file));
                    result[folder].totalSize += stats.size;
                    result.totalSize += stats.size;
                    if (ext !== '.lrc') {
                        result[folder].fileCount++;
                        result.fileCount++;
                    }
                }
                catch (e) { }
            }
        }
    }
    return result;
};
exports.getCacheStats = getCacheStats;
const clearAllCache = (username) => {
    const roots = ['cache', 'music'];
    let deletedCount = 0;
    let freedSize = 0;
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of roots) {
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        if (!fs_1.default.existsSync(dir))
            continue;
        const files = fs_1.default.readdirSync(dir);
        for (const file of files) {
            try {
                const stats = fs_1.default.statSync(path_1.default.join(dir, file));
                fs_1.default.unlinkSync(path_1.default.join(dir, file));
                deletedCount++;
                freedSize += stats.size;
            }
            catch (e) { }
        }
        exports.indexManager.load(normalizedUsername, folder).clear();
        exports.indexManager.save(normalizedUsername, folder);
    }
    return { deletedCount, freedSize };
};
exports.clearAllCache = clearAllCache;
const clearLyricCache = (username) => {
    const roots = ['cache', 'music'];
    let deletedCount = 0;
    let freedSize = 0;
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of roots) {
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        if (!fs_1.default.existsSync(dir))
            continue;
        const files = fs_1.default.readdirSync(dir);
        for (const file of files) {
            if (file.endsWith('.lrc')) {
                try {
                    const stats = fs_1.default.statSync(path_1.default.join(dir, file));
                    fs_1.default.unlinkSync(path_1.default.join(dir, file));
                    deletedCount++;
                    freedSize += stats.size;
                }
                catch (e) { }
            }
        }
        const items = exports.indexManager.getAll(normalizedUsername, folder);
        items.forEach(item => { if (item.hasLyric) {
            item.hasLyric = false;
            item.lyricFilename = undefined;
        } });
        exports.indexManager.save(normalizedUsername, folder);
    }
    return { deletedCount, freedSize };
};
exports.clearLyricCache = clearLyricCache;
const checkAndCleanupCache = async (username) => {
    const config = global.lx.config;
    if (!config || !config['user.enableCacheSizeLimit'])
        return;
    const { totalSize } = (0, exports.getCacheStats)(username);
    const limitBytes = (config['user.cacheSizeLimit'] || 2000) * 1024 * 1024;
    if (totalSize <= limitBytes)
        return;
    const roots = ['cache', 'music'];
    const allFiles = [];
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    for (const folder of roots) {
        const dir = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
        if (!fs_1.default.existsSync(dir))
            continue;
        const files = fs_1.default.readdirSync(dir);
        for (const file of files) {
            try {
                const filePath = path_1.default.join(dir, file);
                const stats = fs_1.default.statSync(filePath);
                allFiles.push({ path: filePath, size: stats.size, mtime: stats.mtime.getTime() });
            }
            catch (e) { }
        }
    }
    allFiles.sort((a, b) => a.mtime - b.mtime);
    let currentSize = totalSize;
    const targetSize = limitBytes * 0.95;
    let deletedCount = 0;
    for (const file of allFiles) {
        if (currentSize <= targetSize)
            break;
        try {
            fs_1.default.unlinkSync(file.path);
            currentSize -= file.size;
            deletedCount++;
        }
        catch (e) { }
    }
    console.log(`[FileCache] Cleaned up ${deletedCount} files for ${normalizedUsername}`);
};
exports.checkAndCleanupCache = checkAndCleanupCache;
/**
 * Switch files between 'cache' and 'music' folders
 */
const switchFolder = async (filenames, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    let successCount = 0;
    let failCount = 0;
    const cacheIndex = exports.indexManager.load(normalizedUsername, 'cache');
    const musicIndex = exports.indexManager.load(normalizedUsername, 'music');
    const cacheDir = (0, exports.getCacheDir)(normalizedUsername, false);
    const musicDir = (0, exports.getCacheDir)(normalizedUsername, true);
    for (const filename of filenames) {
        let sourceFolder = null;
        let item = null;
        let inMusic = undefined;
        // Find which folder it belongs to
        const inCache = Array.from(cacheIndex.values()).find(i => i.filename === filename);
        if (inCache) {
            sourceFolder = 'cache';
            item = inCache;
        }
        else {
            inMusic = Array.from(musicIndex.values()).find(i => i.filename === filename);
            if (inMusic) {
                sourceFolder = 'music';
                item = inMusic;
            }
        }
        if (!sourceFolder || !item) {
            console.log(`[FileCache][DEBUG] switchFolder: not found in indexes`, { filename, inCache: !!inCache, inMusic: !!inMusic });
            failCount++;
            continue;
        }
        const targetFolder = sourceFolder === 'cache' ? 'music' : 'cache';
        // [Constraint] Cannot move from music subfolder to cache
        if (sourceFolder === 'music' && item.subPath && item.subPath !== '') {
            console.log(`[FileCache] Move blocked: ${filename} is in a subfolder and cannot move to cache.`);
            failCount++;
            continue;
        }
        const sourceDir = sourceFolder === 'music' ? musicDir : cacheDir;
        const targetDir = targetFolder === 'music' ? musicDir : cacheDir;
        const sourcePath = path_1.default.join(sourceDir, filename);
        const targetPath = path_1.default.join(targetDir, filename);
        try {
            console.log(`[FileCache][DEBUG] switchFolder start`, { filename, sourceFolder, targetFolder, sourcePath, targetPath });
            const srcExists = fs_1.default.existsSync(sourcePath);
            const tgtExists = fs_1.default.existsSync(targetPath);
            console.log(`[FileCache][DEBUG] existence`, { filename, srcExists, tgtExists });
            if (srcExists) {
                // Ensure target directory exists (including any nested subfolders)
                const targetPathDir = path_1.default.dirname(targetPath);
                if (!fs_1.default.existsSync(targetPathDir))
                    fs_1.default.mkdirSync(targetPathDir, { recursive: true });
                // Check collision in target folder
                if (fs_1.default.existsSync(targetPath)) {
                    console.log(`[FileCache] Move conflict: ${filename} already exists in ${targetFolder}, skipping.`);
                    failCount++;
                    continue;
                }
                // Move audio file
                try {
                    safeRenameSync(sourcePath, targetPath);
                    console.log(`[FileCache][DEBUG] moved audio`, { filename, sourcePath, targetPath });
                }
                catch (moveErr) {
                    const errMsg = moveErr instanceof Error ? moveErr.stack : String(moveErr);
                    console.error(`[FileCache][ERROR] move audio failed for ${filename}:`, errMsg);
                    failCount++;
                    continue;
                }
                // Move lyric file if exists
                if (item.lyricFilename) {
                    const sourceLrcPath = path_1.default.join(sourceDir, item.lyricFilename);
                    const targetLrcPath = path_1.default.join(targetDir, item.lyricFilename);
                    const targetLrcDir = path_1.default.dirname(targetLrcPath);
                    if (fs_1.default.existsSync(sourceLrcPath)) {
                        if (!fs_1.default.existsSync(targetLrcDir))
                            fs_1.default.mkdirSync(targetLrcDir, { recursive: true });
                        if (fs_1.default.existsSync(targetLrcPath))
                            fs_1.default.unlinkSync(targetLrcPath);
                        try {
                            safeRenameSync(sourceLrcPath, targetLrcPath);
                            console.log(`[FileCache][DEBUG] moved lyric`, { filename, sourceLrcPath, targetLrcPath });
                        }
                        catch (lrErr) {
                            const errMsg = lrErr instanceof Error ? lrErr.stack : String(lrErr);
                            console.error(`[FileCache][ERROR] move lyric failed for ${filename}:`, errMsg);
                        }
                    }
                    else {
                        console.log(`[FileCache][DEBUG] lyric not found`, { filename, sourceLrcPath });
                    }
                }
                // Update Index
                const removed = exports.indexManager.remove(normalizedUsername, item.id, sourceFolder, item.quality);
                console.log(`[FileCache][DEBUG] index remove result`, { filename, removed });
                item.folder = targetFolder;
                exports.indexManager.update(normalizedUsername, item, targetFolder);
                successCount++;
            }
            else {
                console.log(`[FileCache][DEBUG] source missing`, { filename, sourcePath });
                failCount++;
            }
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.stack : String(e);
            console.error(`[FileCache] Failed to move ${filename}:`, errMsg);
            failCount++;
        }
    }
    return { successCount, failCount };
};
exports.switchFolder = switchFolder;
const switchBaseLocation = async (filenames, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    let successCount = 0;
    let failCount = 0;
    const sourceLoc = currentCacheLocation;
    const targetLoc = sourceLoc === exports.CACHE_ROOTS.DATA ? exports.CACHE_ROOTS.ROOT : exports.CACHE_ROOTS.DATA;
    const folders = ['cache', 'music'];
    // Helper to get dir for a specific location
    const getLocalDir = (folder, loc) => {
        const folderName = folder === 'music' ? 'music' : 'cache';
        const base = loc === exports.CACHE_ROOTS.DATA ? global.lx.dataPath : process.cwd();
        const userDir = (username && username !== '_open' && username !== 'default') ? username : '_open';
        return path_1.default.join(base, folderName, userDir);
    };
    for (const filename of filenames) {
        let sourceFolder = null;
        let item = null;
        // Find folder in SOURCE location
        for (const folder of folders) {
            const items = exports.indexManager.getAll(normalizedUsername, folder, sourceLoc);
            const found = items.find(i => i.filename === filename);
            if (found) {
                sourceFolder = folder;
                item = found;
                break;
            }
        }
        if (!sourceFolder || !item) {
            failCount++;
            continue;
        }
        const sourceDir = getLocalDir(sourceFolder, sourceLoc);
        const targetDir = getLocalDir(sourceFolder, targetLoc);
        const sourcePath = path_1.default.join(sourceDir, filename);
        const targetPath = path_1.default.join(targetDir, filename);
        try {
            if (fs_1.default.existsSync(sourcePath)) {
                const targetPathDir = path_1.default.dirname(targetPath);
                if (!fs_1.default.existsSync(targetPathDir))
                    fs_1.default.mkdirSync(targetPathDir, { recursive: true });
                // Check collision in target location
                if (fs_1.default.existsSync(targetPath)) {
                    console.log(`[FileCache] Base move conflict: ${filename} already exists at ${targetLoc}, skipping.`);
                    failCount++;
                    continue;
                }
                // Move audio file
                safeRenameSync(sourcePath, targetPath);
                // Move lyrics
                if (item.lyricFilename) {
                    const sourceLrcPath = path_1.default.join(sourceDir, item.lyricFilename);
                    const targetLrcPath = path_1.default.join(targetDir, item.lyricFilename);
                    const targetLrcDir = path_1.default.dirname(targetLrcPath);
                    if (fs_1.default.existsSync(sourceLrcPath)) {
                        if (!fs_1.default.existsSync(targetLrcDir))
                            fs_1.default.mkdirSync(targetLrcDir, { recursive: true });
                        if (fs_1.default.existsSync(targetLrcPath))
                            fs_1.default.unlinkSync(targetLrcPath);
                        safeRenameSync(sourceLrcPath, targetLrcPath);
                    }
                }
                // Update Indices
                exports.indexManager.remove(normalizedUsername, item.id, sourceFolder, item.quality, sourceLoc);
                // item is now in the other location's index
                exports.indexManager.update(normalizedUsername, item, sourceFolder, targetLoc);
                successCount++;
            }
            else {
                failCount++;
            }
        }
        catch (e) {
            console.error(`[FileCache] Failed to move ${filename} from ${sourceLoc} to ${targetLoc}:`, e);
            failCount++;
        }
    }
    return { successCount, failCount, targetLoc };
};
exports.switchBaseLocation = switchBaseLocation;
/**
 * [New] Get all subdirectories in the music/cache folders
 */
const getSubDirectories = (username, folder) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const root = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
    if (!fs_1.default.existsSync(root))
        return [];
    const dirs = new Set();
    // 1. Get from index
    const items = exports.indexManager.getAll(normalizedUsername, folder);
    items.forEach(item => { if (item.subPath)
        dirs.add(item.subPath); });
    // 2. Scan physical tree (to include empty folders)
    const scanDirs = (dirPath, base) => {
        if (!fs_1.default.existsSync(dirPath))
            return;
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const fullPath = path_1.default.join(dirPath, entry.name);
                dirs.add(path_1.default.relative(base, fullPath).replace(/\\/g, '/'));
                scanDirs(fullPath, base);
            }
        }
    };
    scanDirs(root, root);
    return Array.from(dirs).sort();
};
exports.getSubDirectories = getSubDirectories;
/**
 * [New] Create a subdirectory
 */
const createSubDirectory = (username, folder, subPath) => {
    const root = (0, exports.getCacheDir)(username, folder === 'music');
    const target = path_1.default.join(root, subPath);
    if (!fs_1.default.existsSync(target)) {
        fs_1.default.mkdirSync(target, { recursive: true });
        return true;
    }
    return false;
};
exports.createSubDirectory = createSubDirectory;
/**
 * [New] Categorize multiple files into a subdirectory
 */
const categorizeFiles = async (filenames, targetSubPath, username) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const folder = 'music'; // Categorization is primarily for music folder
    const root = (0, exports.getCacheDir)(normalizedUsername, true);
    const targetDir = path_1.default.join(root, targetSubPath);
    if (targetSubPath && !fs_1.default.existsSync(targetDir)) {
        fs_1.default.mkdirSync(targetDir, { recursive: true });
    }
    const allItems = exports.indexManager.getAll(normalizedUsername, folder);
    let successCount = 0;
    let failCount = 0;
    for (const filename of filenames) {
        const item = allItems.find(i => i.filename === filename);
        if (!item) {
            console.warn(`[FileCache] Categorize: item not found for ${filename}`);
            failCount++;
            continue;
        }
        const oldPath = path_1.default.join(root, filename);
        const newFilename = targetSubPath ? path_1.default.join(targetSubPath, path_1.default.basename(filename)).replace(/\\/g, '/') : path_1.default.basename(filename);
        const newPath = path_1.default.join(root, newFilename);
        if (oldPath === newPath) {
            successCount++;
            continue;
        }
        try {
            // Physically move file
            if (fs_1.default.existsSync(oldPath)) {
                safeRenameSync(oldPath, newPath);
                // Move lyrics if exist
                const ext = path_1.default.extname(filename);
                const oldLrcPath = oldPath.substring(0, oldPath.length - ext.length) + '.lrc';
                const newLrcPath = newPath.substring(0, newPath.length - ext.length) + '.lrc';
                if (fs_1.default.existsSync(oldLrcPath)) {
                    safeRenameSync(oldLrcPath, newLrcPath);
                }
                // Update index
                item.filename = newFilename;
                item.subPath = targetSubPath;
                if (item.lyricFilename) {
                    const musicExt = path_1.default.extname(newFilename);
                    const lrcExt = path_1.default.extname(item.lyricFilename) || '.lrc';
                    item.lyricFilename = newFilename.substring(0, newFilename.length - musicExt.length) + lrcExt;
                }
            }
            else {
                failCount++;
                continue;
            }
            successCount++;
        }
        catch (e) {
            console.error('[FileCache] Categorize failed for ' + filename + ':', e);
            failCount++;
        }
    }
    exports.indexManager.save(normalizedUsername, folder);
    return { successCount, failCount };
};
exports.categorizeFiles = categorizeFiles;
/**
 * [New] Rename a subdirectory and update index entries
 */
const renameSubDirectory = (username, folder, oldSubPath, newSubPath) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const root = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
    const oldDir = path_1.default.join(root, oldSubPath);
    const newDir = path_1.default.join(root, newSubPath);
    if (!fs_1.default.existsSync(oldDir))
        return { success: false, message: '原分类目录不存在' };
    if (fs_1.default.existsSync(newDir))
        return { success: false, message: '目标分类目录名称已存在' };
    try {
        safeRenameSync(oldDir, newDir);
    }
    catch (e) {
        console.error('[FileCache] Rename directory failed:', e);
        return { success: false, message: e?.message || '重命名目录失败' };
    }
    // Update indexes
    const allItems = exports.indexManager.getAll(normalizedUsername, folder);
    let updatedCount = 0;
    for (const item of allItems) {
        if (item.subPath === oldSubPath || item.subPath?.startsWith(oldSubPath + '/')) {
            const relSub = item.subPath === oldSubPath ? '' : item.subPath.slice(oldSubPath.length + 1);
            const updatedSub = relSub ? `${newSubPath}/${relSub}` : newSubPath;
            item.subPath = updatedSub;
            if (item.filename) {
                const baseName = path_1.default.basename(item.filename);
                item.filename = `${updatedSub}/${baseName}`;
            }
            if (item.lyricFilename) {
                const baseLrc = path_1.default.basename(item.lyricFilename);
                item.lyricFilename = `${updatedSub}/${baseLrc}`;
            }
            updatedCount++;
        }
    }
    exports.indexManager.save(normalizedUsername, folder);
    return { success: true, updatedCount };
};
exports.renameSubDirectory = renameSubDirectory;
/**
 * [New] Delete a subdirectory. If deleteSongs is true, physically remove files and index. If false, move songs to root directory.
 */
const deleteSubDirectory = (username, folder, subPath, deleteSongs) => {
    const normalizedUsername = (username && username !== '_open' && username !== 'default') ? username : '_open';
    const root = (0, exports.getCacheDir)(normalizedUsername, folder === 'music');
    const targetDir = path_1.default.join(root, subPath);
    if (!fs_1.default.existsSync(targetDir))
        return { success: false, message: '分类目录不存在' };
    const allItems = exports.indexManager.getAll(normalizedUsername, folder);
    const affectedItems = allItems.filter(item => item.subPath === subPath || item.subPath?.startsWith(subPath + '/'));
    if (deleteSongs) {
        // Remove from index
        for (const item of affectedItems) {
            exports.indexManager.remove(normalizedUsername, item.id, folder, item.quality);
        }
        exports.indexManager.save(normalizedUsername, folder);
        // Remove physically
        try {
            fs_1.default.rmSync(targetDir, { recursive: true, force: true });
        }
        catch (e) {
            console.error('[FileCache] Delete directory physically failed:', e);
            return { success: false, message: e?.message || '删除物理目录失败' };
        }
        return { success: true, affectedCount: affectedItems.length, action: 'deleted' };
    }
    else {
        // Move songs and lyrics to root
        let movedCount = 0;
        for (const item of affectedItems) {
            const oldAudioPath = path_1.default.join(root, item.filename);
            const newFilename = path_1.default.basename(item.filename);
            const newAudioPath = path_1.default.join(root, newFilename);
            try {
                if (fs_1.default.existsSync(oldAudioPath)) {
                    if (oldAudioPath !== newAudioPath) {
                        safeRenameSync(oldAudioPath, newAudioPath);
                    }
                }
                if (item.lyricFilename) {
                    const oldLrcPath = path_1.default.join(root, item.lyricFilename);
                    const newLrcFilename = path_1.default.basename(item.lyricFilename);
                    const newLrcPath = path_1.default.join(root, newLrcFilename);
                    if (fs_1.default.existsSync(oldLrcPath) && oldLrcPath !== newLrcPath) {
                        safeRenameSync(oldLrcPath, newLrcPath);
                    }
                    item.lyricFilename = newLrcFilename;
                }
                item.filename = newFilename;
                item.subPath = '';
                movedCount++;
            }
            catch (e) {
                console.error('[FileCache] Move song to root failed:', item.filename, e);
            }
        }
        exports.indexManager.save(normalizedUsername, folder);
        // Remove empty directory (or with leftover unknown files)
        try {
            fs_1.default.rmSync(targetDir, { recursive: true, force: true });
        }
        catch (e) {
            console.warn('[FileCache] Delete emptied dir warning:', e);
        }
        return { success: true, affectedCount: movedCount, action: 'moved_to_root' };
    }
};
exports.deleteSubDirectory = deleteSubDirectory;
