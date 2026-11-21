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
exports.createSyncDownloadTask = exports.triggerUserSync = exports.syncDownloadForAllUsers = exports.downloadSongToSubPath = exports.saveSyncDownloadData = exports.getSyncDownloadData = exports.saveUserData = exports.loadUserData = exports.getAllSyncProgress = exports.getUserSyncProgress = exports.cancelUserSync = exports.setSongResolver = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fileCache = __importStar(require("../fileCache"));
const log4js_1 = require("../../utils/log4js.js");
const user_1 = require("../../user/index.js");
const constants_1 = require("../../constants.js");
const data_1 = require("../../user/data.js");
// ─────────────────────────────────────────────
// Resolver 注入（由 server.ts 在启动时设置）
// ─────────────────────────────────────────────
let _resolver = null;
const setSongResolver = (fn) => {
    _resolver = fn;
};
exports.setSongResolver = setSongResolver;
// ─────────────────────────────────────────────
// 运行时进度状态 & 中止控制器（每个用户独立）
// ─────────────────────────────────────────────
const progressMap = new Map();
const activeAbortControllers = new Map();
const getProgress = (username) => {
    if (!progressMap.has(username)) {
        progressMap.set(username, {
            isRunning: false,
            isPaused: false,
            startTime: null,
            currentListId: '',
            currentListName: '',
            currentSongName: '',
            currentSongIndex: 0,
            currentListTotalSongs: 0,
            totalSongs: 0,
            overallCurrent: 0,
            successCount: 0,
            failCount: 0,
            log: [],
        });
    }
    return progressMap.get(username);
};
const cancelUserSync = (username) => {
    const controller = activeAbortControllers.get(username);
    if (controller) {
        controller.abort();
        activeAbortControllers.delete(username);
        const progress = getProgress(username);
        progress.isRunning = false;
        progress.isPaused = false;
        progress.currentSongName = '';
        addLog(progress, '用户已暂停/停止同步任务');
        return true;
    }
    const progress = getProgress(username);
    if (progress.isRunning) {
        progress.isRunning = false;
        progress.isPaused = false;
        progress.currentSongName = '';
        return true;
    }
    return false;
};
exports.cancelUserSync = cancelUserSync;
const addLog = (progress, msg) => {
    progress.log.push({ time: Date.now(), msg });
    if (progress.log.length > 100)
        progress.log.shift();
};
const getUserSyncProgress = (username) => {
    return getProgress(username);
};
exports.getUserSyncProgress = getUserSyncProgress;
const getAllSyncProgress = () => {
    return Object.fromEntries(progressMap);
};
exports.getAllSyncProgress = getAllSyncProgress;
// ─────────────────────────────────────────────
// data.json 读写管理
// ─────────────────────────────────────────────
const DATA_FILE_NAME = 'data.json';
const getUserDataPath = (username) => {
    const userDir = node_path_1.default.join(global.lx.userPath, (0, data_1.getUserDirname)(username));
    return node_path_1.default.join(userDir, DATA_FILE_NAME);
};
const loadUserData = (username) => {
    const filePath = getUserDataPath(username);
    if (!node_fs_1.default.existsSync(filePath))
        return {};
    try {
        return JSON.parse(node_fs_1.default.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return {};
    }
};
exports.loadUserData = loadUserData;
const saveUserData = (username, data) => {
    const filePath = getUserDataPath(username);
    const dir = node_path_1.default.dirname(filePath);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    try {
        node_fs_1.default.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        node_fs_1.default.renameSync(tmp, filePath);
    }
    catch (e) {
        try {
            if (node_fs_1.default.existsSync(tmp))
                node_fs_1.default.unlinkSync(tmp);
        }
        catch { }
        throw e;
    }
};
exports.saveUserData = saveUserData;
const getSyncDownloadData = (username) => {
    const data = (0, exports.loadUserData)(username);
    return data.syncDownload ?? {
        enabled: false,
        playlists: {},
        lastSyncTime: null,
        lastSyncResult: null,
    };
};
exports.getSyncDownloadData = getSyncDownloadData;
const saveSyncDownloadData = (username, syncData) => {
    const data = (0, exports.loadUserData)(username);
    data.syncDownload = syncData;
    (0, exports.saveUserData)(username, data);
};
exports.saveSyncDownloadData = saveSyncDownloadData;
/**
 * 清理 data.json 中已被删除的歌单条目
 */
const cleanupStalePlaylists = (syncData, validListIds) => {
    let changed = false;
    for (const id of Object.keys(syncData.playlists)) {
        if (!validListIds.has(id)) {
            delete syncData.playlists[id];
            changed = true;
        }
    }
    return changed;
};
// ─────────────────────────────────────────────
// 读取用户设置中的首选音质
// ─────────────────────────────────────────────
const getPreferredQuality = (username) => {
    try {
        const userSpace = (0, user_1.getUserSpace)(username);
        const settingsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSettingsJSON);
        if (node_fs_1.default.existsSync(settingsPath)) {
            const settings = JSON.parse(node_fs_1.default.readFileSync(settingsPath, 'utf-8'));
            if (settings.preferredQuality && typeof settings.preferredQuality === 'string') {
                return settings.preferredQuality;
            }
        }
    }
    catch { }
    return '320k';
};
// ─────────────────────────────────────────────
// 核心：将单首歌曲下载到指定 subPath
// ─────────────────────────────────────────────
const CACHE_LOCATION = fileCache.CACHE_ROOTS.DATA;
const downloadSongToSubPath = async (songInfo, quality, username, subPath, signal) => {
    if (!_resolver)
        return new Error('Sync download resolver not initialized');
    try {
        const resolved = await _resolver(songInfo, quality, username);
        if (signal?.aborted)
            return new Error('Aborted');
        if (!resolved?.url)
            return new Error('No download URL returned');
        // 使用实际解析的 songInfo（可能包含更完整的元数据）
        const finalSongInfo = resolved.songInfo || songInfo;
        // 将 subPath 写入 songInfo 的临时字段，供 downloadAndCache 识别
        // downloadAndCache 目前使用 username 下的 music 根目录，
        // 我们通过先创建目录、再传入 subPath 字段的方式实现
        const songInfoWithSubPath = { ...finalSongInfo, __syncSubPath__: subPath };
        // 确保目标子目录存在
        const musicDir = fileCache.getCacheDir(username, true, CACHE_LOCATION);
        const subDir = node_path_1.default.join(musicDir, subPath);
        if (!node_fs_1.default.existsSync(subDir))
            node_fs_1.default.mkdirSync(subDir, { recursive: true });
        // 直接调用 downloadAndCache，isOnlyDownload=true 写入 music 目录
        // 文件名由 fileCache 内部决定，subPath 由 indexManager 更新时写入
        await fileCache.downloadAndCache(songInfoWithSubPath, resolved.url, resolved.quality || quality, username, signal, true, // isOnlyDownload → 写到 music/ 目录
        true, // cacheLyric
        true, // embedLyric
        {
            requestedSource: (resolved.songInfo || songInfo).requestedSource || (resolved.songInfo || songInfo).source,
            downloadSource: (resolved.songInfo || songInfo).downloadSource,
            sourceName: (resolved.songInfo || songInfo).sourceName,
        });
        if (signal?.aborted)
            return new Error('Aborted');
        // 下载完成后将索引中该歌曲的 subPath 更新为目标子目录
        const songId = fileCache.normalizeSongId(finalSongInfo);
        const item = fileCache.indexManager.get(username, songId, 'music', resolved.quality || quality, false, CACHE_LOCATION);
        if (item && (!item.subPath || item.subPath !== subPath)) {
            // 如果文件实际落在根目录，需要移动到 subPath
            const musicRoot = fileCache.getCacheDir(username, true, CACHE_LOCATION);
            const currentFilename = item.filename;
            const hasSubDir = currentFilename.includes('/');
            if (!hasSubDir) {
                // 文件在根目录，移动到子目录
                const srcPath = node_path_1.default.join(musicRoot, currentFilename);
                const ext = node_path_1.default.extname(currentFilename);
                const destFilename = node_path_1.default.join(subPath, node_path_1.default.basename(currentFilename)).replace(/\\/g, '/');
                const destPath = node_path_1.default.join(musicRoot, destFilename);
                if (node_fs_1.default.existsSync(srcPath) && !node_fs_1.default.existsSync(destPath)) {
                    node_fs_1.default.renameSync(srcPath, destPath);
                    // 同步移动 .lrc 文件
                    if (item.lyricFilename) {
                        const srcLrc = node_path_1.default.join(musicRoot, item.lyricFilename);
                        const destLrc = node_path_1.default.join(musicRoot, node_path_1.default.join(subPath, node_path_1.default.basename(item.lyricFilename)).replace(/\\/g, '/'));
                        if (node_fs_1.default.existsSync(srcLrc)) {
                            try {
                                node_fs_1.default.renameSync(srcLrc, destLrc);
                            }
                            catch { }
                        }
                    }
                    // 更新索引
                    fileCache.indexManager.update(username, {
                        ...item,
                        filename: destFilename,
                        subPath,
                        lyricFilename: item.lyricFilename
                            ? node_path_1.default.join(subPath, node_path_1.default.basename(item.lyricFilename)).replace(/\\/g, '/')
                            : undefined,
                    }, 'music', CACHE_LOCATION);
                }
            }
        }
        // 判断是否已存在
        const songKey = fileCache.normalizeSongId(finalSongInfo) + '_' + (resolved.quality || quality);
        const prog = fileCache.cacheProgress.get(songKey);
        return prog?.status === 'exists' ? 'exists' : 'ok';
    }
    catch (e) {
        return e instanceof Error ? e : new Error(String(e));
    }
};
exports.downloadSongToSubPath = downloadSongToSubPath;
// ─────────────────────────────────────────────
// 重试下载
// ─────────────────────────────────────────────
const downloadWithRetry = async (song, quality, username, subPath, maxRetries = 3, signal) => {
    let lastErr;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (signal?.aborted)
            return { status: 'failed', reason: 'Aborted' };
        const result = await (0, exports.downloadSongToSubPath)(song, quality, username, subPath, signal);
        if (result === 'ok')
            return { status: 'ok' };
        if (result === 'exists')
            return { status: 'exists' };
        lastErr = result instanceof Error ? result : new Error(String(result));
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt)); // 递增等待
        }
    }
    return { status: 'failed', reason: lastErr?.message || '未知错误' };
};
// ─────────────────────────────────────────────
// 获取本地已有歌曲（按 subPath 分组）
// ─────────────────────────────────────────────
const getLocalSongIds = (username, subPath) => {
    const items = fileCache.indexManager.getAll(username, 'music', CACHE_LOCATION);
    const ids = new Set();
    for (const item of items) {
        if (item.subPath === subPath) {
            ids.add(item.id);
        }
    }
    return ids;
};
/**
 * 删除本地歌曲并更新索引
 */
