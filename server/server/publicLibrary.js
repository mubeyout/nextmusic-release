// publicLibrary.js —— 公共曲库(多源聚合 v2.2)+ 云曲库配额(曲库体系 v2 服务端,决策见 NextMusic-design/docs/library-system-v2-decisions.md)
// 概念口径(v2 定稿):「公共曲库」吸收合并现有「共享库」(P2 0924 sharedLib),名词统一,不再出现"共享库"。
// [v2.2 修正③ 多源化] 公共曲库 = 多源聚合:本地目录 / WebDAV / OpenList 三型(源表见 DEFAULT_SOURCE);
//   · 单目录旧配置(v2.1)自动迁移为「本地目录源」——ensureLegacyMigrated 惰性幂等:
//     授权名单/个人开关/审计不动,目录原样继承(owner 仍=public_lib,custom_index.json 在目录内自动跟随),
//     旧 scan 摘要(songCount/lastSync)无损转为源的 songCount/lastSync;旧字段 pub.dir 只读保留
//   · 浏览聚合:libraryAgg.registerItems('public_multi', 多源合并条目) —— 本地源走 customIndexManager(owner 路由),
//     远程源走 sourceConnectors 落盘索引;歌曲行带 sourceId/sourceName(前端副行「家庭NAS · 叶惠美」标注)
//   · 同步:每源独立作业(syncJobs 防重入);增量=本地 mtime+size / WebDAV etag(退化 size+mtime) / OpenList size+mtime;
//     连接失败=源 status='error'+lastError(前端红点/浏览页隐藏该源,不报错)
//   · 调度:10min tick 扫描源表,syncHours>0 且到期(默认 WebDAV/OpenList 6h、本地手动)自动同步;管理端可手动触发
//   · 授权模型不变:授权的是「公共曲库」整体(authorizedUsers),非逐源
// 过渡设计(旧共享库):legacy sharedLibraries 只读共存 + migrateLegacy 一键迁移,语义同 v2.1。
// 云曲库配额:per-user 默认 10GB(可改),用量=用户云曲库(custom_music 目录)索引 size 求和。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { customIndexManager, getCustomMusicDir } = require("./customMusicManager");
const libraryAgg = require("./libraryAgg");
const connectors = require("./sourceConnectors");

const PUBLIC_OWNER = 'public_lib'; // customMusicManager owner 路由键(getCustomMusicDir 已泛化)
const LEGACY_PREFIX = 'shared_'; // 旧共享库 owner 键前缀(过渡期共存,customMusicManager 同样认)
const MULTI_KEY = 'public_multi'; // libraryAgg 多源合并聚合键(registerItems 注册外部条目供给器)
const SOURCE_TYPES = ['local', 'webdav', 'openlist'];
const SECRET_MASK = '******'; // 管理端列表/回显掩码(更新回传掩码值=保留原密文)
const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape'];
const md5 = (s) => crypto.createHash("md5").update(String(s)).digest("hex");

// ── 配置读写(走既有 saveConfig 通道:全量序列化 config.js) ──
const DEFAULT_PUBLIC = () => ({
    enabled: false,
    name: '公共曲库',
    dir: '', // [v2.1 遗留] 单目录字段——迁移后只读保留(旧端点/回滚兜底),新配置走 sources
    sources: [], // [v2.2] 多源源表(见 normalizeSource)
    authorizedUsers: [], // 被授权账号(完全可见;授权的是曲库整体,非逐源)
    userPrefs: {}, // username -> { showEntry: bool } 账号设置"显示公共曲库"个人开关(默认开,仅影响自己入口)
    scan: { syncedAt: 0, songs: 0, albums: 0, artists: 0, totalBytes: 0 }, // 合并摘要(全源聚合,旧 UI/summary 兼容)
    migratedFrom: [], // 已吸收的旧共享库 id(迁移审计)
});
const DEFAULT_CLOUD = () => ({
    enableQuota: true, // 决策 5:每用户配额默认 10GB(后台可改)
    defaultQuotaMB: 10240,
    userQuotaMB: {}, // username -> MB 覆盖(null/删除=回落默认)
    disabledUsers: {}, // [v3.0 ⑧ 账号管理] username -> true 禁用云曲库(云端只读,上传链路拒传)
    userFormats: {}, // [v3.0 ⑧ 账号管理] username -> ['flac','mp3'] 上传格式白名单(缺省=不限制)
    auditLog: [], // [v3.0 ⑧ 账号管理] 操作留痕(账号面板变更记录,封顶 300 条)
});

/** 源对象规范化(三型分型字段收敛;未知字段丢弃防配置膨胀) */
function normalizeSource(s) {
    if (!s || !SOURCE_TYPES.includes(s.type)) return null;
    const src = {
        id: String(s.id || '').slice(0, 64) || 'src_' + md5(String(Date.now()) + Math.random()).slice(0, 10),
        type: s.type,
        name: String(s.name || '').slice(0, 32) || ({ local: '本地目录', webdav: 'WebDAV', openlist: 'OpenList' })[s.type],
        enabled: s.enabled !== false,
        status: ['ok', 'error', 'scanning', 'idle'].includes(s.status) ? s.status : 'idle',
        lastSync: Number(s.lastSync) || 0,
        lastError: s.lastError ? String(s.lastError).slice(0, 500) : null,
        songCount: Number(s.songCount) || 0,
        syncHours: Math.max(0, Math.min(Number(s.syncHours) || 0, 168)), // 0=仅手动;默认 webdav/openlist 6、local 0
        createdAt: Number(s.createdAt) || 0,
        config: {},
    };
    const c = (s.config && typeof s.config === 'object') ? s.config : {};
    if (s.type === 'local') {
        src.config = { dir: String(c.dir || '') };
        src.owner = String(s.owner || '').startsWith('pubsrc_') ? String(s.owner) : PUBLIC_OWNER; // 迁移源保持 public_lib(索引/内存身份无损);新源=pubsrc_<id>
    } else if (s.type === 'webdav') {
        src.config = {
            addr: String(c.addr || '').slice(0, 512),
            username: String(c.username || '').slice(0, 128),
            password: String(c.password || '').slice(0, 256),
            rootPath: String(c.rootPath || '').slice(0, 512),
        };
    } else if (s.type === 'openlist') {
        src.config = {
            addr: String(c.addr || '').slice(0, 512),
            token: String(c.token || '').slice(0, 512),
            paths: Array.isArray(c.paths) ? c.paths.map(p => String(p).slice(0, 512)).filter(Boolean).slice(0, 32) : [],
        };
    }
    if (s.migrated) src.migrated = true;
    return src;
}

