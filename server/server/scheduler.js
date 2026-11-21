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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopScheduler = exports.startScheduler = exports.getSchedulerStatus = exports.updateTaskConfig = exports.executeTask = exports.registerTask = exports.syncDownloadForAllUsers = exports.createSyncDownloadTask = exports.checkAllUsersNetworkLists = exports.parseIntervalMs = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const log4js_1 = require("../utils/log4js.js");
const networkListTask_1 = require("./task/networkListTask");
const syncDownloadTask_1 = require("./task/syncDownloadTask");
Object.defineProperty(exports, "createSyncDownloadTask", { enumerable: true, get: function () { return syncDownloadTask_1.createSyncDownloadTask; } });
Object.defineProperty(exports, "syncDownloadForAllUsers", { enumerable: true, get: function () { return syncDownloadTask_1.syncDownloadForAllUsers; } });
__exportStar(require("./task/types"), exports);
var networkListTask_2 = require("./task/networkListTask");
Object.defineProperty(exports, "parseIntervalMs", { enumerable: true, get: function () { return networkListTask_2.parseIntervalMs; } });
Object.defineProperty(exports, "checkAllUsersNetworkLists", { enumerable: true, get: function () { return networkListTask_2.checkAllUsersNetworkLists; } });
// 调度器内部状态
const registeredTasks = new Map();
const taskTimers = new Map();
let isSchedulerRunning = false;
const getRuntimeDir = () => {
    const dir = node_path_1.default.join(global.lx?.dataPath || process.cwd(), 'runtime');
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
};
const getTaskRecordsFilePath = () => node_path_1.default.join(getRuntimeDir(), 'network-list-autoupdate-records.json');
const loadTaskRecords = () => {
    try {
        const p = getTaskRecordsFilePath();
        if (node_fs_1.default.existsSync(p)) {
            return JSON.parse(node_fs_1.default.readFileSync(p, 'utf8'));
        }
    }
    catch { }
    return {};
};
const saveTaskRecords = () => {
    try {
        const p = getTaskRecordsFilePath();
        const records = {};
        for (const [id, task] of registeredTasks.entries()) {
            records[id] = {
                lastRunTime: task.lastRunTime,
                nextRunTime: task.nextRunTime,
                lastResult: task.lastResult
            };
        }
        node_fs_1.default.writeFileSync(p, JSON.stringify(records, null, 2), 'utf8');
    }
    catch (err) {
        log4js_1.syncLog.warn('[Scheduler] 保存任务执行记录失败:', err.message);
    }
};
/**
 * 安排下次执行
 */
const scheduleNextRun = (task) => {
    if (taskTimers.has(task.id)) {
        clearTimeout(taskTimers.get(task.id));
        taskTimers.delete(task.id);
    }
    if (!task.enabled || task.intervalMs <= 0) {
        task.nextRunTime = undefined;
        saveTaskRecords();
        return;
    }
    task.nextRunTime = Date.now() + task.intervalMs;
    saveTaskRecords();
    const timer = setTimeout(async () => {
        await (0, exports.executeTask)(task.id);
        if (task.enabled && isSchedulerRunning) {
            scheduleNextRun(task);
        }
    }, task.intervalMs);
    taskTimers.set(task.id, timer);
};
/**
 * 注册后台任务
 */
const registerTask = (task) => {
    const records = loadTaskRecords();
    if (records[task.id]) {
        task.lastRunTime = records[task.id].lastRunTime;
        task.lastResult = records[task.id].lastResult;
    }
    registeredTasks.set(task.id, task);
    if (isSchedulerRunning && task.enabled && task.intervalMs > 0) {
        scheduleNextRun(task);
    }
};
exports.registerTask = registerTask;
/**
 * 手动或定时执行任务
 */
