#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const module_alias_1 = __importDefault(require("module-alias"));
// @ts-ignore
module_alias_1.default.addAliases({
    '@renderer': path_1.default.join(__dirname, 'modules'),
    '@': __dirname
});
if (typeof global.navigator === 'undefined') {
    global.navigator = { userAgent: 'node.js' };
}
const log4js_1 = require("./utils/log4js");
const defaultConfig_1 = __importDefault(require("./defaultConfig"));
const constants_1 = require("./constants");
const utils_1 = require("./utils");
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
let envParams = {};
let envUsers = [];
const envParamKeys = Object.values(constants_1.ENV_PARAMS).filter(v => v != 'LX_USER_');
const parseBool = (val) => {
    if (val === undefined || val === null || val === '')
        return undefined;
    const str = String(val).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(str))
        return true;
    if (['false', '0', 'no', 'n', 'off'].includes(str))
        return false;
    return undefined;
};
const setBoolConfig = (key, val) => {
    const parsed = parseBool(val);
    if (parsed !== undefined) {
        // @ts-expect-error
        global.lx.config[key] = parsed;
    }
};
{
    const envLog = [
        ...envParamKeys.map(e => [e, process.env[e]]).filter(([k, v]) => {
            if (!v)
                return false;
            envParams[k] = v;
            return true;
        }),
        ...Object.entries(process.env)
            .filter(([k, v]) => {
            if (k.startsWith('LX_USER_') && !!v) {
                const name = k.replace('LX_USER_', '');
                if (name) {
                    envUsers.push({
                        name,
                        password: v,
                    });
                    return true;
                }
            }
            return false;
        }),
    ].map(([e, v]) => `${e}: ${v}`);
    if (envLog.length)
        console.log(`Load env: \n  ${envLog.join('\n  ')}`);
}
let lastConfigHash = '';
const getConfigHash = (filePath) => {
    try {
        if (!fs_1.default.existsSync(filePath))
            return '';
        const content = fs_1.default.readFileSync(filePath);
        return crypto_1.default.createHash('md5').update(content).digest('hex');
    }
    catch {
        return '';
    }
};
const dataPath = envParams.DATA_PATH ?? path_1.default.join(__dirname, '../data');
const saveConfigToFile = () => {
    const configPath = process.env.CONFIG_PATH || path_1.default.join(process.cwd(), 'config.js');
    const content = `module.exports = ${JSON.stringify(global.lx.config, null, 2)}`;
    try {
        fs_1.default.writeFileSync(configPath, content);
        lastConfigHash = crypto_1.default.createHash('md5').update(content).digest('hex');
        // console.log('Current memory config saved to config.js')
    }
    catch (err) {
        console.error('Failed to save config.js:', err);
    }
};
global.lx = {
    logPath: envParams.LOG_PATH ?? path_1.default.join(__dirname, '../logs'),
    dataPath,
    userPath: path_1.default.join(dataPath, constants_1.File.userDir),
    config: defaultConfig_1.default,
    staticPath: process.env.STATIC_PATH ?? path_1.default.join(process.cwd(), 'public'),
    saveConfig: saveConfigToFile,
};
const mergeConfigFileEnv = (config) => {
    const envLog = [];
    for (const [k, v] of Object.entries(config).filter(([k]) => k.startsWith('env.'))) {
        const envKey = k.replace('env.', '');
        let value = String(v);
        if (envParamKeys.includes(envKey)) {
            if (envParams[envKey] == null) {
                envLog.push(`${envKey}: ${value}`);
                envParams[envKey] = value;
            }
        }
        else if (envKey.startsWith('LX_USER_') && value) {
            const name = k.replace('LX_USER_', '');
            if (name) {
                envUsers.push({
                    name,
                    password: value,
                });
                envLog.push(`${envKey}: ${value}`);
            }
        }
    }
    if (envLog.length)
        console.log(`Load config file env:\n  ${envLog.join('\n  ')}`);
};
const margeConfig = (p) => {
    let config;
    try {
        config = path_1.default.extname(p) == '.js'
            ? require(p)
            : JSON.parse(fs_1.default.readFileSync(p).toString());
    }
    catch (err) {
        console.warn('Read config error: ' + err.message);
        return false;
    }
    const newConfig = { ...global.lx.config };
    for (const key of Object.keys(defaultConfig_1.default)) {
        // @ts-expect-error
        if (config[key] !== undefined)
            newConfig[key] = config[key];
    }
    console.log('Load config: ' + p);
    if (newConfig.users.length) {
        const users = [];
        for (const user of newConfig.users) {
            users.push({
                ...user,
                dataPath: '',
            });
        }
        newConfig.users = users;
    }
    global.lx.config = newConfig;
    mergeConfigFileEnv(config);
    return true;
};
//加载环境变量
const p1 = path_1.default.join(__dirname, '../config.js');
fs_1.default.existsSync(p1) && margeConfig(p1);
envParams.CONFIG_PATH && fs_1.default.existsSync(envParams.CONFIG_PATH) && margeConfig(envParams.CONFIG_PATH);
if (envParams.PROXY_HEADER) {
    global.lx.config['proxy.enabled'] = true;
    global.lx.config['proxy.header'] = envParams.PROXY_HEADER;
}
if (envParams.MAX_SNAPSHOT_NUM) {
    const num = parseInt(envParams.MAX_SNAPSHOT_NUM);
    if (!isNaN(num))
        global.lx.config.maxSnapshotNum = num;
}
if (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
    switch (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
        case 'top':
        case 'bottom':
            global.lx.config['list.addMusicLocationType'] = envParams.LIST_ADD_MUSIC_LOCATION_TYPE;
            break;
    }
}
if (envParams.FRONTEND_PASSWORD) {
    global.lx.config['frontend.password'] = envParams.FRONTEND_PASSWORD;
}
if (envParams.WEBDAV_ENABLE !== undefined) {
    setBoolConfig('webdav.enable', envParams.WEBDAV_ENABLE);
}
if (envParams.WEBDAV_URL) {
    global.lx.config['webdav.url'] = envParams.WEBDAV_URL;
}
if (envParams.WEBDAV_USERNAME) {
    global.lx.config['webdav.username'] = envParams.WEBDAV_USERNAME;
}
if (envParams.WEBDAV_PASSWORD) {
    global.lx.config['webdav.password'] = envParams.WEBDAV_PASSWORD;
}
if (envParams.WEBDAV_SYNC_PATH) {
    global.lx.config['webdav.syncPath'] = envParams.WEBDAV_SYNC_PATH;
}
if (envParams.WEBDAV_BACKUP_PATH) {
    global.lx.config['webdav.backupPath'] = envParams.WEBDAV_BACKUP_PATH;
}
if (envParams.SYNC_INTERVAL) {
    const interval = parseInt(envParams.SYNC_INTERVAL);
    if (!isNaN(interval))
        global.lx.config['sync.interval'] = interval;
}
if (envParams.BACKUP_INTERVAL) {
    const backupInterval = parseInt(envParams.BACKUP_INTERVAL);
    if (!isNaN(backupInterval))
        global.lx.config['sync.backupInterval'] = backupInterval;
}
if (envParams.USER_ENABLE_PATH !== undefined) {
    setBoolConfig('user.enablePath', envParams.USER_ENABLE_PATH);
}
if (envParams.USER_ENABLE_ROOT !== undefined) {
    setBoolConfig('user.enableRoot', envParams.USER_ENABLE_ROOT);
}
if (envParams.PORT) {
    const port = parseInt(envParams.PORT, 10);
    if (!isNaN(port) && port > 0)
        global.lx.config.port = port;
}
if (envParams.BIND_IP) {
    global.lx.config.bindIP = envParams.BIND_IP;
}
if (envParams.ENABLE_WEBPLAYER_AUTH !== undefined) {
    setBoolConfig('player.enableAuth', envParams.ENABLE_WEBPLAYER_AUTH);
}
if (envParams.WEBPLAYER_PASSWORD) {
    global.lx.config['player.password'] = envParams.WEBPLAYER_PASSWORD;
}
if (envParams.DISABLE_TELEMETRY !== undefined) {
    setBoolConfig('disableTelemetry', envParams.DISABLE_TELEMETRY);
}
if (envParams.ENABLE_PUBLIC_USER_RESTRICTION !== undefined) {
    setBoolConfig('user.enablePublicRestriction', envParams.ENABLE_PUBLIC_USER_RESTRICTION);
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC !== undefined) {
    setBoolConfig('user.enablePublicNonAdminLocalMusic', envParams.ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC);
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD !== undefined) {
    setBoolConfig('user.enablePublicNonAdminBrowserDownload', envParams.ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD);
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE !== undefined) {
    setBoolConfig('user.enablePublicNonAdminServerCache', envParams.ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE);
}
if (envParams.ENABLE_PUBLIC_FAVORITES !== undefined) {
    setBoolConfig('user.enablePublicFavorites', envParams.ENABLE_PUBLIC_FAVORITES);
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_ACCESS !== undefined) {
    setBoolConfig('user.enablePublicNonAdminAccess', envParams.ENABLE_PUBLIC_NON_ADMIN_ACCESS);
}
if (envParams.ENABLE_CUSTOM_MUSIC_DIR !== undefined) {
    setBoolConfig('user.enableCustomMusicDir', envParams.ENABLE_CUSTOM_MUSIC_DIR);
}
if (envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION !== undefined) {
    setBoolConfig('user.enableLoginCacheRestriction', envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION);
}
if (envParams.ENABLE_CACHE_SIZE_LIMIT !== undefined) {
    setBoolConfig('user.enableCacheSizeLimit', envParams.ENABLE_CACHE_SIZE_LIMIT);
}
if (envParams.CACHE_SIZE_LIMIT) {
    global.lx.config['user.cacheSizeLimit'] = parseInt(envParams.CACHE_SIZE_LIMIT) || 2000;
}
if (envParams.PROXY_ALL_ENABLED !== undefined) {
    setBoolConfig('proxy.all.enabled', envParams.PROXY_ALL_ENABLED);
}
if (envParams.PROXY_ALL_ADDRESS) {
    global.lx.config['proxy.all.address'] = envParams.PROXY_ALL_ADDRESS;
}
if (envParams.ADMIN_PATH !== undefined) {
    global.lx.config['admin.path'] = envParams.ADMIN_PATH;
}
if (envParams.PLAYER_PATH !== undefined) {
    global.lx.config['player.path'] = envParams.PLAYER_PATH;
}
if (envParams.SUBSONIC_ENABLE !== undefined) {
    setBoolConfig('subsonic.enable', envParams.SUBSONIC_ENABLE);
}
if (envParams.SUBSONIC_PATH !== undefined) {
    global.lx.config['subsonic.path'] = envParams.SUBSONIC_PATH;
}
if (envParams.SUBSONIC_ENABLE_DEBUG !== undefined) {
    setBoolConfig('subsonic.enableDebug', envParams.SUBSONIC_ENABLE_DEBUG);
}
if (envParams.SUBSONIC_ONLINE_SEARCH !== undefined) {
    setBoolConfig('subsonic.onlineSearch', envParams.SUBSONIC_ONLINE_SEARCH);
}
if (envParams.SUBSONIC_ONLINE_SEARCH_MODE) {
    const mode = envParams.SUBSONIC_ONLINE_SEARCH_MODE;
    if (['fallback', 'merge', 'local_only'].includes(mode)) {
        global.lx.config['subsonic.onlineSearchMode'] = mode;
    }
}
if (envParams.SUBSONIC_ONLINE_SEARCH_SOURCES) {
    global.lx.config['subsonic.onlineSearchSources'] = envParams.SUBSONIC_ONLINE_SEARCH_SOURCES;
}
if (envParams.SUBSONIC_LYRIC_TRANSLATION !== undefined) {
    setBoolConfig('subsonic.lyricTranslation', envParams.SUBSONIC_LYRIC_TRANSLATION);
}
if (envParams.ARTIST_MAX_FETCH_PAGES) {
    const pages = parseInt(envParams.ARTIST_MAX_FETCH_PAGES, 10);
    if (!isNaN(pages) && pages > 0)
        global.lx.config['artist.maxFetchPages'] = pages;
}
if (envParams.CACHE_NAMING_PATTERN) {
    global.lx.config['cache.namingPattern'] = envParams.CACHE_NAMING_PATTERN;
}
if (envParams.SYSTEM_ALLOW_UNSAFE_VM !== undefined) {
    setBoolConfig('system.allowUnsafeVM', envParams.SYSTEM_ALLOW_UNSAFE_VM);
}
if (envParams.SINGER_SOURCE_PRIORITY !== undefined) {
    const priority = envParams.SINGER_SOURCE_PRIORITY.split(',').filter(s => s === 'tx' || s === 'wy');
    if (priority.length > 0)
        global.lx.config['singer.sourcePriority'] = priority;
}
if (envParams.SERVER_NAME) {
    global.lx.config.serverName = envParams.SERVER_NAME;
}
if (envUsers.length) {
    const users = [];
    let u;
    for (let user of envUsers) {
        let isLikeJSON = true;
        try {
            u = JSON.parse(user.password);
        }
        catch {
            isLikeJSON = false;
        }
        if (isLikeJSON && typeof u == 'object') {
            users.push({
                name: user.name,
                ...u,
                dataPath: '',
            });
        }
        else {
            users.push({
                name: user.name,
                password: user.password,
                dataPath: '',
            });
        }
    }
    global.lx.config.users = users;
}
const exit = (message) => {
    console.error(message);
    process.exit(0);
};
const checkAndCreateDir = (path) => {
    try {
        (0, utils_1.checkAndCreateDirSync)(path);
    }
    catch (e) {
        if (e.code !== 'EEXIST') {
            exit(`Could not set up log directory, error was: ${e.message}`);
        }
    }
};
const checkUserConfig = (users) => {
    const userNames = [];
    const passwords = [];
    // 允许重复密码的条件：开启了路径模式 且 关闭了根路径模式
    const allowDuplicatePasswords = global.lx.config['user.enablePath'] && !global.lx.config['user.enableRoot'];
    for (const user of users) {
        if (userNames.includes(user.name))
            exit('User name duplicate: ' + user.name);
        if (!allowDuplicatePasswords && passwords.includes(user.password))
            exit('User password duplicate: ' + user.password);
        userNames.push(user.name);
        passwords.push(user.password);
    }
};
checkAndCreateDir(global.lx.logPath);
checkAndCreateDir(global.lx.dataPath);
checkAndCreateDir(global.lx.userPath);
checkAndCreateDir(global.lx.userPath);
// Load users from users.json if exists
const usersJsonPath = path_1.default.join(global.lx.dataPath, 'users.json');
if (fs_1.default.existsSync(usersJsonPath)) {
    try {
        const users = JSON.parse(fs_1.default.readFileSync(usersJsonPath, 'utf-8'));
        if (Array.isArray(users)) {
            console.log('Load users from users.json');
            global.lx.config.users = users.map(u => ({ ...u, dataPath: '' }));
        }
    }
    catch (err) {
        console.error('Failed to load users.json', err);
    }
}
else {
    // Save initial users to users.json
    try {
        fs_1.default.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
            name: u.name,
            password: u.password,
            maxSnapshotNum: u.maxSnapshotNum,
            'list.addMusicLocationType': u['list.addMusicLocationType'],
        })), null, 2));
    }
    catch (err) {
        console.error('Failed to save users.json', err);
    }
}
// [P1 安全债 2026-09-14] 明文密码迁移:password→bcrypt hash + syncKey(MD5, LX 配对协议 key 派生用,协议约束不可 bcrypt)
// 存储不再含明文;攻击者拿到 users.json 也无法反推密码(syncKey 仅可用于 LX 配对派生,不可逆推明文)
{
    const bcrypt = require('bcryptjs');
    const md5hex = (s) => require('node:crypto').createHash('md5').update(s).digest('hex');
    let migrated = false;
    for (const u of global.lx.config.users) {
        if (u.password && !u.password.startsWith('$2')) {
            u.syncKey = md5hex(u.password);
            u.password = bcrypt.hashSync(u.password, 10);
            migrated = true;
        }
    }
    if (migrated) {
        try {
            fs_1.default.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
                name: u.name,
                password: u.password,
                syncKey: u.syncKey,
                maxSnapshotNum: u.maxSnapshotNum,
                'list.addMusicLocationType': u['list.addMusicLocationType'],
            })), null, 2));
            console.log('users.json migrated to bcrypt+syncKey (plaintext removed)');
        }
        catch (err) {
            console.error('Failed to write migrated users.json', err);
        }
    }
}
checkUserConfig(global.lx.config.users);
console.log(`Users:
${global.lx.config.users.map(user => `  ${user.name} (auth: ${user.syncKey ? 'bcrypt+syncKey' : 'legacy'})`).join('\n') || '  No User'}
`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getUserDirname } = require('./user');
let hasUserCustomDirModified = false;
for (const user of global.lx.config.users) {
    const dataPath = path_1.default.join(global.lx.userPath, getUserDirname(user.name));
    checkAndCreateDir(dataPath);
    user.dataPath = dataPath;
    if (user.enableCustomMusicDir) {
        let isValid = false;
        if (user.customMusicDir && typeof user.customMusicDir === 'string' && user.customMusicDir.trim()) {
            const resolvedDir = path_1.default.resolve(user.customMusicDir.trim());
            try {
                if (fs_1.default.existsSync(resolvedDir) && fs_1.default.statSync(resolvedDir).isDirectory()) {
                    isValid = true;
                }
            }
            catch {
                isValid = false;
            }
        }
        if (!isValid) {
            console.warn(`[StartupCheck] 用户 ${user.name} 的自定义歌曲目录 [${user.customMusicDir || ''}] 无效，已自动关闭自定义目录功能并清除路径`);
            user.enableCustomMusicDir = false;
            user.customMusicDir = '';
            hasUserCustomDirModified = true;
        }
    }
}
if (hasUserCustomDirModified) {
    saveConfigToFile();
    try {
        fs_1.default.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
            name: u.name,
            password: u.password,
            syncKey: u.syncKey,
            maxSnapshotNum: u.maxSnapshotNum,
            'list.addMusicLocationType': u['list.addMusicLocationType'],
            enableCustomMusicDir: u.enableCustomMusicDir,
            customMusicDir: u.customMusicDir,
            allowOperateCustomMusicDir: u.allowOperateCustomMusicDir,
            allowWriteCustomMusicDir: u.allowWriteCustomMusicDir,
        })), null, 2));
    }
    catch (err) {
        console.error('Failed to update users.json after custom dir cleanup', err);
    }
}
(0, log4js_1.initLogger)();
/**
 * Normalize a port into a number, string, or false.
 */