function readConfig() {
    const cfg = global.lx.config.publicLibrary;
    const pub = { ...DEFAULT_PUBLIC(), ...(Array.isArray(cfg) ? {} : (cfg || {})) };
    pub.sources = (Array.isArray(pub.sources) ? pub.sources : []).map(normalizeSource).filter(Boolean);
    ensureLegacyMigrated(pub); // 惰性幂等:单目录旧配置 → 本地目录源(无损)
    return pub;
}
function readCloudConfig() {
    return { ...DEFAULT_CLOUD(), ...(global.lx.config.cloudLibrary || {}) };
}
function saveConfig(pub) {
    global.lx.config.publicLibrary = pub;
    if (typeof global.lx?.saveConfig === 'function')
        global.lx.saveConfig();
    else
        console.error('[publicLibrary] saveConfig unavailable');
}
function saveCloudConfig(cloud) {
    global.lx.config.cloudLibrary = cloud;
    if (typeof global.lx?.saveConfig === 'function')
        global.lx.saveConfig();
    else
        console.error('[publicLibrary] saveConfig unavailable (cloudLibrary)');
}

// ── 单目录→多源无损迁移(v2.1 → v2.2,惰性幂等) ──
// 条件:pub.dir 已设 && 源表里还没有"该目录"的本地源。动作:补一个 owner=public_lib 的本地源——
//   · 目录原样继承:custom_index.json 在目录内,customIndexManager.getAll('public_lib') 直接复用(不重扫不重建)
//   · 扫描状态无损:旧 pub.scan.songs/syncedAt → 源 songCount/lastSync;授权/审计字段原样
//   · pub.dir 保留不删:旧单目录端点(GET 总览 dir/dirValid、config 换目录、lib=public 无 src 流播)照常
function ensureLegacyMigrated(pub) {
    if (!pub.dir) return false;
    if (pub.sources.some(s => s.type === 'local' && s.config.dir === pub.dir)) return false;
    const src = normalizeSource({
        id: 'src_' + md5('legacy:' + pub.dir).slice(0, 10),
        type: 'local',
        name: pub.name && pub.name !== '公共曲库' ? pub.name : '本地目录',
        enabled: true,
        status: pub.scan && pub.scan.syncedAt ? 'ok' : 'idle',
        lastSync: (pub.scan && pub.scan.syncedAt) || 0,
        songCount: (pub.scan && pub.scan.songs) || 0,
        syncHours: 0, // 本地目录默认手动(同 v2.1 行为)
        createdAt: Date.now(),
        config: { dir: pub.dir },
        owner: PUBLIC_OWNER, // 关键:沿用旧 owner,索引与内存身份零迁移成本
        migrated: true,
    });
    pub.sources.push(src);
    saveConfig(pub);
    console.log(`[publicLibrary] legacy single-dir migrated to local source ${src.id} (dir preserved, scan state inherited: ${src.songCount} songs @${src.lastSync})`);
    return true;
}

// ── 旧共享库(过渡共存) ──
function readLegacyLibs() {
    return Array.isArray(global.lx.config.sharedLibraries) ? global.lx.config.sharedLibraries : [];
}

// ── 目录校验:绝对路径 + 存在 + 目录 + 可读 + 音频探测(快速浅扫证明"能扫出歌",不做全量 ID3) ──
function probeAudio(dir, cap = 200, depth = 3) {
    let count = 0;
    const walk = (d, dep) => {
        if (count >= cap || dep > depth) return;
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (count >= cap) return;
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, dep + 1);
            else if (e.isFile() && AUDIO_EXTS.includes(path.extname(e.name).toLowerCase())) count++;
        }
    };
    walk(dir, 0);
    return count;
}
function validateDir(dir) {
    if (!dir || typeof dir !== 'string' || !path.isAbsolute(dir))
        return { ok: false, error: '目录必须是服务器绝对路径' };
    let st;
    try { st = fs.statSync(dir); }
    catch { return { ok: false, error: '目录不存在' }; }
    if (!st.isDirectory()) return { ok: false, error: '路径不是目录' };
    try { fs.accessSync(dir, fs.constants.R_OK); }
    catch { return { ok: false, error: '目录不可读(检查服务器文件权限)' }; }
    const audioCount = probeAudio(dir);
    if (audioCount === 0) return { ok: false, error: '目录可读但未探测到音频文件(mp3/flac/m4a/ogg/wav/ape)' };
    return { ok: true, audioCount };
}

function getDir() {
    const pub = readConfig();
    if (pub.dir) return pub.dir; // 旧字段优先(迁移源同目录)
    const primary = pub.sources.find(s => s.type === 'local');
    return primary ? primary.config.dir : null;
}