const executeTask = async (taskId) => {
    const task = registeredTasks.get(taskId);
    if (!task) {
        return {
            taskId,
            timestamp: Date.now(),
            success: false,
            message: `任务 ${taskId} 未注册`
        };
    }
    if (task.isRunning) {
        return {
            taskId,
            timestamp: Date.now(),
            success: false,
            message: `任务 ${task.name} 正在运行中，跳过本次执行`
        };
    }
    task.isRunning = true;
    task.lastRunTime = Date.now();
    log4js_1.syncLog.info(`[Scheduler] 开始执行后台任务: ${task.name} (${task.id})`);
    try {
        const result = await task.run();
        task.lastResult = result;
        log4js_1.syncLog.info(`[Scheduler] 任务执行完毕: ${task.name}, 结果: ${result.message}`);
        return result;
    }
    catch (err) {
        const errorResult = {
            taskId,
            timestamp: Date.now(),
            success: false,
            message: `执行失败: ${err.message}`
        };
        task.lastResult = errorResult;
        log4js_1.syncLog.error(`[Scheduler] 任务 ${task.name} 执行异常:`, err);
        return errorResult;
    }
    finally {
        task.isRunning = false;
        task.nextRunTime = task.enabled && task.intervalMs > 0 ? Date.now() + task.intervalMs : undefined;
        saveTaskRecords();
    }
};
exports.executeTask = executeTask;
/**
 * 更新任务的定时配置
 */
const updateTaskConfig = (taskId, config) => {
    const task = registeredTasks.get(taskId);
    if (!task)
        return false;
    if (typeof config.enabled === 'boolean') {
        task.enabled = config.enabled;
    }
    if (typeof config.intervalMs === 'number' && config.intervalMs >= 0) {
        task.intervalMs = config.intervalMs;
    }
    if (taskTimers.has(task.id)) {
        clearTimeout(taskTimers.get(task.id));
        taskTimers.delete(task.id);
    }
    if (isSchedulerRunning && task.enabled && task.intervalMs > 0) {
        scheduleNextRun(task);
    }
    else {
        task.nextRunTime = undefined;
        saveTaskRecords();
    }
    return true;
};
exports.updateTaskConfig = updateTaskConfig;
/**
 * 获取所有任务的状态快照
 */
const getSchedulerStatus = () => {
    return Array.from(registeredTasks.values()).map(task => ({
        id: task.id,
        name: task.name,
        intervalMs: task.intervalMs,
        enabled: task.enabled,
        isRunning: task.isRunning,
        lastRunTime: task.lastRunTime,
        nextRunTime: task.nextRunTime,
        lastResult: task.lastResult,
    }));
};
exports.getSchedulerStatus = getSchedulerStatus;
/**
 * 启动后台任务调度中心
 */
const startScheduler = () => {
    if (isSchedulerRunning)
        return;
    isSchedulerRunning = true;
    // 注册默认网络歌单任务（从 task/networkListTask.ts 加载）
    const networkListTask = (0, networkListTask_1.createNetworkListTask)();
    (0, exports.registerTask)(networkListTask);
    // 注册歌曲同步下载任务（从 task/syncDownloadTask.ts 加载）
    const syncDownloadTask = (0, syncDownloadTask_1.createSyncDownloadTask)();
    (0, exports.registerTask)(syncDownloadTask);
    log4js_1.syncLog.info('[Scheduler] 后台任务调度器已启动');
    // 针对已启用的任务：
    // 1. 安排下一次定期执行时间
    // 2. 如果任务开启，服务端启动后延时 3 秒立即执行一次初始检查
    for (const task of registeredTasks.values()) {
        if (task.enabled && task.intervalMs > 0) {
            scheduleNextRun(task);
            // 服务端刚开机/刚启动时立即执行一次（延迟3秒等待网络/musicSdk初始化）
            setTimeout(() => {
                if (isSchedulerRunning && task.enabled) {
                    log4js_1.syncLog.info(`[Scheduler] 服务端启动，触发任务首次执行: ${task.name}`);
                    void (0, exports.executeTask)(task.id);
                }
            }, 3000);
        }
    }
};
exports.startScheduler = startScheduler;
/**
 * 停止后台任务调度中心
 */
const stopScheduler = () => {
    isSchedulerRunning = false;
    for (const [id, timer] of taskTimers.entries()) {
        clearTimeout(timer);
    }
    taskTimers.clear();
    log4js_1.syncLog.info('[Scheduler] 后台任务调度器已停止');
};
exports.stopScheduler = stopScheduler;