const deleteLocalSong = (username, songId, subPath) => {
    const items = fileCache.indexManager.getAll(username, 'music', CACHE_LOCATION);
    const toDelete = items.filter(i => i.id === songId && i.subPath === subPath);
    let deleted = false;
    for (const item of toDelete) {
        try {
            fileCache.removeCacheFile(item.filename, username, 'music');
            deleted = true;
        }
        catch (e) {
            log4js_1.syncLog.warn(`[SyncDownload] 删除文件失败: ${item.filename}: ${e.message}`);
        }
    }
    return deleted;
};
// ─────────────────────────────────────────────
// 清理安全文件名（用于生成子目录名）
// ─────────────────────────────────────────────
const sanitizeDirName = (name) => {
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);
};
// ─────────────────────────────────────────────
// 全局运行锁（跨用户共用，防止并发同步）
// ─────────────────────────────────────────────
let globalIsRunning = false;
/**
 * 对单个用户执行歌单同步下载
 */
const syncUserPlaylists = async (username, signal) => {
    const progress = getProgress(username);
    if (progress.isRunning) {
        log4js_1.syncLog.info(`[SyncDownload] 用户 ${username} 当前正在同步中，跳过`);
        return;
    }
    const syncData = (0, exports.getSyncDownloadData)(username);
    if (!syncData.enabled)
        return;
    const userSpace = (0, user_1.getUserSpace)(username);
    let listData;
    try {
        listData = await userSpace.listManage.getListData();
    }
    catch (e) {
        log4js_1.syncLog.warn(`[SyncDownload] 用户 ${username} 获取歌单失败: ${e.message}`);
        return;
    }
    if (!listData?.userList?.length)
        return;
    const quality = getPreferredQuality(username);
    const validListIds = new Set(listData.userList.map((l) => l.id));
    // 清理已删除的歌单
    const cleaned = cleanupStalePlaylists(syncData, validListIds);
    if (cleaned)
        (0, exports.saveSyncDownloadData)(username, syncData);
    // 只同步开启了同步的歌单（且必须是网络歌单 sourceListId 才有意义，但本地歌单也支持）
    const targetLists = listData.userList.filter((l) => {
        const cfg = syncData.playlists[l.id];
        return cfg?.enabled === true;
    });
    if (targetLists.length === 0)
        return;
    // 预扫描所有需下载和需删除的歌曲以准确计算总数
    let overallTotal = 0;
    const plans = [];
    for (const list of targetLists) {
        const subPath = sanitizeDirName(list.name || list.id);
        const remoteSongs = Array.isArray(list.list) ? list.list : [];
        const remoteSongIds = new Set(remoteSongs.map((s) => {
            const id = String(s.songmid || s.id || '');
            const src = s.source || 'unknown';
            return id.includes('_') ? id : `${src}_${id}`;
        }));
        const localSongIds = getLocalSongIds(username, subPath);
        const toDownload = remoteSongs.filter((s) => {
            const id = fileCache.normalizeSongId(s);
            return !localSongIds.has(id);
        });
        const toDelete = Array.from(localSongIds).filter(id => !remoteSongIds.has(id));
        overallTotal += toDownload.length;
        plans.push({ list, subPath, toDownload, toDelete });
    }
    progress.isRunning = true;
    progress.isPaused = false;
    progress.startTime = Date.now();
    progress.successCount = 0;
    progress.failCount = 0;
    progress.totalSongs = overallTotal;
    progress.overallCurrent = 0;
    progress.currentListId = '';
    progress.currentListName = '';
    progress.currentSongName = '';
    progress.currentSongIndex = 0;
    progress.currentListTotalSongs = 0;
    progress.log = [];
    addLog(progress, `开始同步用户 ${username} 的 ${targetLists.length} 个歌单，总计需下载 ${overallTotal} 首歌曲`);
    let totalSuccess = 0;
    let totalFail = 0;
    for (const plan of plans) {
        if (signal?.aborted)
            break;
        const { list, subPath, toDownload, toDelete } = plan;
        const listCfg = syncData.playlists[list.id] ?? {
            enabled: true, lastSyncTime: null, failedSongs: []
        };
        progress.currentListId = list.id;
        progress.currentListName = list.name || list.id;
        progress.currentListTotalSongs = toDownload.length;
        progress.currentSongIndex = 0;
        // 删除已移出歌单的歌曲
        for (const id of toDelete) {
            if (signal?.aborted)
                break;
            deleteLocalSong(username, id, subPath);
            addLog(progress, `  已删除: ${id}`);
        }
        // 下载新增歌曲
        listCfg.failedSongs = [];
        for (let i = 0; i < toDownload.length; i++) {
            if (signal?.aborted)
                break;
            const song = toDownload[i];
            progress.currentSongIndex = i + 1;
            progress.overallCurrent++;
            progress.currentSongName = `${song.name || song.id}${song.singer ? ' - ' + song.singer : ''}`;
            addLog(progress, `  [${i + 1}/${toDownload.length}] 下载: ${song.name} - ${song.singer}`);
            const result = await downloadWithRetry(song, quality, username, subPath, 3, signal);
            if (result.status === 'ok' || result.status === 'exists') {
                progress.successCount++;
                totalSuccess++;
            }
            else {
                progress.failCount++;
                totalFail++;
                const reason = result.reason || '未知错误';
                listCfg.failedSongs.push({
                    id: fileCache.normalizeSongId(song),
                    name: song.name || '',
                    singer: song.singer || '',
                    reason,
                });
            }
        }
        listCfg.lastSyncTime = Date.now();
        syncData.playlists[list.id] = listCfg;
        (0, exports.saveSyncDownloadData)(username, syncData);
    }
    if (signal?.aborted) {
        const resultMsg = `已暂停/终止同步: 成功 ${totalSuccess} 首，失败 ${totalFail} 首`;
        addLog(progress, resultMsg);
        syncData.lastSyncResult = resultMsg;
        (0, exports.saveSyncDownloadData)(username, syncData);
    }
    else {
        const resultMsg = `同步完成: 成功 ${totalSuccess} 首，失败 ${totalFail} 首`;
        addLog(progress, resultMsg);
        syncData.lastSyncTime = Date.now();
        syncData.lastSyncResult = resultMsg;
        (0, exports.saveSyncDownloadData)(username, syncData);
    }
    progress.isRunning = false;
    progress.startTime = null;
    progress.currentSongName = '';
    log4js_1.syncLog.info(`[SyncDownload] 用户 ${username} ${syncData.lastSyncResult}`);
};
/**
 * 对所有启用了自动下载的用户执行同步
 */
