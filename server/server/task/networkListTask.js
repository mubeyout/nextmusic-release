"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNetworkListTask = exports.loadNetworkListTaskConfig = exports.checkAllUsersNetworkLists = exports.parseIntervalMs = exports.removeUpdatedListId = exports.addUpdatedListId = exports.getUpdatedListIds = exports.TASK_NAME = exports.TASK_ID = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const user_1 = require("../../user/index.js");
const constants_1 = require("../../constants.js");
const log4js_1 = require("../../utils/log4js.js");
// @ts-ignore
const index_js_1 = __importDefault(require("../../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
exports.TASK_ID = 'network_list_autocheck';
exports.TASK_NAME = '网络歌单自动同步更新';
/**
 * 运行时内存临时状态：记录哪些用户的哪些歌单有红点（重启后自动清除）
 * Map<username, Set<listId>>
 */
const updatedListMap = new Map();
const getUpdatedListIds = (username) => Array.from(updatedListMap.get(username) ?? []);
exports.getUpdatedListIds = getUpdatedListIds;
const addUpdatedListId = (username, listId) => {
    if (!updatedListMap.has(username))
        updatedListMap.set(username, new Set());
    updatedListMap.get(username).add(listId);
};
exports.addUpdatedListId = addUpdatedListId;
const removeUpdatedListId = (username, listId) => {
    updatedListMap.get(username)?.delete(listId);
};
exports.removeUpdatedListId = removeUpdatedListId;
/**
 * 解析用户配置的时间间隔（如 '1d2h30m'、'6h'、'30m' 或毫秒数）
 */
const parseIntervalMs = (value) => {
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'number')
        return value > 0 ? value : null;
    const raw = String(value).trim().toLowerCase();
    if (raw === '' || raw === '0' || raw === 'off' || raw === 'none' || raw === 'disable')
        return null;
    const regex = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g;
    let match;
    let totalMs = 0;
    let matchCount = 0;
    while ((match = regex.exec(raw)) !== null) {
        matchCount++;
        const count = parseFloat(match[1]);
        const unit = match[2];
        if (!Number.isFinite(count) || count < 0)
            return null;
        switch (unit) {
            case 'ms':
                totalMs += count;
                break;
            case 's':
                totalMs += count * 1000;
                break;
            case 'm':
                totalMs += count * 60 * 1000;
                break;
            case 'h':
                totalMs += count * 60 * 60 * 1000;
                break;
            case 'd':
                totalMs += count * 24 * 60 * 60 * 1000;
                break;
        }
    }
    if (matchCount === 0) {
        if (/^\d+(\.\d+)?$/.test(raw)) {
            totalMs = parseFloat(raw) * 60 * 60 * 1000;
        }
        else {
            return null;
        }
    }
    return Math.max(totalMs, 30 * 1000); // 最小30秒
};
exports.parseIntervalMs = parseIntervalMs;
/**
 * 格式化歌曲信息以匹配标准 LX 格式
 */
const formatSongItem = (song, defaultSource) => {
    if (!song)
        return song;
    return {
        ...song,
        source: song.source || defaultSource,
        id: song.id ? String(song.id) : (song.songmid ? String(song.songmid) : ''),
    };
};
/**
 * 执行网络歌单对比检测
 */
const checkAllUsersNetworkLists = async () => {
    const allUsernames = [];
    if (Array.isArray(global.lx?.config?.users)) {
        for (const u of global.lx.config.users) {
            if (u && u.name)
                allUsernames.push(u.name);
        }
    }
    if (!allUsernames.includes('_open')) {
        allUsernames.push('_open');
    }
    let totalNetworkLists = 0;
    let updatedListsCount = 0;
    const details = {};
    for (const username of allUsernames) {
        try {
            const userSpace = (0, user_1.getUserSpace)(username);
            const listData = await userSpace.listManage.getListData();
            if (!listData || !Array.isArray(listData.userList) || listData.userList.length === 0) {
                continue;
            }
            const targetLists = listData.userList.filter(l => l && l.sourceListId && l.source);
            if (targetLists.length === 0)
                continue;
            totalNetworkLists += targetLists.length;
            const changed = [];
            const failed = [];
            // 从内存临时状态读取已有红点标记（重启后自动清空）
            for (const list of targetLists) {
                try {
                    const source = String(list.source || '');
                    const sourceListId = String(list.sourceListId || '');
                    if (!source || !sourceListId)
                        continue;
                    if (!musicSdk[source] || !musicSdk[source].songList) {
                        throw new Error(`平台 ${source} 不支持歌单抓取`);
                    }
                    // 拉取远端歌单全部页面
                    const remoteResult = await musicSdk[source].songList.getListDetail(sourceListId, 1);
                    if (!remoteResult || !Array.isArray(remoteResult.list)) {
                        throw new Error('远端歌单数据不完整');
                    }
                    let remoteList = remoteResult.list.map((item) => formatSongItem(item, source));
                    // 如果有多页，继续拉取剩余页
                    const total = remoteResult.total ?? remoteResult.list.length;
                    const pageSize = remoteResult.list.length || 1;
                    const totalPages = Math.ceil(total / pageSize);
                    for (let page = 2; page <= totalPages; page++) {
                        try {
                            const pageResult = await musicSdk[source].songList.getListDetail(sourceListId, page);
                            if (pageResult && Array.isArray(pageResult.list) && pageResult.list.length > 0) {
                                remoteList = remoteList.concat(pageResult.list.map((item) => formatSongItem(item, source)));
                            }
                            else {
                                break;
                            }
                        }
                        catch {
                            break;
                        }
                    }
                    const localList = Array.isArray(list.list) ? list.list : [];
                    // 规范化 ID 后排序拼接比较：顺序无关，且保留重复项（不做 Set 去重避免误判）
                    const normalizeIds = (list) => list.map((s) => String(s.id || s.songmid || '').trim()).sort().join('|');
                    const sameIds = normalizeIds(remoteList) === normalizeIds(localList);
                    if (!sameIds) {
                        // 发现歌曲列表有变化：直接将远端最新歌曲覆盖更新至用户歌单数据中
                        try {
                            await userSpace.listManage.listDataManage.listMusicOverwrite(list.id, remoteList);
                            // 更新歌单基本信息（如果有新名字或封面）
                            if (remoteResult.info) {
                                const updatedListInfo = { ...list };
                                if (remoteResult.info.name)
                                    updatedListInfo.name = remoteResult.info.name;
                                if (remoteResult.info.img || remoteResult.info.pic)
                                    updatedListInfo.Album = remoteResult.info.img || remoteResult.info.pic;
                                await userSpace.listManage.listDataManage.userListsUpdate([updatedListInfo]);
                            }
                            // 创建快照并持久化
                            await userSpace.listManage.createSnapshot();
                        }
                        catch (err) {
                            log4js_1.syncLog.warn(`[Scheduler] 写入用户 ${username} 歌单 ${list.name || list.id} 失败: ${err.message}`);
                        }
                        // 记录红点标记到内存（重启后自动清空）
                        (0, exports.addUpdatedListId)(username, list.id);
                        changed.push(list.name || list.id);
                        updatedListsCount++;
                    }
                }
                catch (err) {
                    failed.push(list.name || list.id);
                    log4js_1.syncLog.warn(`[Scheduler] 检查用户 ${username} 的网络歌单 [${list.name || list.id}] 失败: ${err.message}`);
                }
            }
            // 更新状态已写入内存 taskStore，无需持久化到文件
            details[username] = { changed, failed };
        }
        catch (err) {
            log4js_1.syncLog.warn(`[Scheduler] 处理用户 ${username} 失败: ${err.message}`);
        }
    }
    return {
        checkedUsersCount: allUsernames.length,
        totalNetworkLists,
        updatedListsCount,
        details
    };
};
exports.checkAllUsersNetworkLists = checkAllUsersNetworkLists;
/**
 * 从各用户的 settings.json 中读取网络歌单自动更新的配置
 */
const loadNetworkListTaskConfig = () => {
    let intervalMs = 6 * 60 * 60 * 1000; // 默认 6 小时
    let enabled = true;
    const userCandidates = [];
    if (Array.isArray(global.lx?.config?.users)) {
        for (const u of global.lx.config.users) {
            if (u && u.name)
                userCandidates.push(u.name);
        }
    }
    if (!userCandidates.includes('_open')) {
        userCandidates.push('_open');
    }
    // 遍历所有用户，如果找到用户的设置文件就读取其配置
    for (const username of userCandidates) {
        try {
            const userSpace = (0, user_1.getUserSpace)(username);
            const settingsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSettingsJSON);
            if (node_fs_1.default.existsSync(settingsPath)) {
                const saved = JSON.parse(node_fs_1.default.readFileSync(settingsPath, 'utf8'));
                if (saved.networkListAutoCheckInterval) {
                    const parsed = (0, exports.parseIntervalMs)(saved.networkListAutoCheckInterval);
                    if (parsed)
                        intervalMs = parsed;
                }
                if (typeof saved.autoUpdateNetworkList === 'boolean') {
                    enabled = saved.autoUpdateNetworkList;
                }
                // 如果不是默认的 open 用户且已找到配置，以当前真实用户优先
                if (username !== '_open') {
                    break;
                }
            }
        }
        catch { }
    }
    return { intervalMs, enabled };
};
exports.loadNetworkListTaskConfig = loadNetworkListTaskConfig;
/**
 * 创建网络歌单自动检测 Task 实例
 */
const createNetworkListTask = () => {
    const config = (0, exports.loadNetworkListTaskConfig)();
    return {
        id: exports.TASK_ID,
        name: exports.TASK_NAME,
        intervalMs: config.intervalMs,
        enabled: config.enabled,
        isRunning: false,
        run: async () => {
            const res = await (0, exports.checkAllUsersNetworkLists)();
            // 网络歌单更新完成后，触发同步下载任务（低耦合：按需导入，运行中则跳过）
            try {
                const { syncDownloadForAllUsers } = await import('./syncDownloadTask.js');
                void syncDownloadForAllUsers();
            }
            catch (e) {
                log4js_1.syncLog.warn(`[NetworkListTask] 触发同步下载失败: ${e.message}`);
            }
            return {
                taskId: exports.TASK_ID,
                timestamp: Date.now(),
                success: true,
                message: `已同步 ${res.checkedUsersCount} 个用户的 ${res.totalNetworkLists} 个网络歌单，其中 ${res.updatedListsCount} 个已自动更新并标红`,
                details: res
            };
        }
    };
};
exports.createNetworkListTask = createNetworkListTask;
