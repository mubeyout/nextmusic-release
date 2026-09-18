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
exports.remove = exports.resume = exports.pause = exports.list = exports.enqueue = exports.initialize = exports.setConcurrency = exports.getConcurrency = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fileCache = __importStar(require("./fileCache"));
const DEFAULT_CONCURRENT = 3;
const MAX_CONCURRENT_PER_USER = 5;
const tasks = new Map();
const controllers = new Map();
const concurrencyByUser = new Map();
let resolver = null;
let initialized = false;
let processing = false;
let saveTimer = null;
const taskMapKey = (username, id) => `${username}:${id}`;
const getQueueFile = () => node_path_1.default.join(global.lx.dataPath, 'server-download-queue.json');
const validStatuses = new Set(['waiting', 'downloading', 'tagging', 'paused', 'finished', 'exists', 'error']);
const normalizeConcurrency = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed))
        return DEFAULT_CONCURRENT;
    return Math.min(MAX_CONCURRENT_PER_USER, Math.max(1, parsed));
};
const getConcurrency = (username) => concurrencyByUser.get(username) || DEFAULT_CONCURRENT;
exports.getConcurrency = getConcurrency;
const sanitizeId = (value) => {
    const id = String(value || '');
    return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : `server_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
const saveNow = () => {
    if (!initialized)
        return;
    const file = getQueueFile();
    const tempFile = `${file}.tmp`;
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        node_fs_1.default.writeFileSync(tempFile, JSON.stringify({
            version: 2,
            concurrencyByUser: Object.fromEntries(concurrencyByUser),
            tasks: Array.from(tasks.values()),
        }, null, 2), 'utf8');
        node_fs_1.default.renameSync(tempFile, file);
    }
    catch (err) {
        console.warn('[ServerDownloadQueue] Failed to save queue:', err);
        try {
            if (node_fs_1.default.existsSync(tempFile))
                node_fs_1.default.unlinkSync(tempFile);
        }
        catch (e) { }
    }
};
const scheduleSave = () => {
    if (saveTimer)
        clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveNow();
    }, 150);
};
const loadTasks = () => {
    const file = getQueueFile();
    if (!node_fs_1.default.existsSync(file))
        return;
    try {
        const data = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
        const savedTasks = Array.isArray(data) ? data : data?.tasks;
        if (!Array.isArray(savedTasks))
            return;
        if (!Array.isArray(data) && data?.concurrencyByUser && typeof data.concurrencyByUser === 'object') {
            for (const [username, value] of Object.entries(data.concurrencyByUser)) {
                concurrencyByUser.set(username, normalizeConcurrency(value));
            }
        }
        for (const raw of savedTasks) {
            if (!raw || !raw.username || !raw.songInfo)
                continue;
            const id = sanitizeId(raw.id);
            const savedStatus = validStatuses.has(raw.status) ? raw.status : 'waiting';
            const status = savedStatus === 'downloading' || savedStatus === 'tagging' ? 'waiting' : savedStatus;
            const quality = String(raw.quality || raw.requestedQuality || '320k');
            const requestedQuality = String(raw.requestedQuality || quality);
            const now = Date.now();
            const task = {
                id,
                username: String(raw.username),
                songKey: String(raw.songKey || `${fileCache.normalizeSongId(raw.songInfo)}_${requestedQuality}`),
                activeSongKey: status === 'waiting' ? undefined : raw.activeSongKey ? String(raw.activeSongKey) : undefined,
                songInfo: raw.songInfo,
                quality: status === 'waiting' ? requestedQuality : quality,
                requestedQuality,
                status,
                progress: status === 'waiting' ? 0 : Number(raw.progress || 0),
                total: status === 'waiting' ? 0 : Number(raw.total || 0),
                received: status === 'waiting' ? 0 : Number(raw.received || 0),
                speed: 0,
                errorMsg: status === 'waiting' ? '' : String(raw.errorMsg || ''),
                enableOnlyDownloadMode: !!raw.enableOnlyDownloadMode,
                cacheLyric: raw.cacheLyric !== false,
                embedLyric: raw.embedLyric !== false,
                createdAt: Number(raw.createdAt || now),
                updatedAt: now,
            };
            tasks.set(taskMapKey(task.username, task.id), task);
        }
        console.log(`[ServerDownloadQueue] Restored ${tasks.size} persisted tasks`);
    }
    catch (err) {
        console.warn('[ServerDownloadQueue] Failed to restore queue:', err);
    }
};
const getPublicTask = (task) => {
    const live = task.status === 'downloading' && task.activeSongKey
        ? fileCache.cacheProgress.get(task.activeSongKey)
        : undefined;
    const liveStatus = live?.status;
    return {
        id: task.id,
        songKey: task.activeSongKey || task.songKey,
        songInfo: task.songInfo,
        quality: task.quality,
        requestedQuality: task.requestedQuality,
        status: liveStatus || task.status,
        progress: Number(live?.progress ?? task.progress ?? 0),
        total: Number(live?.total ?? task.total ?? 0),
        received: Number(live?.received ?? task.received ?? 0),
        speed: Number(live?.speed ?? task.speed ?? 0),
        errorMsg: String(live?.errorMsg || task.errorMsg || ''),
        createdAt: task.createdAt,
        updatedAt: Number(live?.updatedAt || task.updatedAt),
    };
};
const runTask = async (task) => {
    if (!resolver || task.status !== 'waiting')
        return;
    const key = taskMapKey(task.username, task.id);
    const controller = new AbortController();
    controllers.set(key, controller);
    task.status = 'downloading';
    task.progress = 0;
    task.total = 0;
    task.received = 0;
    task.speed = 0;
    task.errorMsg = '';
    task.updatedAt = Date.now();
    scheduleSave();
    try {
        const resolved = await resolver(task);
        if (controller.signal.aborted)
            return;
        if (!resolved?.url)
            throw new Error('无法解析下载地址');
        task.songInfo = resolved.songInfo || task.songInfo;
        task.quality = resolved.quality || task.requestedQuality;
        task.activeSongKey = fileCache.normalizeSongId(task.songInfo) + '_' + task.quality;
        task.updatedAt = Date.now();
        scheduleSave();
        await fileCache.downloadAndCache(task.songInfo, resolved.url, task.quality, task.username, controller.signal, task.enableOnlyDownloadMode, task.cacheLyric, task.embedLyric, {
            requestedSource: resolved.requestedSource,
            downloadSource: resolved.downloadSource,
            sourceName: resolved.sourceName,
        });
        if (controller.signal.aborted)
            return;
        const progress = fileCache.cacheProgress.get(task.activeSongKey);
        task.status = progress?.status === 'exists' ? 'exists' : 'finished';
        task.progress = 100;
        task.total = Number(progress?.total || progress?.received || task.total || 0);
        task.received = Number(progress?.received || task.total || 0);
        task.speed = 0;
        task.errorMsg = '';
    }
    catch (err) {
        if (controller.signal.aborted || err?.message === 'Aborted') {
            task.status = 'paused';
            task.errorMsg = '已暂停';
        }
        else {
            task.status = 'error';
            task.errorMsg = err?.message || '下载失败';
        }
        task.speed = 0;
    }
    finally {
        controllers.delete(key);
        task.updatedAt = Date.now();
        scheduleSave();
        void processQueue();
    }
};
const processQueue = async () => {
    if (processing || !resolver)
        return;
    processing = true;
    try {
        while (true) {
            const activeByUser = new Map();
            for (const key of controllers.keys()) {
                const username = tasks.get(key)?.username;
                if (!username)
                    continue;
                activeByUser.set(username, (activeByUser.get(username) || 0) + 1);
            }
            const next = Array.from(tasks.values()).find(task => (task.status === 'waiting' && (activeByUser.get(task.username) || 0) < (0, exports.getConcurrency)(task.username)));
            if (!next)
                break;
            void runTask(next);
        }
    }
    finally {
        processing = false;
    }
};
const setConcurrency = (username, value) => {
    const concurrency = normalizeConcurrency(value);
    concurrencyByUser.set(username, concurrency);
    saveNow();
    void processQueue();
    return concurrency;
};
exports.setConcurrency = setConcurrency;
const initialize = (downloadResolver) => {
    resolver = downloadResolver;
    if (!initialized) {
        initialized = true;
        loadTasks();
        saveNow();
    }
    void processQueue();
};
exports.initialize = initialize;
const enqueue = (username, inputs) => {
    const added = [];
    for (const input of inputs) {
        if (!input?.songInfo)
            continue;
        const id = sanitizeId(input.id);
        const key = taskMapKey(username, id);
        const quality = input.quality || '320k';
        const existing = tasks.get(key);
        if (existing) {
            if (['waiting', 'downloading', 'tagging'].includes(existing.status))
                continue;
            const now = Date.now();
            existing.songKey = fileCache.normalizeSongId(input.songInfo) + '_' + quality;
            existing.activeSongKey = undefined;
            existing.songInfo = input.songInfo;
            existing.quality = quality;
            existing.requestedQuality = quality;
            existing.status = 'waiting';
            existing.progress = 0;
            existing.total = 0;
            existing.received = 0;
            existing.speed = 0;
            existing.errorMsg = '';
            existing.enableOnlyDownloadMode = !!input.enableOnlyDownloadMode;
            existing.cacheLyric = input.cacheLyric !== false;
            existing.embedLyric = input.embedLyric !== false;
            existing.createdAt = now;
            existing.updatedAt = now;
            added.push(existing);
            continue;
        }
        const now = Date.now();
        const task = {
            id, username,
            songKey: fileCache.normalizeSongId(input.songInfo) + '_' + quality,
            songInfo: input.songInfo,
            quality,
            requestedQuality: quality,
            status: 'waiting', progress: 0, total: 0, received: 0, speed: 0, errorMsg: '',
            enableOnlyDownloadMode: !!input.enableOnlyDownloadMode,
            cacheLyric: input.cacheLyric !== false,
            embedLyric: input.embedLyric !== false,
            createdAt: now, updatedAt: now,
        };
        tasks.set(key, task);
        added.push(task);
    }
    saveNow();
    void processQueue();
    return added.map(task => getPublicTask(task));
};
exports.enqueue = enqueue;
const list = (username) => Array.from(tasks.values())
    .filter(task => task.username === username)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(task => getPublicTask(task));
exports.list = list;
const pause = (username, id) => {
    for (const task of tasks.values()) {
        if (task.username !== username || (id && task.id !== id))
            continue;
        if (!['waiting', 'downloading', 'tagging'].includes(task.status))
            continue;
        task.status = 'paused';
        task.speed = 0;
        task.errorMsg = '已暂停';
        task.updatedAt = Date.now();
        controllers.get(taskMapKey(username, task.id))?.abort();
    }
    saveNow();
};
exports.pause = pause;
const resume = (username, id) => {
    for (const task of tasks.values()) {
        if (task.username !== username || (id && task.id !== id))
            continue;
        if (task.status !== 'paused' && task.status !== 'error')
            continue;
        task.status = 'waiting';
        task.progress = 0;
        task.total = 0;
        task.received = 0;
        task.speed = 0;
        task.errorMsg = '';
        task.activeSongKey = undefined;
        task.quality = task.requestedQuality;
        task.updatedAt = Date.now();
    }
    saveNow();
    void processQueue();
};
exports.resume = resume;
const remove = (username, options) => {
    for (const [key, task] of tasks) {
        if (task.username !== username)
            continue;
        const shouldRemove = options.all || (options.id && task.id === options.id) || (options.completed && ['finished', 'exists'].includes(task.status));
        if (!shouldRemove)
            continue;
        controllers.get(key)?.abort();
        tasks.delete(key);
    }
    saveNow();
    void processQueue();
};
exports.remove = remove;