// ══════════════════ [v2.2 多源] 源 CRUD + 测试连接 ══════════════════
function maskConfig(type, cfg) {
    if (!cfg) return {};
    if (type === 'webdav') return { ...cfg, password: cfg.password ? SECRET_MASK : '' };
    if (type === 'openlist') return { ...cfg, token: cfg.token ? SECRET_MASK : '' };
    return { ...cfg };
}
/** 源对外输出(列表/详情;密文掩码;scanning=同步中) */
function sourceOut(s) {
    return {
        id: s.id, type: s.type, name: s.name,
        enabled: s.enabled, status: s.status,
        lastSync: s.lastSync, lastError: s.lastError,
        songCount: s.songCount, syncHours: s.syncHours,
        createdAt: s.createdAt, migrated: !!s.migrated,
        scanning: syncJobs.has(s.id),
        config: maskConfig(s.type, s.config),
    };
}
function listSources() {
    return readConfig().sources.map(sourceOut);
}
function getSource(id) {
    return readConfig().sources.find(s => s.id === id) || null;
}
/** 管理端输入配置清洗:掩码/缺省密文字段=沿用存量(编辑场景) */
function mergeConfig(type, incoming, existing) {
    const inc = (incoming && typeof incoming === 'object') ? incoming : {};
    const base = existing ? existing.config : {};
    if (type === 'local') return { dir: String(inc.dir !== undefined ? inc.dir : base.dir || '') };
    if (type === 'webdav') {
        const password = (inc.password === undefined || inc.password === SECRET_MASK) ? (base.password || '') : String(inc.password);
        return {
            addr: String(inc.addr !== undefined ? inc.addr : base.addr || ''),
            username: String(inc.username !== undefined ? inc.username : base.username || ''),
            password,
            rootPath: String(inc.rootPath !== undefined ? inc.rootPath : base.rootPath || ''),
        };
    }
    const token = (inc.token === undefined || inc.token === SECRET_MASK) ? (base.token || '') : String(inc.token);
    return {
        addr: String(inc.addr !== undefined ? inc.addr : base.addr || ''),
        token,
        paths: Array.isArray(inc.paths) ? inc.paths.map(p => String(p)).filter(Boolean) : (base.paths || []),
    };
}
/** 测试连接(表单保存前/存量源体检):local=validateDir;webdav/openlist=真实探活 */
async function testSource({ id, type, config }) {
    let t = type, cfg = config;
    if (id) {
        const s = getSource(id);
        if (!s) throw new Error('曲源不存在');
        if (!t) t = s.type;
        cfg = mergeConfig(t, config || {}, s); // 掩码密文回填真实值
    }
    if (!SOURCE_TYPES.includes(t)) throw new Error('未知曲源类型');
    if (t === 'local') {
        const v = validateDir(cfg && cfg.dir);
        return v.ok ? { ok: true, type: t, audioCount: v.audioCount } : { ok: false, type: t, error: v.error };
    }
    if (t === 'webdav') return connectors.testWebdav(cfg);
    return connectors.testOpenlist(cfg);
}
/** 新增源:local=目录校验;webdav/openlist=真实连接测试(失败整单拒绝,防呆);成功后异步首同步 */
function addSource({ type, name, config, syncHours }) {
    if (!SOURCE_TYPES.includes(type)) throw new Error('曲源类型必须是 local/webdav/openlist');
    const defaultHours = type === 'local' ? 0 : 6; // OpenList 默认定时 6h(spec ④);WebDAV 同为远端同默认;本地手动
    const src = normalizeSource({
        id: 'src_' + md5(String(Date.now()) + Math.random()).slice(0, 10),
        type,
        name: String(name || '').slice(0, 32),
        enabled: true,
        status: 'idle',
        syncHours: syncHours === undefined ? defaultHours : Math.max(0, Math.min(Number(syncHours) || 0, 168)),
        createdAt: Date.now(),
        config: mergeConfig(type, config, null),
    });
    if (type === 'local') {
        src.owner = 'pubsrc_' + src.id; // 新本地源独立 owner(迁移源才用 public_lib)
        const v = validateDir(src.config.dir);
        if (!v.ok) throw new Error(`目录校验失败: ${v.error}`);
    } else if (type === 'webdav') {
        if (!src.config.addr) throw new Error('WebDAV 地址不能为空');
    } else if (type === 'openlist') {
        if (!src.config.addr) throw new Error('OpenList 实例地址不能为空');
        if (!src.config.token) throw new Error('Token 不能为空');
    }
    const pub = readConfig();
    pub.sources.push(src);
    saveConfig(pub);
    libraryAgg.invalidate(MULTI_KEY);
    recomputeSummary();
    // 远端源创建即异步首同步(测试连接通过后索引后台拉取,列表页轮询 songCount)
    if (type !== 'local') void syncSource(src.id).catch(() => { });
    return sourceOut(getSource(src.id));
}
/** 更新源(改名/改配置/启停/改周期):config 变更远端源→重测连接;配置变更→异步重同步 */
function updateSource(id, { name, config, enabled, syncHours }) {
    const pub = readConfig();
    const idx = pub.sources.findIndex(s => s.id === id);
    if (idx < 0) throw new Error('曲源不存在');
    const old = pub.sources[idx];
    const next = normalizeSource({ ...old, config: mergeConfig(old.type, config, old) });
    if (name !== undefined) next.name = String(name).slice(0, 32) || next.name;
    if (enabled !== undefined) next.enabled = !!enabled;
    if (syncHours !== undefined) next.syncHours = Math.max(0, Math.min(Number(syncHours) || 0, 168));
    const configChanged = JSON.stringify(next.config) !== JSON.stringify(old.config);
    if (configChanged && next.type === 'local') {
        const v = validateDir(next.config.dir);
        if (!v.ok) throw new Error(`目录校验失败: ${v.error}`);
    }
    pub.sources[idx] = next;
    saveConfig(pub);
    libraryAgg.invalidate(MULTI_KEY);
    recomputeSummary();
    if (configChanged) void syncSource(id).catch(() => { }); // 换目录/换地址→后台重同步
    return sourceOut(pub.sources[idx]);
}
/** 删除源:远程源连带删除落盘索引;本地源的 custom_index.json 在其目录内,原样保留(重新添加同目录即无损回归) */
function deleteSource(id) {
    const pub = readConfig();
    const idx = pub.sources.findIndex(s => s.id === id);
    if (idx < 0) throw new Error('曲源不存在');
    const [removed] = pub.sources.splice(idx, 1);
    if (removed.type !== 'local') connectors.deleteIndex(id);
    saveConfig(pub);
    libraryAgg.invalidate(MULTI_KEY);
    recomputeSummary();
    return { id, deleted: true };
}