const syncDownloadForAllUsers = async (signal) => {
    if (globalIsRunning) {
        log4js_1.syncLog.info('[SyncDownload] 全局同步任务正在运行中，跳过本次触发');
        return { processedUsers: 0, totalSuccess: 0, totalFail: 0 };
    }
    globalIsRunning = true;
    let processedUsers = 0;
    let totalSuccess = 0;
    let totalFail = 0;
    try {
        const users = [];
        if (Array.isArray(global.lx?.config?.users)) {
            for (const u of global.lx.config.users) {
                if (u?.name) {
                    // 检查管理员是否为该用户开启了 enableAutoDownload
                    const cfg = global.lx.config.users.find((x) => x.name === u.name);
                    if (cfg?.enableAutoDownload === true) {
                        users.push(u.name);
                    }
                }
            }
        }
        for (const username of users) {
            if (signal?.aborted)
                break;
            try {
                const before = getProgress(username);
                const successBefore = before.successCount;
                const failBefore = before.failCount;
                await syncUserPlaylists(username, signal);
                const after = getProgress(username);
                totalSuccess += after.successCount - successBefore;
                totalFail += after.failCount - failBefore;
                processedUsers++;
            }
            catch (e) {
                log4js_1.syncLog.warn(`[SyncDownload] 处理用户 ${username} 时出错: ${e.message}`);
            }
        }
    }
    finally {
        globalIsRunning = false;
    }
    return { processedUsers, totalSuccess, totalFail };
};
exports.syncDownloadForAllUsers = syncDownloadForAllUsers;
/**
 * 手动触发单个用户的同步（前端调用）
 */
