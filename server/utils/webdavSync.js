"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = require("archiver");
const unzipper_1 = require("unzipper");
const crypto_1 = __importDefault(require("crypto"));
const events_1 = require("events");
const stream_1 = require("stream");
const normalizeRemotePath = (p, defaultPath = '') => {
    let str = (p || '').trim();
    if (!str)
        str = defaultPath;
    if (!str.startsWith('/'))
        str = '/' + str;
    return str.replace(/\/+$/, '');
};
class WebDAVSync extends events_1.EventEmitter {
    config;
    dataPath;
    syncPath;
    backupPath;
    syncInterval; // 文件增量变化检测与同步间隔（毫秒）
    backupInterval; // 全量备份间隔（毫秒）
    watchTimer = null;
    backupTimer = null;
    filesHash = new Map();
    syncLogs = [];
    client = null;
    initPromise = null;
    ensuredDirs = new Set();
    constructor(config, dataPath) {
        super();
        this.syncPath = normalizeRemotePath(config.syncPath, '/lx-sync');
        this.backupPath = normalizeRemotePath(config.backupPath, '/lx-sync-backups');
        this.config = {
            enable: config.enable ?? false,
            url: config.url || '',
            username: config.username || '',
            password: config.password || '',
            syncPath: this.syncPath,
            backupPath: this.backupPath,
        };
        this.syncInterval = (config.interval || 60) * 60 * 1000;
        this.backupInterval = (config.backupInterval || 24) * 60 * 60 * 1000;
        this.dataPath = dataPath;
    }
    async initClient(force = false) {
        if (!this.isConfigured())
            return false;
        if (this.client && !force)
            return true;
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = (async () => {
            try {
                // 动态导入 webdav ESM 模块
                const { createClient } = await import('webdav');
                const options = {};
                if (this.config.username)
                    options.username = this.config.username;
                if (this.config.password)
                    options.password = this.config.password;
                this.client = createClient(this.config.url, options);
                console.log('WebDAV client initialized');
                return true;
            }
            catch (err) {
                console.error('Failed to initialize WebDAV client:', err);
                this.client = null;
                return false;
            }
            finally {
                this.initPromise = null;
            }
        })();
        return this.initPromise;
    }
    isConfigured() {
        return !!(this.config.enable && this.config.url && this.config.url.trim() !== '');
    }
    addLog(log) {
        this.syncLogs.unshift(log);
        if (this.syncLogs.length > 100) {
            this.syncLogs = this.syncLogs.slice(0, 100);
        }
    }
    getSyncLogs() {
        return this.syncLogs;
    }
    getFileHash(filePath) {
        try {
            const buffer = fs_1.default.readFileSync(filePath);
            const hash = crypto_1.default.createHash('md5');
            hash.update(buffer);
            return hash.digest('hex');
        }
        catch {
            return '';
        }
    }
    async scanFiles() {
        const files = new Map();
        const scanDir = (dir) => {
            const items = fs_1.default.readdirSync(dir);
            for (const item of items) {
                const fullPath = path_1.default.join(dir, item);
                const stat = fs_1.default.statSync(fullPath);
                if (stat.isDirectory()) {
                    scanDir(fullPath);
                }
                else {
                    const relativePath = path_1.default.relative(this.dataPath, fullPath);
                    if (!relativePath.includes('temp-') && !relativePath.endsWith('.log')) {
                        files.set(relativePath, this.getFileHash(fullPath));
                    }
                }
            }
        };
        scanDir(this.dataPath);
        return files;
    }
    async getChangedFiles() {
        const currentFiles = await this.scanFiles();
        const changed = [];
        const deleted = [];
        // 检查新增和修改的文件
        for (const [file, hash] of currentFiles) {
            if (!this.filesHash.has(file) || this.filesHash.get(file) !== hash) {
                changed.push(file);
            }
        }
        // 检查已删除的文件
        for (const [file] of this.filesHash) {
            if (!currentFiles.has(file)) {
                deleted.push(file);
            }
        }
        this.filesHash = currentFiles;
        return { changed, deleted };
    }
    getRelativeRemotePath(remoteFilename) {
        const prefix = this.syncPath.endsWith('/') ? this.syncPath : this.syncPath + '/';
        if (remoteFilename.startsWith(prefix)) {
            return remoteFilename.slice(prefix.length);
        }
        if (remoteFilename.startsWith(this.syncPath)) {
            return remoteFilename.slice(this.syncPath.length).replace(/^\/+/, '');
        }
        return remoteFilename.replace(/^\/+/, '');
    }
    async runConcurrent(items, concurrency, fn) {
        if (items.length === 0)
            return [];
        const results = new Array(items.length);
        let index = 0;
        const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (index < items.length) {
                const currentIndex = index++;
                results[currentIndex] = await fn(items[currentIndex], currentIndex);
            }
        });
        await Promise.all(workers);
        return results;
    }
    async deleteRemoteFile(relativePath) {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`;
            await this.client.deleteFile(remotePath);
            this.addLog({
                timestamp: Date.now(),
                type: 'upload', // 借用 upload 类型表示同步操作
                file: relativePath,
                status: 'success',
                message: 'Remote file deleted'
            });
            return true;
        }
        catch (err) {
            // 如果远程文件已经不存在，也认为成功
            if (err.status === 404)
                return true;
            console.error(`Failed to delete remote file ${relativePath}:`, err.message);
            return false;
        }
    }
    async uploadFile(relativePath) {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            const localPath = path_1.default.join(this.dataPath, relativePath);
            if (!fs_1.default.existsSync(localPath))
                return false;
            const stat = fs_1.default.statSync(localPath);
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`;
            // 缓存已创建过的远程目录，避免每个文件重复发送 createDirectory 请求
            const remoteDir = path_1.default.dirname(remotePath);
            if (!this.ensuredDirs.has(remoteDir)) {
                await this.client.createDirectory(remoteDir, { recursive: true });
                this.ensuredDirs.add(remoteDir);
            }
            // 使用流式上传并监控进度
            const readStream = fs_1.default.createReadStream(localPath);
            const passThrough = new stream_1.PassThrough();
            let uploadedBytes = 0;
            passThrough.on('data', (chunk) => {
                uploadedBytes += chunk.length;
                // 限制进度事件触发频率，例如每 1% 或每 100ms 触发一次，这里简单处理
                // 如果文件很小，可能瞬间完成
                this.emit('progress', {
                    type: 'file',
                    status: 'uploading',
                    file: relativePath,
                    current: uploadedBytes,
                    total: stat.size
                });
            });
            readStream.pipe(passThrough);
            await this.client.putFileContents(remotePath, passThrough);
            this.emit('progress', {
                type: 'file',
                status: 'success',
                file: relativePath,
                current: stat.size,
                total: stat.size
            });
            this.addLog({
                timestamp: Date.now(),
                type: 'upload',
                file: relativePath,
                status: 'success',
            });
            return true;
        }
        catch (err) {
            console.error(`[WebDAV] Failed to upload file ${relativePath}:`, err.message);
            this.emit('progress', {
                type: 'file',
                status: 'error',
                file: relativePath,
                error: err.message
            });
            this.addLog({
                timestamp: Date.now(),
                type: 'upload',
                file: relativePath,
                status: 'error',
                message: err.message,
            });
            return false;
        }
    }
    async downloadFile(relativePath) {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`;
            const localPath = path_1.default.join(this.dataPath, relativePath);
            // 确保本地目录存在
            const localDir = path_1.default.dirname(localPath);
            if (!fs_1.default.existsSync(localDir)) {
                fs_1.default.mkdirSync(localDir, { recursive: true });
            }
            const content = await this.client.getFileContents(remotePath);
            // 对比内容哈希，如果一致则跳过写入，避免触发文件系统监控
            if (fs_1.default.existsSync(localPath)) {
                const localContent = fs_1.default.readFileSync(localPath);
                const localHash = crypto_1.default.createHash('md5').update(localContent).digest('hex');
                const remoteHash = crypto_1.default.createHash('md5').update(content).digest('hex');
                if (localHash === remoteHash) {
                    // console.log(`File ${relativePath} is up to date, skipping write.`)
                    return true;
                }
            }
            fs_1.default.writeFileSync(localPath, content);
            if (relativePath === 'config.js') {
                console.log('config.js restored from WebDAV, content updated in data directory.');
            }
            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'success',
            });
            return true;
        }
        catch (err) {
            console.error(`[WebDAV] Failed to download file ${relativePath}:`, err.message);
            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'error',
                message: err.message,
            });
            return false;
        }
    }
    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const zipName = `lx-sync-backup-${timestamp}.zip`;
            const zipPath = path_1.default.join(this.dataPath, zipName);
            await new Promise((resolve, reject) => {
                const output = fs_1.default.createWriteStream(zipPath);
                const archive = new archiver_1.ZipArchive({ zlib: { level: 9 } });
                let fileCount = 0;
                // 监听文件添加事件
                archive.on('entry', (entry) => {
                    fileCount++;
                    this.emit('progress', {
                        type: 'backup',
                        status: 'packing',
                        message: `正在打包文件: ${entry.name}`,
                        current: fileCount
                    });
                });
                output.on('close', () => resolve());
                archive.on('error', (err) => reject(err));
                archive.pipe(output);
                archive.glob('**/*', {
                    cwd: this.dataPath,
                    ignore: ['temp-*.zip', '*.log', 'lx-sync-backup-*.zip'],
                });
                archive.finalize();
            });
            return zipName;
        }
        catch (err) {
            console.error('Failed to create backup:', err);
            return null;
        }
    }
    async uploadBackup(force = false) {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            // 检查是否有文件变化
            if (!force) {
                const { changed, deleted } = await this.getChangedFiles();
                if (changed.length === 0 && deleted.length === 0) {
                    console.log('No changes detected, skipping backup');
                    return true;
                }
            }
            this.emit('progress', { type: 'backup', status: 'preparing', message: '正在创建备份...' });
            const zipName = await this.createBackup();
            if (!zipName)
                return false;
            const zipPath = path_1.default.join(this.dataPath, zipName);
            const stat = fs_1.default.statSync(zipPath);
            const remotePath = `${this.backupPath}/${zipName}`;
            // 使用流式上传并监控进度
            const readStream = fs_1.default.createReadStream(zipPath);
            const passThrough = new stream_1.PassThrough();
            let uploadedBytes = 0;
            // 节流控制，避免发送过多 SSE 消息
            let lastProgressTime = 0;
            passThrough.on('data', (chunk) => {
                uploadedBytes += chunk.length;
                const now = Date.now();
                if (now - lastProgressTime > 100 || uploadedBytes === stat.size) { // 至少间隔100ms
                    this.emit('progress', {
                        type: 'backup',
                        status: 'uploading',
                        file: zipName,
                        total: stat.size,
                        current: uploadedBytes
                    });
                    lastProgressTime = now;
                }
            });
            readStream.pipe(passThrough);
            try {
                await this.client.putFileContents(remotePath, passThrough);
                this.emit('progress', {
                    type: 'backup',
                    status: 'success',
                    file: zipName,
                    total: stat.size,
                    current: stat.size
                });
                this.addLog({
                    timestamp: Date.now(),
                    type: 'backup',
                    file: zipName,
                    status: 'success',
                });
            }
            finally {
                // 确保无论上传成功还是失败，总是及时清理本地临时 zip 文件
                if (fs_1.default.existsSync(zipPath)) {
                    try {
                        fs_1.default.unlinkSync(zipPath);
                    }
                    catch (e) {
                        console.error('Failed to cleanup local backup zip:', e);
                    }
                }
            }
            // 清理旧备份（保留最近5个）
            try {
                await this.cleanOldBackups();
            }
            catch (e) {
                console.error('Failed to clean old remote backups:', e);
            }
            return true;
        }
        catch (err) {
            this.emit('progress', { type: 'backup', status: 'error', error: err.message });
            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: 'backup',
                status: 'error',
                message: err.message,
            });
            return false;
        }
    }
    async syncAllFiles() {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            const files = await this.scanFiles();
            const fileList = Array.from(files.keys());
            let count = 0;
            const total = fileList.length;
            this.emit('progress', { type: 'sync', status: 'start', total });
            let successCount = 0;
            let failCount = 0;
            // 使用受控并发（最多 5 个并发连接）加速批量文件上传
            await this.runConcurrent(fileList, 5, async (file) => {
                count++;
                this.emit('progress', {
                    type: 'sync',
                    status: 'processing',
                    current: count,
                    total,
                    file
                });
                const ok = await this.uploadFile(file);
                if (ok)
                    successCount++;
                else
                    failCount++;
            });
            this.emit('progress', { type: 'sync', status: 'finish', total });
            if (failCount > 0) {
                console.warn(`[WebDAV] Sync all files finished with errors: ${successCount} succeeded, ${failCount} failed.`);
            }
            else {
                console.log(`[WebDAV] Sync all files finished successfully (${successCount} files).`);
            }
            return failCount === 0;
        }
        catch (err) {
            console.error('Sync all files failed:', err);
            return false;
        }
    }
    parseBackupTime(item) {
        if (item.lastmod) {
            const parsed = Date.parse(item.lastmod);
            if (!isNaN(parsed))
                return parsed;
        }
        const match = item.basename?.match(/lx-sync-backup-(.+?)\.zip$/);
        if (match && match[1]) {
            const parts = match[1].split('T');
            if (parts.length === 2) {
                const timeStr = parts[1].replace(/(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/, '$1:$2:$3.$4');
                const parsed = Date.parse(`${parts[0]}T${timeStr}`);
                if (!isNaN(parsed))
                    return parsed;
            }
        }
        return 0;
    }
    async cleanOldBackups() {
        if (!this.client)
            return;
        try {
            const items = await this.client.getDirectoryContents(`${this.backupPath}/`);
            const backups = items
                .filter((item) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a, b) => this.parseBackupTime(b) - this.parseBackupTime(a));
            // 删除第6个及以后的备份
            for (let i = 5; i < backups.length; i++) {
                await this.client.deleteFile(backups[i].filename);
            }
        }
        catch (err) {
            console.error('Failed to clean old backups:', err);
        }
    }
    async downloadLatestBackup() {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        try {
            this.emit('progress', { type: 'restore', status: 'start', message: '正在获取备份列表...' });
            const items = await this.client.getDirectoryContents(`${this.backupPath}/`);
            const backups = items
                .filter((item) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a, b) => this.parseBackupTime(b) - this.parseBackupTime(a));
            if (backups.length === 0)
                return false;
            const latestBackup = backups[0];
            this.emit('progress', {
                type: 'restore',
                status: 'downloading',
                message: `正在下载备份: ${latestBackup.basename}`
            });
            const content = await this.client.getFileContents(latestBackup.filename);
            const zipPath = path_1.default.join(this.dataPath, 'temp-restore.zip');
            // 修复类型错误：使用 as any
            fs_1.default.writeFileSync(zipPath, content);
            this.emit('progress', {
                type: 'restore',
                status: 'extracting',
                message: '正在解压备份文件...'
            });
            await this.extractZip(zipPath, this.dataPath);
            fs_1.default.unlinkSync(zipPath);
            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: latestBackup.basename,
                status: 'success',
            });
            return true;
        }
        catch (err) {
            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: 'latest-backup',
                status: 'error',
                message: err.message,
            });
            return false;
        }
    }
    async extractZip(zipPath, targetPath) {
        await new Promise((resolve, reject) => {
            fs_1.default.createReadStream(zipPath)
                .pipe((0, unzipper_1.Extract)({ path: targetPath }))
                .on('close', () => resolve())
                .on('error', (err) => reject(err));
        });
    }
    async syncChangedFiles() {
        const { changed, deleted } = await this.getChangedFiles();
        if (changed.length === 0 && deleted.length === 0)
            return;
        if (changed.length > 0) {
            console.log(`Syncing ${changed.length} changed files to WebDAV...`);
            let failCount = 0;
            await this.runConcurrent(changed, 5, async (file) => {
                const ok = await this.uploadFile(file);
                if (!ok)
                    failCount++;
            });
            if (failCount > 0) {
                console.error(`[WebDAV] Sync changed files completed with ${failCount} errors out of ${changed.length} files.`);
            }
        }
        if (deleted.length > 0) {
            console.log(`Deleting ${deleted.length} remote files...`);
            for (const file of deleted) {
                await this.deleteRemoteFile(file);
            }
        }
    }
    async restoreFromRemote() {
        if (!this.client)
            await this.initClient();
        if (!this.client)
            return false;
        // 1. 尝试恢复散文件
        try {
            const items = await this.client.getDirectoryContents(`${this.syncPath}/`, { deep: true });
            const files = items.filter((item) => item.type === 'file');
            if (files.length > 0) {
                console.log(`Restoring ${files.length} files from WebDAV (${this.syncPath})...`);
                const total = files.length;
                let current = 0;
                let hasConfig = false;
                this.emit('progress', { type: 'restore', status: 'start', total, message: '开始从云端恢复数据...' });
                const remoteFileSet = new Set();
                for (const file of files) {
                    current++;
                    const relativePath = this.getRelativeRemotePath(file.filename);
                    if (relativePath === 'config.js')
                        hasConfig = true;
                    remoteFileSet.add(relativePath);
                    this.emit('progress', {
                        type: 'restore',
                        status: 'processing',
                        current,
                        total,
                        file: relativePath,
                        message: `正在恢复文件 (${current}/${total})`
                    });
                    await this.downloadFile(relativePath);
                }
                // 如果恢复的文件中没有 config.js，说明云端配置缺失，将当前内存配置（含环境变量）同步上去
                if (!hasConfig) {
                    console.log('Cloud config.js not found, saving current memory config and uploading...');
                    if (global.lx && global.lx.saveConfig) {
                        global.lx.saveConfig();
                    }
                    await this.uploadFile('config.js');
                }
                // 双向数据一致性补齐：检查本地是否存在但云端缺失的文件，自动补传至云端
                const localFiles = await this.scanFiles();
                const missingOnRemote = [];
                for (const relativePath of localFiles.keys()) {
                    if (!remoteFileSet.has(relativePath)) {
                        missingOnRemote.push(relativePath);
                    }
                }
                if (missingOnRemote.length > 0) {
                    console.log(`[WebDAV] Found ${missingOnRemote.length} local files missing on cloud, uploading missing files...`);
                    for (const file of missingOnRemote) {
                        await this.uploadFile(file);
                    }
                }
                this.emit('progress', { type: 'restore', status: 'finish', total, message: '数据恢复完成' });
                return true;
            }
        }
        catch (err) {
            // 忽略远程同步目录不存在的错误，继续尝试恢复备份
            console.log(`Scattered files not found at ${this.syncPath} or error, trying backup...`, err.message);
        }
        // 2. 尝试恢复备份
        try {
            console.log('Downloading latest backup...');
            this.emit('progress', { type: 'restore', status: 'start', message: '正在从云端下载备份...' });
            const result = await this.downloadLatestBackup();
            if (result) {
                // 检查解压后数据目录是否确实有了 config.js
                const targetConfigPath = global.lx?.configPath || path_1.default.join(this.dataPath, 'config.js');
                if (!fs_1.default.existsSync(targetConfigPath)) {
                    console.log('Backup restored but config.js is missing in data dir, saving current config and uploading...');
                    if (global.lx && global.lx.saveConfig) {
                        global.lx.saveConfig();
                    }
                    await this.uploadFile('config.js');
                }
                this.emit('progress', { type: 'restore', status: 'finish', message: '备份恢复完成' });
                return true;
            }
            else {
                // 如果未找到散文件也未找到备份，说明是第一次配置或云端为空
                // 主动全量上传本地所有文件到云端进行初始化（后台异步执行，不阻塞启动）
                console.log(`Cloud is empty, saving current config and uploading all files to initialize ${this.syncPath}...`);
                this.emit('progress', { type: 'restore', status: 'processing', message: '云端为空，正在后台同步本地全部数据到云端...' });
                // 保存当前内存中的配置（包含环境变量生效后的结果）到磁盘
                if (global.lx && global.lx.saveConfig) {
                    global.lx.saveConfig();
                }
                void this.syncAllFiles().then((res) => {
                    if (res) {
                        this.emit('progress', { type: 'restore', status: 'finish', message: '云端配置与全部数据初始化完成' });
                    }
                });
                return false;
            }
        }
        catch (err) {
            console.error('Failed to restore from remote:', err);
            this.emit('progress', { type: 'restore', status: 'error', message: '恢复失败: ' + err.message });
            return false;
        }
    }
    async testConnection() {
        // 检查配置是否完整
        if (!this.config.enable) {
            return {
                success: false,
                message: '请先在系统配置中启用 WebDAV 同步服务'
            };
        }
        if (!this.config.url || this.config.url.trim() === '') {
            return {
                success: false,
                message: '请先在系统配置中填写 WebDAV 服务器地址 (URL)'
            };
        }
        try {
            const initialized = await this.initClient();
            if (!initialized || !this.client) {
                return { success: false, message: 'WebDAV客户端初始化失败，请检查配置是否正确' };
            }
            // 增加 10 秒超时控制，避免请求无限挂起
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('连接超时，请检查 WebDAV 地址及网络连接')), 10000));
            await Promise.race([
                this.client.getDirectoryContents('/'),
                timeoutPromise
            ]);
            return { success: true, message: '连接成功！WebDAV配置正确' };
        }
        catch (err) {
            let errorMsg = '连接失败';
            if (err.message) {
                if (err.message.includes('401')) {
                    errorMsg = '认证失败，请检查用户名和密码';
                }
                else if (err.message.includes('404')) {
                    errorMsg = 'WebDAV路径不存在，请检查URL';
                }
                else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
                    errorMsg = '无法连接到服务器，请检查URL和网络';
                }
                else {
                    errorMsg = err.message;
                }
            }
            return { success: false, message: errorMsg };
        }
    }
    startAutoSync() {
        if (!this.isConfigured())
            return;
        // 避免重复启动定时器
        this.stopAutoSync();
        console.log('Starting auto file change detection...');
        // 初始化文件哈希
        void this.scanFiles().then(files => {
            this.filesHash = files;
        });
        // 按配置的时间间隔检查增量文件变化
        this.watchTimer = setInterval(() => {
            void this.syncChangedFiles();
        }, this.syncInterval);
        // 每24小时创建备份（如果有变化）
        this.backupTimer = setInterval(() => {
            void this.uploadBackup();
        }, this.backupInterval);
    }
    stopAutoSync() {
        if (this.watchTimer) {
            clearInterval(this.watchTimer);
            this.watchTimer = null;
        }
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
        }
        console.log('Auto sync stopped');
    }
    updateConfig(config) {
        let changed = false;
        if (config.enable !== undefined && config.enable !== this.config.enable) {
            this.config.enable = config.enable;
            changed = true;
        }
        if (config.url !== undefined && config.url !== this.config.url) {
            this.config.url = config.url;
            changed = true;
        }
        if (config.username !== undefined && config.username !== this.config.username) {
            this.config.username = config.username;
            changed = true;
        }
        if (config.password !== undefined && config.password !== this.config.password) {
            this.config.password = config.password;
            changed = true;
        }
        if (config.syncPath !== undefined) {
            const newSyncPath = normalizeRemotePath(config.syncPath, '/lx-sync');
            if (newSyncPath !== this.syncPath) {
                this.syncPath = newSyncPath;
                this.config.syncPath = newSyncPath;
                changed = true;
            }
        }
        if (config.backupPath !== undefined) {
            const newBackupPath = normalizeRemotePath(config.backupPath, '/lx-sync-backups');
            if (newBackupPath !== this.backupPath) {
                this.backupPath = newBackupPath;
                this.config.backupPath = newBackupPath;
                changed = true;
            }
        }
        if (config.interval !== undefined && (config.interval * 60 * 1000) !== this.syncInterval) {
            this.syncInterval = config.interval * 60 * 1000;
            changed = true;
        }
        if (config.backupInterval !== undefined && (config.backupInterval * 60 * 60 * 1000) !== this.backupInterval) {
            this.backupInterval = config.backupInterval * 60 * 60 * 1000;
            changed = true;
        }
        if (changed) {
            this.client = null;
            this.ensuredDirs.clear();
            this.stopAutoSync();
            if (this.isConfigured()) {
                void this.initClient(true).then(() => {
                    this.startAutoSync();
                });
            }
        }
    }
}
exports.default = WebDAVSync;