// ══════════════════ [v2.2 多源] 同步作业(手动/定时/全量) ══════════════════
const syncJobs = new Map(); // sourceId -> Promise(防重入;同源并发请求复用同一作业)
const scanState = { running: false, startedAt: 0, lastError: null }; // 全库扫描态(旧 scan 端点兼容)

/** 单源同步:local=customMusicManager 增量扫描(mtime+size);remote=连接器增量(etag/size+mtime)。
 *  失败=源 status='error'+lastError(前端红点/浏览页隐藏该源),成功='ok'+lastSync+songCount 回填 */
function syncSource(id) {
    if (syncJobs.has(id)) return syncJobs.get(id);
    const pub = readConfig();
    const s = pub.sources.find(x => x.id === id);
    if (!s) return Promise.reject(new Error('曲源不存在'));
    if (!pub.enabled) return Promise.reject(new Error('公共曲库未启用'));
    if (!s.enabled) return Promise.reject(new Error('曲源已停用'));
    const job = (async () => {
        const p2 = readConfig();
        const cur = p2.sources.find(x => x.id === id);
        if (!cur) throw new Error('曲源不存在');
        cur.status = 'scanning';
        saveConfig(p2);
        try {
            let count = 0;
            if (cur.type === 'local') {
                const items = await require('./customMusicManager').syncCustomIndex(cur.owner);
                count = Array.isArray(items) ? items.length : 0;
            } else if (cur.type === 'webdav') {
                const r = await connectors.syncWebdav(cur);
                connectors.saveIndexMap(id, r.map);
                count = r.total;
            } else {
                const r = await connectors.syncOpenlist(cur);
                connectors.saveIndexMap(id, r.map);
                count = r.total;
            }
            const p3 = readConfig();
            const done = p3.sources.find(x => x.id === id);
            if (!done) throw new Error('曲源已被删除');
            done.status = 'ok';
            done.lastError = null;
            done.lastSync = Date.now();
            done.songCount = count;
            saveConfig(p3);
            libraryAgg.invalidate(MULTI_KEY);
            recomputeSummary();
            return sourceOut(done);
        } catch (e) {
            const msg = String((e && e.message) || e).slice(0, 500);
            const p4 = readConfig();
            const bad = p4.sources.find(x => x.id === id);
            if (bad) {
                bad.status = 'error';
                bad.lastError = msg;
                saveConfig(p4);
                libraryAgg.invalidate(MULTI_KEY);
                recomputeSummary();
            }
            console.error(`[publicLibrary] sync source ${id} failed:`, msg);
            throw e;
        }
    })().finally(() => syncJobs.delete(id));
    syncJobs.set(id, job);
    return job;
}

