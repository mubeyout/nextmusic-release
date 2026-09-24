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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceCustomMusicItem = exports.saveCustomLyricCache = exports.batchEmbedLyric = exports.batchUpdateMetadata = exports.linkCustomSong = exports.removeCustomFile = exports.serveCustomFile = exports.getCustomCover = exports.getCustomMusicList = exports.syncCustomIndex = exports.customIndexManager = exports.getCustomMusicDir = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const { MusicTagger, MetaPicture } = require('music-tag-native');
const user_1 = require("../user");
const common_1 = require("../utils/common");
const lrcTool_1 = require("../utils/lrcTool");
const fileCache_1 = require("./fileCache");
const fileCache = __importStar(require("./fileCache"));
// 获取用户配置的自定义音乐目录
const getCustomMusicDir = (username) => {
    if (!username || username === '_open' || username === 'default')
        return null;
    // [P2 共享媒体库 0924] owner 泛化:'shared_<libId>' 前缀路由到共享库目录(config.sharedLibraries)——
    // 扫描/索引/聚合/流播全链自动兼容(都走本函数);权限校验在路由层独立做,这里只解析目录
    if (String(username).startsWith('shared_')) {
        try {
            const libId = String(username).slice('shared_'.length);
            const libs = (global.lx.config.sharedLibraries || []);
            const lib = libs.find(l => l.id === libId && l.enabled !== false);
            if (lib && lib.dir) {
                const resolved = path_1.default.resolve(lib.dir);
                if (fs_1.default.existsSync(resolved))
                    return resolved;
            }
        }
        catch (e) { /* 配置异常当无目录 */ }
        return null;
    }
    try {
        const userCfg = (0, user_1.getUserConfig)(username);
        if (userCfg?.enableCustomMusicDir && userCfg?.customMusicDir) {
            const resolved = path_1.default.resolve(userCfg.customMusicDir);
            if (fs_1.default.existsSync(resolved)) {
                return resolved;
            }
        }
    }
    catch (e) {
        console.error(`[CustomMusic] Failed to get customMusicDir for ${username}:`, e);
    }
    return null;
};
exports.getCustomMusicDir = getCustomMusicDir;
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
        return 'unknown';
    }
    catch (e) {
        return 'unknown';
    }
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
const detectQualityFromBitrate = (bitrate, ext, tagger) => {
    const nativeQuality = String(tagger?.quality || '').toLowerCase();
    const isLossless = ext === '.flac' || ext === '.wav' || ext === '.ape' || nativeQuality === 'sq' || nativeQuality === 'hires';
    const br = bitrate || 0;
    if (isLossless) {
        const bitDepth = tagger?.bitDepth || 16;
        const sampleRate = tagger?.sampleRate || 44100;
        if (br > 4500 || sampleRate > 96000)
            return 'master';
        if (br > 1000 || bitDepth > 16 || sampleRate > 48000)
            return 'flac24bit';
        return 'flac';
    }
    if (br >= 240)
        return '320k';
    if (br >= 170)
        return '192k';
    return '128k';
};
class CustomIndexManager {
    indexes = new Map(); // username -> (compositeKey -> CustomCacheItem)
    getIndexFilePath(username) {
        const customDir = (0, exports.getCustomMusicDir)(username);
        if (!customDir)
            return null;
        return path_1.default.join(customDir, 'custom_index.json');
    }
    load(username) {
        const file = this.getIndexFilePath(username);
        if (!file || !fs_1.default.existsSync(file)) {
            const empty = new Map();
            this.indexes.set(username, empty);
            return empty;
        }
        try {
            const data = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
            const map = new Map(Object.entries(data));
            this.indexes.set(username, map);
            return map;
        }
        catch (e) {
            const empty = new Map();
            this.indexes.set(username, empty);
            return empty;
        }
    }
    save(username) {
        const file = this.getIndexFilePath(username);
        const index = this.indexes.get(username);
        if (!file || !index)
            return;
        try {
            const obj = Object.fromEntries(index);
            fs_1.default.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
        }
        catch (e) {
            console.error(`[CustomIndexManager] Failed to save custom_index.json for ${username}:`, e);
        }
    }
    getAll(username) {
        const index = this.indexes.get(username) || this.load(username);
        return Array.from(index.values());
    }
    set(username, key, item) {
        const index = this.indexes.get(username) || this.load(username);
        index.set(key, item);
    }
    remove(username, filenameOrKey) {
        const index = this.indexes.get(username) || this.load(username);
        let deleted = false;
        for (const [k, item] of Array.from(index.entries())) {
            if (item.filename === filenameOrKey || k === filenameOrKey) {
                index.delete(k);
                deleted = true;
            }
        }
        if (deleted)
            this.save(username);
        return deleted;
    }
}
exports.customIndexManager = new CustomIndexManager();
// 同步自定义目录下的歌曲并生成/更新 custom_index.json
// 递归扫描目录下的所有音频文件（支持任意深层子目录）
const scanAllFilesRecursively = async (baseDir, currentDir = baseDir) => {
    const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape'];
    let results = [];
    try {
        const entries = await fs_1.default.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules')
                continue;
            const fullPath = path_1.default.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                const subResults = await scanAllFilesRecursively(baseDir, fullPath);
                results = results.concat(subResults);
            }
            else if (entry.isFile()) {
                const ext = path_1.default.extname(entry.name).toLowerCase();
                if (extensions.includes(ext)) {
                    const rel = path_1.default.relative(baseDir, fullPath).replace(/\\/g, '/');
                    results.push({ relativePath: rel, fullPath });
                }
            }
        }
    }
    catch (e) {
        console.error(`[CustomMusic] Error reading dir ${currentDir}:`, e);
    }
    return results;
};
// 安全解析并检验文件路径，防止路径遍历攻击
const resolveSafePath = (baseDir, relativePath) => {
    const resolved = path_1.default.resolve(baseDir, relativePath);
    const normalizedBase = path_1.default.resolve(baseDir);
    if (resolved === normalizedBase || !resolved.startsWith(normalizedBase + path_1.default.sep)) {
        return null;
    }
    return resolved;
};
// 同步扫描并更新自定义目录索引
const syncCustomIndex = async (username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir || !fs_1.default.existsSync(customDir)) {
        throw new Error('用户未开启或未配置自定义音乐目录');
    }
    const index = exports.customIndexManager.load(username);
    const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape'];
    // 递归深层扫描所有子目录中的音频文件
    const scannedFiles = await scanAllFilesRecursively(customDir);
    const foundRelPaths = new Set();
    let updated = false;
    for (const fileObj of scannedFiles) {
        const relPath = fileObj.relativePath;
        const filePath = fileObj.fullPath;
        foundRelPaths.add(relPath);
        const ext = path_1.default.extname(filePath).toLowerCase();
        const stats = await fs_1.default.promises.stat(filePath);
        const subDir = path_1.default.dirname(relPath).replace(/\\/g, '/');
        const subPath = subDir === '.' ? '' : subDir;
        const existing = index.get(relPath);
        const lrcFilePath = filePath.substring(0, filePath.length - ext.length) + '.lrc';
        const hasLyricOnDisk = fs_1.default.existsSync(lrcFilePath);
        if (existing && existing.size === stats.size && existing.mtime === stats.mtimeMs && existing.hasLyric === hasLyricOnDisk) {
            continue;
        }
        let songName = '';
        let singer = '';
        let album = '';
        let duration = '';
        let bitrate;
        let sampleRate;
        let bitDepth;
        let hasEmbedCover = false;
        let hasEmbedLyric = false;
        let quality = '128k';
        const nameWithoutExt = path_1.default.basename(filePath, ext);
        if (nameWithoutExt.includes('_-_')) {
            const segs = nameWithoutExt.split('_-_');
            if (segs.length >= 4) {
                songName = segs[0];
                singer = segs[1];
            }
        }
        else if (nameWithoutExt.includes(' - ')) {
            const segs = nameWithoutExt.split(' - ');
            if (segs.length >= 2) {
                songName = segs[0];
                singer = segs[1];
                album = segs.slice(3).join(' - ');
            }
        }
        let tagger;
        try {
            tagger = new MusicTagger();
            tagger.loadPath(filePath);
            if (tagger.title)
                songName = tagger.title;
            if (tagger.artist)
                singer = tagger.artist;
            if (tagger.album)
                album = tagger.album;
            if (Array.isArray(tagger.pictures) && tagger.pictures.length > 0) {
                hasEmbedCover = tagger.pictures.some((pic) => pic && pic.data && detectImageMime(Buffer.from(pic.data)));
            }
            if (tagger.duration)
                duration = (0, common_1.formatPlayTime)(tagger.duration / 1000);
            bitrate = tagger.bitRate;
            sampleRate = tagger.sampleRate;
            bitDepth = tagger.bitDepth;
            quality = detectQualityFromBitrate(tagger.bitRate, ext, tagger);
            const lyricsInTag = tagger.lyrics;
            hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10);
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
        if (!songName)
            songName = nameWithoutExt;
        if (!singer)
            singer = '未知歌手';
        const id = existing?.id || `custom_${crypto_1.default.createHash('md5').update(relPath).digest('hex')}`;
        const newItem = {
            id,
            songmid: existing?.songmid || id,
            name: songName,
            singer: singer,
            album: album,
            albumId: existing?.albumId,
            img: existing?.img,
            interval: duration || existing?.interval || '',
            quality: quality,
            filename: relPath,
            folder: 'custom',
            subPath,
            source: existing?.source || 'custom',
            mtime: stats.mtimeMs,
            size: stats.size,
            ext: ext.replace('.', ''),
            hasCover: hasEmbedCover || !!existing?.hasCover,
            coverType: hasEmbedCover ? 'embedded' : (existing?.coverType || 'none'),
            hasLyric: hasLyricOnDisk,
            hasEmbedLyric,
            lyricFilename: hasLyricOnDisk ? path_1.default.basename(lrcFilePath) : undefined,
            bitrate,
            sampleRate,
            bitDepth
        };
        exports.customIndexManager.set(username, relPath, newItem);
        updated = true;
    }
    // 清理已从磁盘删除的文件索引及旧格式键
    for (const [k, item] of Array.from(index.entries())) {
        if (!foundRelPaths.has(item.filename) || k !== item.filename) {
            index.delete(k);
            updated = true;
        }
    }
    if (updated || !fs_1.default.existsSync(path_1.default.join(customDir, 'custom_index.json'))) {
        exports.customIndexManager.save(username);
    }
    return exports.customIndexManager.getAll(username);
};
exports.syncCustomIndex = syncCustomIndex;
// 获取自定义音乐列表（带 songInfo 转换）
const getCustomMusicList = async (username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        return [];
    const indexPath = path_1.default.join(customDir, 'custom_index.json');
    if (!fs_1.default.existsSync(indexPath)) {
        await (0, exports.syncCustomIndex)(username);
    }
    const items = exports.customIndexManager.getAll(username);
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
            type: item.quality,
            types: {}
        },
        hasLyric: item.hasLyric || !!item.lyricFilename
    }));
};
exports.getCustomMusicList = getCustomMusicList;
// 获取自定义目录音频封面
const getCustomCover = async (filename, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        return null;
    const filePath = resolveSafePath(customDir, filename);
    if (!filePath || !fs_1.default.existsSync(filePath))
        return null;
    let tagger;
    try {
        tagger = new MusicTagger();
        tagger.loadPath(filePath);
        const pics = tagger.pictures;
        if (Array.isArray(pics)) {
            for (const pic of pics) {
                if (pic && pic.data) {
                    const data = Buffer.from(pic.data);
                    const mime = detectImageMime(data) || pic.mimeType || 'image/jpeg';
                    return { data, mime };
                }
            }
        }
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
    return null;
};
exports.getCustomCover = getCustomCover;
// 流式服务自定义目录音频文件（支持 Range 206）
const serveCustomFile = (req, res, filename, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir) {
        res.writeHead(404);
        res.end('Custom directory not found or not enabled');
        return;
    }
    const filePath = resolveSafePath(customDir, filename);
    if (!filePath || !fs_1.default.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File Not Found');
        return;
    }
    const stat = fs_1.default.statSync(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.ape': 'audio/x-ape'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType
        });
        fs_1.default.createReadStream(filePath, { start, end }).pipe(res);
    }
    else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes'
        });
        fs_1.default.createReadStream(filePath).pipe(res);
    }
};
exports.serveCustomFile = serveCustomFile;
// 删除自定义目录下的文件
const removeCustomFile = (filename, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        return false;
    const filePath = resolveSafePath(customDir, filename);
    if (!filePath || !fs_1.default.existsSync(filePath))
        return false;
    try {
        fs_1.default.unlinkSync(filePath);
        const ext = path_1.default.extname(filePath);
        const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc';
        if (fs_1.default.existsSync(lrcPath)) {
            try {
                fs_1.default.unlinkSync(lrcPath);
            }
            catch (e) { }
        }
        exports.customIndexManager.remove(username, filename);
        return true;
    }
    catch (e) {
        console.error(`[CustomMusic] Failed to delete file ${filename}:`, e);
        return false;
    }
};
exports.removeCustomFile = removeCustomFile;
// 手动关联自定义目录歌曲（更新 ID3 标签及 custom_index.json）
const linkCustomSong = async (filename, songInfo, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        throw new Error('用户未启用或未配置自定义目录');
    const filePath = resolveSafePath(customDir, filename);
    if (!filePath || !fs_1.default.existsSync(filePath))
        throw new Error('音频文件未找到: ' + filename);
    // 1. 尝试使用 MusicTagger 写入 ID3 标签
    try {
        const tagger = new MusicTagger();
        tagger.loadPath(filePath);
        if (songInfo.name)
            tagger.title = songInfo.name;
        if (songInfo.singer)
            tagger.artist = songInfo.singer;
        if (songInfo.albumName)
            tagger.album = songInfo.albumName;
        tagger.save();
        tagger.dispose();
    }
    catch (e) {
        console.warn(`[CustomMusic] 写入音频标签失败: ${e.message}，继续更新索引`);
    }
    // 2. 更新 custom_index.json 中的元数据
    const index = exports.customIndexManager.load(username);
    const existing = index.get(filename);
    const stats = fs_1.default.statSync(filePath);
    const updatedItem = {
        ...(existing || {}),
        filename,
        subPath: existing?.subPath || '',
        folder: 'custom',
        source: songInfo.source || 'custom',
        id: songInfo.id || existing?.id || `custom_${crypto_1.default.createHash('md5').update(filename).digest('hex')}`,
        songmid: songInfo.songmid || songInfo.id || existing?.songmid,
        name: songInfo.name || existing?.name || path_1.default.basename(filename),
        singer: songInfo.singer || existing?.singer || '未知歌手',
        album: songInfo.albumName || songInfo.album || existing?.album || '',
        albumId: songInfo.albumId || existing?.albumId || '',
        img: songInfo.img || existing?.img || '',
        interval: songInfo.interval || existing?.interval || '',
        quality: existing?.quality || '128k',
        size: stats.size,
        mtime: stats.mtimeMs,
        ext: path_1.default.extname(filePath).replace('.', ''),
        hasCover: existing?.hasCover || !!songInfo.img,
        hasLyric: existing?.hasLyric || false,
        hasEmbedLyric: existing?.hasEmbedLyric || false
    };
    exports.customIndexManager.set(username, filename, updatedItem);
    exports.customIndexManager.save(username);
    return { success: true, message: '关联成功', data: updatedItem };
};
exports.linkCustomSong = linkCustomSong;
// 批量补全自定义目录音乐元信息（封面与ID3标签）
const batchUpdateMetadata = async (filenames, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        throw new Error('用户未启用或未配置自定义目录');
    let successCount = 0;
    let failCount = 0;
    const index = exports.customIndexManager.load(username);
    for (const filename of filenames) {
        const item = index.get(filename);
        const filePath = resolveSafePath(customDir, filename);
        if (!filePath || !fs_1.default.existsSync(filePath)) {
            failCount++;
            continue;
        }
        try {
            let imageBuffer;
            let imageMime = 'image/jpeg';
            const imageUrl = item?.img;
            if (imageUrl && imageUrl.startsWith('http') && !imageUrl.includes('logo.svg')) {
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
            try {
                tagger = new MusicTagger();
                tagger.loadPath(filePath);
                if (item?.name)
                    tagger.title = item.name;
                if (item?.singer)
                    tagger.artist = item.singer;
                if (item?.album)
                    tagger.album = item.album;
                if (imageBuffer && imageBuffer.length > 0) {
                    tagger.pictures = [new MetaPicture(imageMime, new Uint8Array(imageBuffer), 'Cover')];
                }
                tagger.save();
            }
            catch (e) {
                console.warn(`[CustomMusic] 批量写入标签失败: ${filename}`, e);
            }
            finally {
                try {
                    if (tagger)
                        tagger.dispose();
                }
                catch (e) { }
            }
            if (item) {
                if (imageBuffer && imageBuffer.length > 0) {
                    item.hasCover = true;
                    item.coverType = 'embedded';
                }
                const stats = fs_1.default.statSync(filePath);
                item.mtime = stats.mtimeMs;
                item.size = stats.size;
                exports.customIndexManager.set(username, filename, item);
            }
            successCount++;
        }
        catch (e) {
            failCount++;
        }
    }
    exports.customIndexManager.save(username);
    return { successCount, failCount };
};
exports.batchUpdateMetadata = batchUpdateMetadata;
// 批量将歌词嵌入自定义目录音频标签 (USLT)
const batchEmbedLyric = async (filenames, username) => {
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        throw new Error('用户未启用或未配置自定义目录');
    let successCount = 0;
    let skippedCount = 0;
    let failCount = 0;
    const details = [];
    const index = exports.customIndexManager.load(username);
    for (const filename of filenames) {
        const filePath = resolveSafePath(customDir, filename);
        if (!filePath || !fs_1.default.existsSync(filePath)) {
            details.push({ filename, status: 'fail', reason: '文件不存在' });
            failCount++;
            continue;
        }
        try {
            const item = index.get(filename);
            // 检查现有嵌入歌词
            let checkTagger;
            let existingLyrics = '';
            try {
                checkTagger = new MusicTagger();
                checkTagger.loadPath(filePath);
                existingLyrics = checkTagger.lyrics || '';
            }
            catch (checkError) {
                const unsupportedStatus = (0, fileCache_1.getAudioMetadataUnsupportedStatus)(filePath);
                details.push({ filename, status: 'fail', reason: unsupportedStatus.error || '当前音频容器不支持嵌入歌词' });
                failCount++;
                continue;
            }
            finally {
                try {
                    if (checkTagger)
                        checkTagger.dispose();
                }
                catch (e) { }
            }
            if (existingLyrics && existingLyrics.trim().length > 10) {
                details.push({ filename, status: 'skipped', reason: '已有歌词标签' });
                skippedCount++;
                continue;
            }
            // 优先读取同名 .lrc 文件
            const ext = path_1.default.extname(filePath);
            const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc';
            let lyricText = null;
            if (fs_1.default.existsSync(lrcPath)) {
                lyricText = fs_1.default.readFileSync(lrcPath, 'utf8');
            }
            else if (item && item.source && item.source !== 'unknown' && item.source !== 'custom') {
                const lyricFetcherFn = (0, fileCache_1.getLyricFetcher)();
                if (lyricFetcherFn) {
                    lyricText = await lyricFetcherFn(item);
                }
            }
            if (!lyricText) {
                details.push({ filename, status: 'fail', reason: '无法获取歌词' });
                failCount++;
                continue;
            }
            const embedResult = (0, fileCache_1.embedLyricsIntoFile)(filePath, lyricText);
            if (!embedResult.success) {
                details.push({ filename, status: 'fail', reason: embedResult.error || '歌词写入失败' });
                failCount++;
                continue;
            }
            if (item) {
                item.hasEmbedLyric = true;
                exports.customIndexManager.set(username, filename, item);
            }
            details.push({ filename, status: 'success' });
            successCount++;
        }
        catch (itemErr) {
            details.push({ filename, status: 'fail', reason: itemErr.message || '未知错误' });
            failCount++;
        }
    }
    exports.customIndexManager.save(username);
    return { successCount, skippedCount, failCount, details };
};
exports.batchEmbedLyric = batchEmbedLyric;
// 为自定义目录保存歌词缓存 (.lrc 文件并同步索引)
const saveCustomLyricCache = (songInfo, lyricsObj, username) => {
    try {
        const customDir = (0, exports.getCustomMusicDir)(username);
        if (!customDir)
            return false;
        const index = exports.customIndexManager.load(username);
        // 查找匹配项：优先 filename，其次 songmid/id
        let matchedItem;
        for (const item of Array.from(index.values())) {
            if (songInfo.filename && item.filename === songInfo.filename) {
                matchedItem = item;
                break;
            }
            if (songInfo.songmid && item.songmid === songInfo.songmid) {
                matchedItem = item;
                break;
            }
            if (songInfo.id && item.id === songInfo.id) {
                matchedItem = item;
                break;
            }
        }
        if (!matchedItem)
            return false;
        const filePath = resolveSafePath(customDir, matchedItem.filename);
        if (!filePath || !fs_1.default.existsSync(filePath))
            return false;
        const ext = path_1.default.extname(filePath);
        const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc';
        const formattedLrc = (0, lrcTool_1.buildLyrics)(lyricsObj);
        if (!formattedLrc)
            return false;
        fs_1.default.writeFileSync(lrcPath, formattedLrc, { encoding: 'utf-8' });
        matchedItem.hasLyric = true;
        matchedItem.lyricFilename = path_1.default.relative(customDir, lrcPath).replace(/\\/g, '/');
        exports.customIndexManager.set(username, matchedItem.filename, matchedItem);
        exports.customIndexManager.save(username);
        return true;
    }
    catch (e) {
        console.error('[CustomMusic] Failed to save custom lyric cache:', e);
        return false;
    }
};
exports.saveCustomLyricCache = saveCustomLyricCache;
// 跨设备/分区安全重命名
const safeRenameFile = (src, dst) => {
    try {
        fs_1.default.renameSync(src, dst);
    }
    catch (err) {
        fs_1.default.copyFileSync(src, dst);
        fs_1.default.unlinkSync(src);
    }
};
// 自定义目录歌曲洗版替换：下载新音质并替换自定义目录目标文件，保留封面和歌词，并更新 custom_index.json
const replaceCustomMusicItem = async (username, originalItem, songInfo, url, quality, signal) => {
    const userCfg = (0, user_1.getUserConfig)(username);
    if (!userCfg?.allowOperateCustomMusicDir) {
        throw new Error('未开启操作自定义音乐目录权限 (allowOperateCustomMusicDir)');
    }
    const customDir = (0, exports.getCustomMusicDir)(username);
    if (!customDir)
        throw new Error('用户未开启或未配置自定义音乐目录');
    const index = exports.customIndexManager.load(username);
    const currentItem = index.get(originalItem.filename);
    if (!currentItem) {
        throw new Error('原自定义目录文件已发生变化或已不存在');
    }
    if (quality === currentItem.quality) {
        throw new Error('实际音质与原音质相同，无需替换');
    }
    const oldAudioPath = resolveSafePath(customDir, currentItem.filename);
    if (!oldAudioPath || !fs_1.default.existsSync(oldAudioPath)) {
        throw new Error('原音频文件已不存在');
    }
    const stageId = crypto_1.default.randomBytes(12).toString('hex');
    const stageUsername = `.remaster-staging/${stageId}`;
    const stageRoot = fileCache.getCacheDir(stageUsername, true);
    const stageCoverRoot = fileCache.getCoverCacheDir(stageUsername);
    const backupSuffix = `.remaster-${crypto_1.default.randomBytes(6).toString('hex')}.bak`;
    const oldAudioBackup = oldAudioPath + backupSuffix;
    const ext = path_1.default.extname(oldAudioPath);
    const oldLyricPath = oldAudioPath.substring(0, oldAudioPath.length - ext.length) + '.lrc';
    const hasOldLyric = fs_1.default.existsSync(oldLyricPath);
    const oldLyricBackup = oldLyricPath + backupSuffix;
    let backedUpOldAudio = false;
    let backedUpOldLyric = false;
    let installedNewAudio = false;
    let installedNewLyric = false;
    let targetAudioPath = '';
    let targetLyricPath = '';
    let replacementItem = null;
    try {
        await fileCache.downloadAndCache(songInfo, url, quality, stageUsername, signal, true, true, true);
        if (signal?.aborted)
            throw new Error('Aborted');
        const stagedItems = fileCache.indexManager.getAll(stageUsername, 'music');
        const targetId = fileCache.normalizeSongId(songInfo);
        const downloadedItem = stagedItems.find(item => item.id === targetId) || stagedItems[0];
        if (!downloadedItem)
            throw new Error('新音质文件未写入暂存索引');
        const sourceAudioPath = path_1.default.join(stageRoot, downloadedItem.filename);
        const sourceStats = fs_1.default.existsSync(sourceAudioPath) ? fs_1.default.statSync(sourceAudioPath) : null;
        if (!sourceStats?.isFile() || sourceStats.size <= 0)
            throw new Error('新音质文件无效或为空');
        // 提取原音频封面作为备用
        const originalCover = await (0, exports.getCustomCover)(currentItem.filename, username);
        // 确定自定义目录中的目标音频文件名（保留其原相对子路径 subPath）
        const downloadedExt = path_1.default.extname(downloadedItem.filename) || `.${downloadedItem.ext || 'mp3'}`;
        const subDir = currentItem.subPath || (path_1.default.dirname(currentItem.filename) === '.' ? '' : path_1.default.dirname(currentItem.filename).replace(/\\/g, '/'));
        const baseNameWithoutExt = path_1.default.basename(currentItem.filename, ext);
        const targetAudioFilename = subDir ? path_1.default.join(subDir, `${baseNameWithoutExt}${downloadedExt}`).replace(/\\/g, '/') : `${baseNameWithoutExt}${downloadedExt}`;
        const targetLyricFilename = subDir ? path_1.default.join(subDir, `${baseNameWithoutExt}.lrc`).replace(/\\/g, '/') : `${baseNameWithoutExt}.lrc`;
        targetAudioPath = resolveSafePath(customDir, targetAudioFilename);
        targetLyricPath = resolveSafePath(customDir, targetLyricFilename);
        // 备份旧音频
        fs_1.default.renameSync(oldAudioPath, oldAudioBackup);
        backedUpOldAudio = true;
        // 备份旧歌词（若存在）
        if (hasOldLyric) {
            fs_1.default.renameSync(oldLyricPath, oldLyricBackup);
            backedUpOldLyric = true;
        }
        // 写入新音频到目标位置
        fs_1.default.mkdirSync(path_1.default.dirname(targetAudioPath), { recursive: true });
        safeRenameFile(sourceAudioPath, targetAudioPath);
        installedNewAudio = true;
        // 检查新音频封面，若缺失且原音频有封面，则写入封面标签
        let taggerCheck;
        let finalHasCover = false;
        try {
            taggerCheck = new MusicTagger();
            taggerCheck.loadPath(targetAudioPath);
            const pics = taggerCheck.pictures;
            finalHasCover = Array.isArray(pics) && pics.some((p) => p && p.data);
        }
        catch (e) {
        }
        finally {
            try {
                if (taggerCheck)
                    taggerCheck.dispose();
            }
            catch (e) { }
        }
        if (!finalHasCover && originalCover?.data?.length) {
            let tagger;
            try {
                tagger = new MusicTagger();
                tagger.loadPath(targetAudioPath);
                tagger.pictures = [
                    new MetaPicture(originalCover.mime || 'image/jpeg', new Uint8Array(originalCover.data), 'Cover'),
                ];
                tagger.save();
                finalHasCover = true;
            }
            catch (e) {
                console.warn(`[CustomMusic] 无法将原封面写入 ${targetAudioFilename}:`, e);
            }
            finally {
                try {
                    if (tagger)
                        tagger.dispose();
                }
                catch (e) { }
            }
        }
        // 处理歌词文件
        const sourceLyricPath = downloadedItem.lyricFilename ? path_1.default.join(stageRoot, downloadedItem.lyricFilename) : '';
        let finalHasLyric = false;
        let finalLyricFilename;
        if (sourceLyricPath && fs_1.default.existsSync(sourceLyricPath)) {
            fs_1.default.mkdirSync(path_1.default.dirname(targetLyricPath), { recursive: true });
            safeRenameFile(sourceLyricPath, targetLyricPath);
            installedNewLyric = true;
            finalHasLyric = true;
            finalLyricFilename = targetLyricFilename;
        }
        else if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup)) {
            fs_1.default.mkdirSync(path_1.default.dirname(targetLyricPath), { recursive: true });
            fs_1.default.copyFileSync(oldLyricBackup, targetLyricPath);
            installedNewLyric = true;
            finalHasLyric = true;
            finalLyricFilename = targetLyricFilename;
        }
        const finalStats = fs_1.default.statSync(targetAudioPath);
        replacementItem = {
            ...currentItem,
            name: songInfo.name || currentItem.name,
            singer: songInfo.singer || currentItem.singer,
            album: songInfo.albumName || songInfo.album || currentItem.album,
            albumId: songInfo.albumId || currentItem.albumId,
            img: songInfo.img || currentItem.img,
            interval: songInfo.interval || currentItem.interval,
            quality: quality,
            filename: targetAudioFilename,
            subPath: subDir,
            folder: 'custom',
            source: currentItem.source || 'custom',
            mtime: finalStats.mtimeMs,
            size: finalStats.size,
            ext: downloadedExt.replace('.', ''),
            hasCover: finalHasCover,
            coverType: finalHasCover ? 'embedded' : 'none',
            hasLyric: finalHasLyric,
            hasEmbedLyric: downloadedItem.hasEmbedLyric ?? currentItem.hasEmbedLyric,
            lyricFilename: finalLyricFilename,
            bitrate: downloadedItem.bitrate,
            sampleRate: downloadedItem.sampleRate,
            bitDepth: downloadedItem.bitDepth,
        };
        // 如果文件名改变，移除旧键并设置新键
        if (targetAudioFilename !== currentItem.filename) {
            exports.customIndexManager.remove(username, currentItem.filename);
        }
        exports.customIndexManager.set(username, targetAudioFilename, replacementItem);
        exports.customIndexManager.save(username);
        // 清理备份文件
        try {
            if (backedUpOldAudio && fs_1.default.existsSync(oldAudioBackup))
                fs_1.default.unlinkSync(oldAudioBackup);
        }
        catch (cleanupErr) {
            console.warn('[CustomMusic] 清理旧音频备份失败:', cleanupErr);
        }
        try {
            if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup))
                fs_1.default.unlinkSync(oldLyricBackup);
        }
        catch (cleanupErr) {
            console.warn('[CustomMusic] 清理旧歌词备份失败:', cleanupErr);
        }
        return replacementItem;
    }
    catch (err) {
        // 回滚操作
        try {
            if (installedNewAudio && targetAudioPath && fs_1.default.existsSync(targetAudioPath)) {
                fs_1.default.unlinkSync(targetAudioPath);
            }
            if (installedNewLyric && targetLyricPath && fs_1.default.existsSync(targetLyricPath)) {
                fs_1.default.unlinkSync(targetLyricPath);
            }
            if (backedUpOldAudio && fs_1.default.existsSync(oldAudioBackup) && !fs_1.default.existsSync(oldAudioPath)) {
                fs_1.default.renameSync(oldAudioBackup, oldAudioPath);
            }
            if (backedUpOldLyric && fs_1.default.existsSync(oldLyricBackup) && !fs_1.default.existsSync(oldLyricPath)) {
                fs_1.default.renameSync(oldLyricBackup, oldLyricPath);
            }
            exports.customIndexManager.set(username, currentItem.filename, currentItem);
            exports.customIndexManager.save(username);
        }
        catch (rollbackErr) {
            console.error('[CustomMusic] 洗版回滚失败:', rollbackErr);
        }
        throw err;
    }
    finally {
        fileCache.indexManager.discard(stageUsername, 'music');
        try {
            if (fs_1.default.existsSync(stageRoot))
                fs_1.default.rmSync(stageRoot, { recursive: true, force: true });
        }
        catch (e) { }
        try {
            if (fs_1.default.existsSync(stageCoverRoot))
                fs_1.default.rmSync(stageCoverRoot, { recursive: true, force: true });
        }
        catch (e) { }
    }
};
exports.replaceCustomMusicItem = replaceCustomMusicItem;