const triggerUserSync = async (username) => {
    const progress = getProgress(username);
    if (progress.isRunning) {
        return { queued: false, message: '同步任务正在进行中，请稍候' };
    }
    const controller = new AbortController();
    activeAbortControllers.set(username, controller);
    // 异步执行，不阻塞请求
    void syncUserPlaylists(username, controller.signal).finally(() => {
        activeAbortControllers.delete(username);
    });
    return { queued: true, message: '同步任务已启动' };
};
exports.triggerUserSync = triggerUserSync;
/**
 * 创建后台调度任务对象（供 scheduler 调度中心注册）
 */
const createSyncDownloadTask = () => {
    return {
        id: 'sync_download_task',
        name: '歌单歌曲同步下载',
        intervalMs: 0,
        enabled: true,
        isRunning: false,
        run: async () => {
            const startTime = Date.now();
            try {
                const result = await (0, exports.syncDownloadForAllUsers)();
                return {
                    taskId: 'sync_download_task',
                    timestamp: startTime,
                    success: true,
                    message: `已同步 ${result.processedUsers} 个用户, 成功下载/缓存 ${result.totalSuccess} 首, 失败 ${result.totalFail} 首`,
                    details: result
                };
            }
            catch (err) {
                return {
                    taskId: 'sync_download_task',
                    timestamp: startTime,
                    success: false,
                    message: `同步下载失败: ${err.message}`
                };
            }
        }
    };
};
exports.createSyncDownloadTask = createSyncDownloadTask;