/** 全库扫描(旧 /scan 端点兼容):全部启用源并发同步,后台作业化立即返回 */
function startScan() {
    const pub = readConfig();
    const targets = pub.sources.filter(s => s.enabled);
    if (!pub.enabled || !targets.length) throw new Error('公共曲库未启用或未配置任何曲源');
    scanState.running = true;
    scanState.startedAt = Date.now();
    scanState.lastError = null;
    void (async () => {
        const rs = await Promise.allSettled(targets.map(s => syncSource(s.id)));
        const err = rs.find(r => r.status === 'rejected');
        if (err) scanState.lastError = String((err.reason && err.reason.message) || err.reason);
        scanState.running = false;
    })();
    return { running: true, startedAt: scanState.startedAt };
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 本地时区日键(今日新增卡片)
function scanStatus() {
    const pub = readConfig();
    return {
        running: scanState.running || syncJobs.size > 0,
        startedAt: scanState.startedAt,
        lastError: scanState.lastError,
        ...pub.scan,
        // [v2.2 管理页四卡] 今日新增=本日入库文件数(重扫/同步时随摘要落盘;跨日且未再同步=0)
        todayNew: pub.scan && pub.scan.todayDay === localDay() ? (pub.scan.todayNew || 0) : 0,
    };
}
/** 合并摘要回填旧 scan 字段(旧 UI/summary 兼容):songs=Σ源 songCount;专辑/歌手/占用=实时聚合 */
function recomputeSummary() {
    try {
        const pub = readConfig();
        const agg = libraryAgg.buildAgg(MULTI_KEY); // invalidate 后调用方保证新鲜
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        pub.scan = {
            syncedAt: pub.sources.reduce((m, s) => Math.max(m, s.lastSync || 0), 0),
            songs: pub.sources.reduce((n, s) => n + (s.songCount || 0), 0),
            albums: agg.albums.size,
            artists: agg.artists.size,
            totalBytes: agg.items.reduce((n, it) => n + (it.size || 0), 0),
            todayDay: localDay(),
            todayNew: agg.items.filter(it => (it.mtime || 0) >= midnight.getTime()).length,
        };
        saveConfig(pub);
    } catch (e) { console.error('[publicLibrary] recomputeSummary failed:', e.message); }
}

// ── [v2.2] 定时调度:10min tick;syncHours>0 且到期(lastSync 距今≥周期)自动同步 ──
const SCHEDULER_TICK_MS = 10 * 60 * 1000;
async function schedulerTick() {
    if (!global.lx || !global.lx.config) return; // 配置未就绪(index.js 装配前 tick)
    const pub = readConfig();
    if (!pub.enabled) return;
    const now = Date.now();
    for (const s of pub.sources) {
        if (!s.enabled || !s.syncHours || s.syncHours <= 0) continue;
        if (syncJobs.has(s.id)) continue;
        if (now - (s.lastSync || 0) >= s.syncHours * 3600 * 1000) {
            console.log(`[publicLibrary] scheduled sync for source ${s.id} (${s.name}, every ${s.syncHours}h)`);
            void syncSource(s.id).catch(() => { });
        }
    }
}
function initScheduler() {
    if (global.__publicLibScheduler) return;
    global.__publicLibScheduler = true;
    const t = setInterval(() => { void schedulerTick().catch(() => { }); }, SCHEDULER_TICK_MS);
    if (typeof t.unref === 'function') t.unref(); // 不阻止进程退出(冒烟/CLI 场景)
}
initScheduler();

// ══════════════════ [v2.2 多源] 浏览聚合(合并视图) ══════════════════
/** 参与聚合的源:启用 && 非 error(error=浏览页隐藏该源,spec §8:连接失败红点+隐藏不报错) */
function activeSources(pub) {
    const p = pub || readConfig();
    return p.sources.filter(s => s.enabled && s.status !== 'error');
}
/** 多源合并条目(本地源=custom_index 全量;远程源=连接器落盘索引;逐条附 sourceId/sourceName) */
function multiItems() {
    const out = [];
    for (const s of activeSources()) {
        try {
            let items;
            if (s.type === 'local') items = customIndexManager.getAll(s.owner);
            else items = Array.from(connectors.loadIndexMap(s.id).values());
            for (const it of items) out.push({ ...it, sourceId: s.id, sourceName: s.name });
        } catch (e) {
            console.error(`[publicLibrary] load items of source ${s.id} failed:`, e.message);
        }
    }
    return out;
}
libraryAgg.registerItems(MULTI_KEY, multiItems); // 聚合键注册(30s TTL 缓存,源变更处 invalidate)

const stats = () => libraryAgg.stats(MULTI_KEY);
const listArtists = (q) => libraryAgg.listArtists(MULTI_KEY, q);
const getArtist = (id) => libraryAgg.getArtist(MULTI_KEY, id);
const listAlbums = (q) => libraryAgg.listAlbums(MULTI_KEY, q);
const getAlbum = (id) => libraryAgg.getAlbum(MULTI_KEY, id);
const listSongs = (q) => libraryAgg.listSongs(MULTI_KEY, q);

// ── [v2.2] 流播路由:src=<sourceId> 参数(本地源→owner 路由;远程源→代理拉流) ──
function resolveSourceStream(srcId) {
    const s = readConfig().sources.find(x => x.id === srcId);
    if (!s || !s.enabled) return null;
    if (s.type === 'local') return { kind: 'local', owner: s.owner, source: s };
    return { kind: s.type, source: s };
}
/** 远程源代理流播:WebDAV 直链 / OpenList raw_url(现取,签名直链不过期缓存);Range 透传(206 分段) */
async function proxyRemoteStream(req, res, source, filename) {
    let upstreamUrl;
    if (source.type === 'webdav') {
        upstreamUrl = connectors.webdavFileUrl(source.config, filename);
    } else {
        upstreamUrl = await connectors.openlistRawUrl(source.config, filename);
    }
    const range = req.headers.range;
    const ac = new AbortController();
    req.on('close', () => { try { ac.abort(); } catch { } });
    const up = await fetch(upstreamUrl, {
        headers: range ? { Range: range } : {},
        redirect: 'follow',
        signal: ac.signal,
    });
    const headers = {};
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const v = up.headers.get(k);
        if (v) headers[k] = v;
    }
    res.writeHead(up.status, headers);
    if (!up.body || req.method === 'HEAD') { res.end(); return; }
    for await (const chunk of up.body) {
        if (res.destroyed || res.writableEnded) break;
        res.write(Buffer.from(chunk));
    }
    res.end();
}

// ── 授权(管理员勾选账号 ⇄ authorizedUsers;授权对象=曲库整体,与源无关) ──
function isAuthorized(username) {
    if (!username) return false;
    const pub = readConfig();
    const hasContent = pub.sources.length > 0 || !!pub.dir;
    return !!(pub.enabled && hasContent && Array.isArray(pub.authorizedUsers) && pub.authorizedUsers.includes(username));
}
function grant(username, granted) {
    const pub = readConfig();
    if (!Array.isArray(pub.authorizedUsers)) pub.authorizedUsers = [];
    const has = pub.authorizedUsers.includes(username);
    if (granted && !has) pub.authorizedUsers.push(username);
    if (!granted && has) pub.authorizedUsers = pub.authorizedUsers.filter(u => u !== username);
    saveConfig(pub);
    if (granted !== has) cloudAudit(username, granted ? 'publibGrant' : 'publibRevoke', granted ? '授予公共曲库' : '解除公共曲库授权'); // [v3.0 ⑧] 留痕
    return pub.authorizedUsers;
}
/** 后台勾选清单:全量账号 × 授权态(用户源=config.users) */
function listAccounts() {
    const pub = readConfig();
    const users = (global.lx.config.users || []).map(u => u.name);
    return users.map(name => ({ name, authorized: pub.authorizedUsers.includes(name) }));
}

// ── 个人开关(账号设置"显示公共曲库";仅授权账号可见该行——铁律) ──
function getUserPrefs(username) {
    const pub = readConfig();
    const p = pub.userPrefs && pub.userPrefs[username];
    return { showEntry: p ? p.showEntry !== false : true };
}
function setUserPrefs(username, prefs) {
    const pub = readConfig();
    if (!pub.userPrefs || typeof pub.userPrefs !== 'object') pub.userPrefs = {};
    const cur = pub.userPrefs[username] || {};
    pub.userPrefs[username] = { ...cur, ...(prefs || {}), showEntry: prefs && prefs.showEntry !== undefined ? !!prefs.showEntry : (cur.showEntry !== false) };
    saveConfig(pub);
    return { showEntry: pub.userPrefs[username].showEntry !== false };
}