function normalizePort(val) {
    const port = parseInt(val, 10);
    if (isNaN(port) || port < 1) {
        // named pipe
        exit(`port illegal: ${val}`);
    }
    return port;
}
/**
 * Get port from environment and store in Express.
 */
// const port = normalizePort(envParams.PORT ?? '9527')
// const bindIP = envParams.BIND_IP ?? '127.0.0.1'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createModuleEvent } = require('./event');
createModuleEvent();
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./utils/migrate').default(global.lx.dataPath, global.lx.userPath);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startServer } = require('./server');
// 初始化 WebDAV 同步
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebDAVSync = require('./utils/webdavSync').default;
const webdavSync = new WebDAVSync({
    enable: global.lx.config['webdav.enable'],
    url: global.lx.config['webdav.url'],
    username: global.lx.config['webdav.username'],
    password: global.lx.config['webdav.password'],
    syncPath: global.lx.config['webdav.syncPath'],
    backupPath: global.lx.config['webdav.backupPath'],
    interval: global.lx.config['sync.interval'],
    backupInterval: global.lx.config['sync.backupInterval'],
}, global.lx.dataPath);
// 如果配置了 WebDAV，在启动时尝试从远程恢复
if (webdavSync.isConfigured()) {
    console.log('WebDAV configured, attempting to restore from remote...');
    void webdavSync.restoreFromRemote().then(async (success) => {
        if (success) {
            console.log('Data restored from WebDAV successfully');
            // 1. 重新从磁盘加载最新的 config.js 到内存 (解决实时生效问题)
            const configPath = process.env.CONFIG_PATH || path_1.default.join(process.cwd(), 'config.js');
            if (fs_1.default.existsSync(configPath)) {
                console.log('Reloading config.js after WebDAV restore...');
                // 清除 node require 缓存以强制重载
                try {
                    delete require.cache[require.resolve(configPath)];
                    margeConfig(configPath);
                }
                catch (e) {
                    console.error('Failed to hot-reload config.js:', e);
                }
            }
            // 2. 重新加载 users.json
            const usersJsonPath = path_1.default.join(global.lx.dataPath, 'users.json');
            if (fs_1.default.existsSync(usersJsonPath)) {
                try {
                    const users = JSON.parse(fs_1.default.readFileSync(usersJsonPath, 'utf-8'));
                    if (Array.isArray(users)) {
                        console.log('Reload users from restored users.json');
                        global.lx.config.users = users.map(u => ({ ...u, dataPath: '' }));
                        // 重新初始化用户目录
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const { getUserDirname } = require('./user');
                        for (const user of global.lx.config.users) {
                            const dataPath = path_1.default.join(global.lx.userPath, getUserDirname(user.name));
                            checkAndCreateDir(dataPath);
                            user.dataPath = dataPath;
                        }
                    }
                }
                catch (err) {
                    console.error('Failed to reload users.json after WebDAV restore', err);
                }
            }
            // 3. 重新加载所有自定义源 (解决前端显示加载中/旧源问题)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { initUserApis } = require('./server/userApi');
            console.log('Re-initializing user APIs after WebDAV restore...');
            await initUserApis();
        }
        // 启动自动同步
        webdavSync.startAutoSync();
    });
}
else {
    console.log('WebDAV not configured, skipping remote restore');
}
// 导出 webdavSync 实例供 API 使用
global.lx.webdavSync = webdavSync;
// [新增] 确保数据目录下的 _open 及 _open/library 目录存在 (用于公共受限资源 & 公开收藏)
const openDir = path_1.default.join(global.lx.userPath, '_open');
const openLibDir = path_1.default.join(openDir, 'library');
if (!fs_1.default.existsSync(openDir)) {
    fs_1.default.mkdirSync(openDir, { recursive: true });
}
if (!fs_1.default.existsSync(openLibDir)) {
    fs_1.default.mkdirSync(openLibDir, { recursive: true });
}
// 启动前最后保存一次合并后的配置，确保环境变量被固化到 config.js 中
saveConfigToFile();
startServer(global.lx.config.port, global.lx.config.bindIP);
// 监控 config.js 变动以实现热重载 (由于 nodemon 已忽略该文件)
const rootConfigPath = process.env.CONFIG_PATH || path_1.default.join(process.cwd(), 'config.js');
if (fs_1.default.existsSync(rootConfigPath)) {
    lastConfigHash = getConfigHash(rootConfigPath);
    let debounceTimer = null;
    fs_1.default.watch(rootConfigPath, (event) => {
        if (event === 'change') {
            if (debounceTimer)
                clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const currentHash = getConfigHash(rootConfigPath);
                // 如果内容未发生实质改变（如内部写配置触发的 fs.watch 事件），跳过热重载
                if (currentHash && currentHash === lastConfigHash)
                    return;
                lastConfigHash = currentHash;
                console.log('Detected external config.js change, hot-reloading...');
                try {
                    delete require.cache[require.resolve(rootConfigPath)];
                    margeConfig(rootConfigPath);
                    // 重新初始化各模块以使用新配置（如果需要）
                    if (global.lx.webdavSync) {
                        global.lx.webdavSync.updateConfig({
                            url: global.lx.config['webdav.url'],
                            username: global.lx.config['webdav.username'],
                            password: global.lx.config['webdav.password'],
                            syncPath: global.lx.config['webdav.syncPath'],
                            backupPath: global.lx.config['webdav.backupPath'],
                            interval: global.lx.config['sync.interval'],
                            backupInterval: global.lx.config['sync.backupInterval'],
                        });
                    }
                }
                catch (e) {
                    console.error('Hot-reload config.js failed:', e);
                }
            }, 500);
        }
    });
}