// ── 旧共享库迁移(决策 1 吸收合并;旧配置只读不改,线上旧端点照常) ──
function listLegacy() {
    return readLegacyLibs()
        .filter(l => l && l.id && l.enabled !== false)
        .map(l => ({
            id: l.id, name: l.name || l.id, dir: l.dir, access: l.access || 'allow',
            allowCount: Array.isArray(l.allowList) ? l.allowList.length : 0,
            pendingRequests: Array.isArray(l.requests) ? l.requests.length : 0,
            songCountHint: l.songCountHint || 0,
        }));
}
function pendingRequests() {
    // 旧锁卡申请流吸收:未迁移旧库的待审批 → 管理员批准即授予公共曲库(v2 无自助申请,纯管理员勾选)
    const out = [];
    for (const l of readLegacyLibs()) {
        if (!l || l.enabled === false) continue;
        for (const r of (l.requests || [])) out.push({ lib: l.id, user: r.user, at: r.at });
    }
    return out;
}
function approveRequest(username) {
    grant(username, true);
    // 同步清掉旧库里的该申请(仅动 requests 字段,其余旧语义不动)
    const libs = readLegacyLibs();
    let touched = false;
    for (const l of libs) {
        if (Array.isArray(l.requests) && l.requests.some(r => r.user === username)) {
            l.requests = l.requests.filter(r => r.user !== username);
            touched = true;
        }
    }
    if (touched) {
        global.lx.config.sharedLibraries = libs;
        if (typeof global.lx?.saveConfig === 'function') global.lx.saveConfig();
    }
    return true;
}
/** 拒绝旧申请(不授予;仅从旧库 requests 清除)——管理页待审批行「拒绝」钮 */
function rejectRequest(username) {
    const libs = readLegacyLibs();
    let touched = false;
    for (const l of libs) {
        if (Array.isArray(l.requests) && l.requests.some(r => r.user === username)) {
            l.requests = l.requests.filter(r => r.user !== username);
            touched = true;
        }
    }
    if (touched) {
        global.lx.config.sharedLibraries = libs;
        if (typeof global.lx?.saveConfig === 'function') global.lx.saveConfig();
    }
    return true;
}
/** 把一个旧共享库吸收进公共曲库:目录转成一个「本地目录源」(索引 custom_index.json 在目录内,自动跟随);
 *  allowList 并入授权名单;未处理的 requests 转入待审批;旧配置保留(共存),仅记 migratedFrom 审计 */
async function migrateLegacy(libId) {
    const lib = readLegacyLibs().find(l => l.id === libId && l.enabled !== false);
    if (!lib) throw new Error('旧共享库不存在或未启用');
    const v = validateDir(lib.dir);
    if (!v.ok) throw new Error(`旧库目录不可用: ${v.error}`);
    const pub = readConfig();
    pub.enabled = true;
    if (lib.name && lib.name !== lib.id) pub.name = lib.name;
    if (!Array.isArray(pub.authorizedUsers)) pub.authorizedUsers = [];
    // access='public' 的旧库 = 当时全员可见 → 迁移为"当前全部账号授权"(v2 语义无公开库,只有账号授权)
    const addAuth = lib.access === 'public'
        ? (global.lx.config.users || []).map(u => u.name)
        : (Array.isArray(lib.allowList) ? lib.allowList : []);
    for (const u of addAuth) if (!pub.authorizedUsers.includes(u)) pub.authorizedUsers.push(u);
    // v2.2:旧库目录成为一个新的本地目录源(而非覆盖单目录字段;已有同目录源则复用不重建)
    let src = pub.sources.find(s => s.type === 'local' && s.config.dir === lib.dir);
    if (!src) {
        const legacySrcId = 'src_' + md5('legacy:' + lib.dir).slice(0, 10);
        src = normalizeSource({
            id: legacySrcId,
            type: 'local', name: lib.name || lib.id, enabled: true, status: 'idle',
            syncHours: 0, createdAt: Date.now(), config: { dir: lib.dir }, owner: 'pubsrc_' + legacySrcId,
        });
        pub.sources.push(src);
    }
    if (!pub.migratedFrom.includes(lib.id)) pub.migratedFrom.push(lib.id);
    saveConfig(pub);
    await syncSource(src.id); // 用旧库目录建索引(已有 custom_index.json 则秒级增量)
    return { id: lib.id, sourceId: src.id, dir: lib.dir, authorized: pub.authorizedUsers.length };
}

// ── 云曲库配额(云曲库=用户个人 custom_music 目录;用量=索引 size 求和,配额钩子对齐 cacheSizeLimit 模式) ──
function getUserUsageBytes(username) {
    if (!username || username === '_open' || username === 'default') return 0;
    try {
        const items = customIndexManager.getAll(username); // 无索引/未配置目录 → 空数组
        return items.reduce((n, it) => n + (it.size || 0), 0);
    }
    catch { return 0; }
}
function getUserQuotaBytes(username) {
    const cloud = readCloudConfig();
    if (!cloud.enableQuota) return Infinity;
    const mb = cloud.userQuotaMB && Number(cloud.userQuotaMB[username]) > 0 ? Number(cloud.userQuotaMB[username]) : cloud.defaultQuotaMB;
    return mb * 1024 * 1024;
}
function quotaInfo(username) {
    const cloud = readCloudConfig();
    const usedBytes = getUserUsageBytes(username);
    const quotaBytes = getUserQuotaBytes(username);
    const finite = quotaBytes !== Infinity;
    return {
        enabled: cloud.enableQuota,
        usedBytes,
        quotaBytes: finite ? quotaBytes : -1, // -1=不限(JSON 可序列化)
        quotaMB: finite ? Math.round(quotaBytes / 1024 / 1024) : -1,
        percent: finite ? Math.round((usedBytes / quotaBytes) * 100) : 0,
    };
}
/** 上传前配额校验(供上传端点调用):已用+新增 超限 → {ok:false,...} */
function checkQuota(username, addBytes) {
    const cloud = readCloudConfig();
    if (!cloud.enableQuota) return { ok: true };
    const used = getUserUsageBytes(username);
    const quota = getUserQuotaBytes(username);
    const ok = used + (addBytes || 0) <= quota;
    return { ok, usedBytes: used, quotaBytes: quota, wouldExceed: !ok };
}
function setUserQuota(username, mb) {
    const cloud = readCloudConfig();
    if (!cloud.userQuotaMB || typeof cloud.userQuotaMB !== 'object') cloud.userQuotaMB = {};
    const prev = Number(cloud.userQuotaMB[username]) > 0 ? Number(cloud.userQuotaMB[username]) : cloud.defaultQuotaMB; // 生效值(覆盖或默认)
    if (mb === null || mb === undefined || mb === '' || Number(mb) <= 0) delete cloud.userQuotaMB[username];
    else cloud.userQuotaMB[username] = Math.max(1, Math.floor(Number(mb)));
    saveCloudConfig(cloud);
    const cleared = !(Number(cloud.userQuotaMB[username]) > 0);
    cloudAudit(username, 'quota', cleared ? `配额覆盖清除(回落默认 ${cloud.defaultQuotaMB} MB)` : `改配额 ${prev} → ${cloud.userQuotaMB[username]} MB`); // [v3.0 ⑧] 留痕
    return quotaInfo(username);
}
function setDefaultQuota(mb) {
    const cloud = readCloudConfig();
    const n = Math.max(1, Math.floor(Number(mb) || 10240));
    cloud.defaultQuotaMB = n;
    saveCloudConfig(cloud);
    return { defaultQuotaMB: n };
}
function setQuotaEnabled(enabled) {
    const cloud = readCloudConfig();
    cloud.enableQuota = !!enabled;
    saveCloudConfig(cloud);
    return { enableQuota: cloud.enableQuota };
}

/* ── [v3.0 ⑧ 账号管理] 云曲库禁用 / 上传格式白名单 / 操作留痕 ── */
function isCloudDisabled(username) {
    const cloud = readCloudConfig();
    return !!(username && cloud.disabledUsers && cloud.disabledUsers[username] === true);
}
function setUserCloudDisabled(username, disabled) {
    if (!username || username === '_open' || username === 'default') throw new Error('账号无效');
    if (!(global.lx.config.users || []).some(u => u.name === username)) throw new Error('账号不存在');
    const cloud = readCloudConfig();
    if (!cloud.disabledUsers || typeof cloud.disabledUsers !== 'object') cloud.disabledUsers = {};
    if (disabled) cloud.disabledUsers[username] = true;
    else delete cloud.disabledUsers[username];
    saveCloudConfig(cloud);
    cloudAudit(username, disabled ? 'cloudDisabled' : 'cloudEnabled', disabled ? '禁用云曲库(云端只读·拒传)' : '解除云曲库禁用');
    return { username, cloudDisabled: !!disabled };
}
function getUserFormats(username) {
    const cloud = readCloudConfig();
    const list = cloud.userFormats && cloud.userFormats[username];
    return Array.isArray(list) && list.length ? list.map(String) : null; // null=不限制(默认全允许)
}
function setUserFormats(username, formats) {
    if (!username || username === '_open' || username === 'default') throw new Error('账号无效');
    if (!(global.lx.config.users || []).some(u => u.name === username)) throw new Error('账号不存在');
    const cloud = readCloudConfig();
    if (!cloud.userFormats || typeof cloud.userFormats !== 'object') cloud.userFormats = {};
    if (formats === null || formats === undefined) delete cloud.userFormats[username];
    else {
        // 规范化:小写/去点/仅保留已知音频扩展名;空白名单=不限制
        const list = [...new Set((Array.isArray(formats) ? formats : String(formats).split(','))
            .map(f => String(f).trim().toLowerCase().replace(/^\./, ''))
            .filter(f => AUDIO_EXTS.includes('.' + f)))];
        if (!list.length) delete cloud.userFormats[username];
        else cloud.userFormats[username] = list;
    }
    saveCloudConfig(cloud);
    const cur = getUserFormats(username);
    cloudAudit(username, 'cloudFormats', cur ? `上传格式白名单=${cur.join('/')}` : '上传格式白名单=不限制');
    return { username, cloudFormats: cur };
}
/** 上传链路格式校验(逐文件):白名单缺省=全允许;有白名单则扩展名必须在列 */
function isFormatAllowed(username, filename) {
    const allow = getUserFormats(username);
    if (!allow) return true;
    const ext = path.extname(String(filename || '')).toLowerCase().replace(/^\./, '');
    return allow.includes(ext);
}
/** 操作留痕:配额/授权/禁用/格式变更统一入 cloudLibrary.auditLog(新条目在前,封顶 300) */
function cloudAudit(username, action, detail) {
    const cloud = readCloudConfig();
    if (!Array.isArray(cloud.auditLog)) cloud.auditLog = [];
    cloud.auditLog.unshift({ at: Date.now(), by: 'admin', user: username, action, detail: String(detail || '').slice(0, 120) });
    if (cloud.auditLog.length > 300) cloud.auditLog.length = 300;
    saveCloudConfig(cloud);
}
function listUserAudit(username, limit = 6) {
    const cloud = readCloudConfig();
    return (Array.isArray(cloud.auditLog) ? cloud.auditLog : [])
        .filter(e => !username || e.user === username)
        .slice(0, limit);
}
/** [v2.2 管理页] 清理云曲库(二次确认后调用):删除该账号自定义音乐目录全部内容+重置索引,返回最新用量 */
function cleanupUserCloud(username) {
    if (!username || username === '_open' || username === 'default') throw new Error('账号无效');
    if (!(global.lx.config.users || []).some(u => u.name === username)) throw new Error('账号不存在');
    let removed = 0;
    const dir = getCustomMusicDir(username);
    if (dir) {
        const walk = (d) => {
            for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, ent.name);
                if (ent.isDirectory()) {
                    walk(p);
                    try { fs.rmdirSync(p); } catch { /* 非空/占用则留着 */ }
                } else {
                    try { fs.unlinkSync(p); removed++; } catch { /* 跳过 */ }
                }
            }
        };
        walk(dir);
    }
    try { customIndexManager.indexes.delete(username); } catch { /* 内存索引本就无 */ }
    try { libraryAgg.invalidate(username); } catch { /* 聚合缓存失效(云曲库歌曲可能入浏览聚合) */ }
    return { username, removedFiles: removed, ...quotaInfo(username) };
}
/** 后台用量总览:全账号 已用/上限 */
function listUserUsage() {
    return (global.lx.config.users || []).map(u => {
        const info = quotaInfo(u.name);
        return {
            username: u.name, usedBytes: info.usedBytes, quotaBytes: info.quotaBytes,
            quotaMB: info.quotaMB, percent: info.percent,
            disabled: isCloudDisabled(u.name), formats: getUserFormats(u.name) || [],
        };
    });
}

// ── 后台歌曲级管理:清单检索 / 删除 ──
/** 后台曲目清单:按曲源 + 关键词(歌名/歌手/专辑/文件名)检索,分页 */
function adminListSongs({ sourceId, keyword, page, pageSize } = {}) {
    let items = multiItems();
    if (sourceId) items = items.filter(x => x.sourceId === String(sourceId));
    if (keyword) {
        const k = String(keyword).toLowerCase();
        items = items.filter(x => [x.name, x.singer, x.album, x.filename]
            .some(v => String(v || '').toLowerCase().includes(k)));
    }
    const total = items.length;
    const size = Math.max(1, Math.min(Number(pageSize) || 50, 200));
    const p = Math.max(1, Number(page) || 1);
    const start = (p - 1) * size;
    const rows = items.slice(start, start + size).map(x => ({
        id: x.id, sourceId: x.sourceId, sourceName: x.sourceName,
        name: x.name, singer: x.singer, album: x.album,
        filename: x.filename, size: x.size || 0, ext: x.ext || '', mtime: x.mtime || 0,
    }));
    return { total, page: p, pageSize: size, items: rows };
}

/** 后台删除曲目:本地源删磁盘文件+索引;远端源仅移除索引条目(远端文件保留,下次同步回归) */
function adminRemoveSong({ sourceId, filename }) {
    const pub = readConfig();
    const s = pub.sources.find(x => x.id === String(sourceId));
    if (!s) throw new Error('曲源不存在');
    const fn = String(filename || '');
    if (!fn) throw new Error('缺少曲目文件名');
    if (s.type === 'local') {
        const owner = s.owner || PUBLIC_OWNER;
        const customMusicManager = require('./customMusicManager');
        const ok = customMusicManager.removeCustomFile(fn, owner);
        if (!ok) throw new Error('本地文件不存在或已删除');
    } else {
        const map = connectors.loadIndexMap(s.id);
        if (!map.has(fn)) throw new Error('索引中无此曲目');
        map.delete(fn);
        connectors.saveIndexMap(s.id, map);
    }
    libraryAgg.invalidate(MULTI_KEY);
    recomputeSummary();
    return { id: s.id, sourceName: s.name, filename: fn, remote: s.type !== 'local' };
}

// ── lib 参数 → 内容 owner 解析(流/封面端点 /api/music/custom/{file,cover}?lib= 用) ──
// public=公共曲库(未登录/未授权 404,完全看不见铁律);<旧共享库id>=过渡共存(沿用 403 锁卡语义供旧客户端);无 lib 由调用方走原逻辑(用户本人目录)
function resolveContentOwner(libParam, username) {
    if (!libParam) return { ok: false, code: 400, body: { success: false, message: 'missing lib' } };
    if (libParam === 'public') {
        if (!isAuthorized(username)) return { ok: false, code: 404, body: { success: false, message: 'Not Found' } };
        return { ok: true, owner: PUBLIC_OWNER };
    }
    const lib = readLegacyLibs().find(l => l && l.id === libParam && l.enabled !== false);
    if (!lib) return { ok: false, code: 404, body: { success: false, message: 'Not Found' } };
    if (lib.access === 'public') return { ok: true, owner: LEGACY_PREFIX + lib.id };
    const list = Array.isArray(lib.allowList) ? lib.allowList : [];
    if (username && list.includes(username)) return { ok: true, owner: LEGACY_PREFIX + lib.id };
    return {
        ok: false, code: 403, body: {
            success: false, message: '仅限授权成员',
            lock: { name: lib.name || lib.id, reason: '仅限授权成员', owner: lib.owner || '管理员', songCount: lib.songCountHint || 0 },
        },
    };
}

module.exports = {
    PUBLIC_OWNER, LEGACY_PREFIX, MULTI_KEY, SOURCE_TYPES, SECRET_MASK,
    readConfig, saveConfig, readCloudConfig,
    getDir, validateDir, probeAudio,
    ensureLegacyMigrated, normalizeSource,
    listSources, getSource, addSource, updateSource, deleteSource, testSource, sourceOut,
    syncSource, startScan, scanStatus, schedulerTick, initScheduler,
    activeSources, multiItems, adminListSongs, adminRemoveSong,
    resolveSourceStream, proxyRemoteStream,
    isAuthorized, grant, listAccounts,
    getUserPrefs, setUserPrefs,
    readLegacyLibs, listLegacy, pendingRequests, approveRequest, rejectRequest, migrateLegacy,
    resolveContentOwner,
    stats, listArtists, getArtist, listAlbums, getAlbum, listSongs,
    quotaInfo, checkQuota, getUserUsageBytes, getUserQuotaBytes,
    setUserQuota, setDefaultQuota, setQuotaEnabled, listUserUsage, cleanupUserCloud,
    isCloudDisabled, setUserCloudDisabled, getUserFormats, setUserFormats, isFormatAllowed, listUserAudit,
};
