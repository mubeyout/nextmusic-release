// sourceConnectors.js —— 公共曲库多源连接器(v2.2 修正③:公共曲库=本地目录/WebDAV/OpenList 三型)
// · WebDAV:用仓内已有依赖 webdav(npm v5,PROPFIND/auth/解析全托管;仓内确有依赖故不裸写 PROPFIND)
//   —— 探测结论(2026-09-27 mock 验证):filename 相对 client 基址、etag/lastmod/size 均可取
// · OpenList(AList v3 兼容 API):原生 fetch,POST /api/fs/list|/api/fs/get,Authorization 头直传 token
// · 远程源索引落盘:<dataPath>/public_sources/<id>.json({savedAt,items:{relPath:item}}),内存缓存对齐 customIndexManager 习惯
// · 增量:PROPFIND/fs-list 自带 etag+lastmodified+size → 与旧索引逐文件比对(etag 优先,退化 size+mtime),
//   未变沿用旧 item(含解析出的歌名/歌手),变化重建,消失删除——大库秒级而非全量重解析
// · 远程元数据口径:列表级(文件名启发式解析歌名/歌手/专辑,与 customMusicManager 同规则;
//   不远端拉 ID3——需下载整文件,成本不可接受;duration 留空,quality 按扩展名)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("webdav");

const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape'];
const md5 = (s) => crypto.createHash("md5").update(String(s)).digest("hex");
const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const isAudio = (name) => AUDIO_EXTS.includes(extOf(name));
const joinPosix = (...segs) => {
    const joined = segs.filter(s => s !== undefined && s !== null && s !== '').map(s => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
    return '/' + joined;
};
const FETCH_TIMEOUT_MS = 20000; // 单请求超时(测试连接/列目录);同步整体由调用方作业化
const withTimeout = (p, ms = FETCH_TIMEOUT_MS) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`连接超时(${ms / 1000}s)`)), ms)),
]);

// ── 文件名启发式解析(规则与 customMusicManager.syncCustomIndex 完全一致,保证同名文件本地/远程解析同构) ──
function parseSongFromBasename(basename) {
    let songName = '', singer = '', album = '';
    if (basename.includes('_-_')) {
        const segs = basename.split('_-_');
        if (segs.length >= 4) { songName = segs[0]; singer = segs[1]; }
    } else if (basename.includes(' - ')) {
        const segs = basename.split(' - ');
        if (segs.length >= 2) { songName = segs[0]; singer = segs[1]; album = segs.slice(3).join(' - '); }
    }
    return { songName, singer, album };
}
function qualityOfExt(ext) {
    const e = String(ext || '').replace('.', '').toLowerCase();
    if (e === 'flac') return 'flac';
    if (e === 'wav' || e === 'ape') return '无损';
    if (e === 'mp3') return '128k';
    return e || '128k';
}
/** 由远端文件 stat 构造歌曲 item(字段口径对齐 custom_index 条目,libraryAgg 直接可聚合) */
function buildRemoteItem(sourceId, sourceType, relPath, { size, mtimeMs, etag }) {
    const ext = extOf(relPath);
    const base = path.basename(relPath, ext);
    const { songName, singer, album } = parseSongFromBasename(base);
    const id = 'r_' + md5(sourceId + '|' + relPath);
    const sub = path.posix.dirname(relPath).replace(/^\//, '');
    return {
        id, songmid: id,
        name: songName || base,
        singer: singer || '未知歌手',
        album,
        interval: '', // 列表级元数据无时长(不下载远端文件读 ID3)
        quality: qualityOfExt(ext),
        filename: relPath.replace(/^\/+/, ''), // 源内相对路径(posix,与本地源 subPath 口径一致)
        folder: sourceType,
        subPath: sub === '.' ? '' : sub,
        source: sourceType,
        mtime: mtimeMs || 0,
        size: size || 0,
        ext: ext.replace('.', ''),
        hasCover: false, // 远程不解析嵌入图(P1:代理端点可后补)
        hasLyric: false,
        etag: etag || '',
    };
}

// ── 远程索引存储(dataPath/public_sources/<id>.json;内存缓存,聚合热路径不读盘) ──
const indexCache = new Map(); // id -> Map(relPath -> item)
function indexDir() {
    const dp = global.lx && global.lx.dataPath;
    if (!dp) return null;
    const dir = path.join(dp, 'public_sources');
    try { fs.mkdirSync(dir, { recursive: true }); return dir; }
    catch { return null; }
}
function indexFilePath(id) {
    const dir = indexDir();
    return dir ? path.join(dir, `${id}.json`) : null;
}
function loadIndexMap(id) {
    if (indexCache.has(id)) return indexCache.get(id);
    const file = indexFilePath(id);
    const empty = new Map();
    if (!file || !fs.existsSync(file)) return empty;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const map = new Map(Object.entries((data && data.items) || {}));
        indexCache.set(id, map);
        return map;
    } catch (e) {
        console.error(`[sourceConnectors] loadIndex(${id}) failed:`, e.message);
        return empty;
    }
}
function saveIndexMap(id, map) {
    indexCache.set(id, map);
    const file = indexFilePath(id);
    if (!file) return false;
    try {
        fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), items: Object.fromEntries(map) }, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error(`[sourceConnectors] saveIndex(${id}) failed:`, e.message);
        return false;
    }
}
function deleteIndex(id) {
    indexCache.delete(id);
    const file = indexFilePath(id);
    try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { console.error(`[sourceConnectors] deleteIndex(${id}) failed:`, e.message); }
}

// ══════════════════════ WebDAV 连接器(webdav npm v5,仓内既有依赖) ══════════════════════
/** 基址合成:addr + rootPath(段级编码:仅含非 URL 安全字符才编码,避免二次编码已转义输入) */
function webdavBase(cfg) {
    const addr = String((cfg && cfg.addr) || '').trim();
    if (!/^https?:\/\//i.test(addr)) throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头');
    let base = addr.replace(/\/+$/, '');
    const rp = String((cfg && cfg.rootPath) || '').replace(/^\/+|\/+$/g, '');
    if (rp) {
        const safeSeg = (seg) => /[^A-Za-z0-9\-._~!$&'()*+,;=:@]/.test(seg) ? encodeURIComponent(seg) : seg;
        base += '/' + rp.split('/').filter(Boolean).map(safeSeg).join('/');
    }
    return base;
}
function webdavClient(cfg) {
    return createClient(webdavBase(cfg), {
        username: String((cfg && cfg.username) || ''),
        password: String((cfg && cfg.password) || ''),
    });
}
function humanizeWebdavError(e) {
    const status = e && (e.status || e.responseStatus || (e.response && e.response.status));
    const msg = String((e && e.message) || e || '');
    if (status === 401 || status === 403) return `认证失败(${status}):账号或密码错误`;
    if (status === 404) return '根路径不存在(404):请检查地址与根路径';
    if (status === 405) return '服务器不支持 WebDAV(405)';
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|timeout/i.test(msg)) return `无法连接服务器:${msg.slice(0, 120)}`;
    return msg.slice(0, 200) || 'WebDAV 连接失败';
}
/** 测试连接:PROPFIND Depth 1 列根目录,统计音频文件数(估算口径,同 spec「预计 N 首」) */
async function testWebdav(cfg) {
    try {
        const client = webdavClient(cfg);
        const contents = await withTimeout(client.getDirectoryContents('/'), 15000);
        const audioCount = contents.filter(f => f && f.type === 'file' && isAudio(f.basename)).length;
        if (audioCount === 0) return { ok: false, error: '已连接,但根目录第一层未发现音频文件(检查根路径)' };
        return { ok: true, audioCount, message: `已连接 · 预计 ${audioCount.toLocaleString()}+ 首` };
    } catch (e) {
        return { ok: false, error: humanizeWebdavError(e) };
    }
}
/** 扫描:深度递归列目录(depth infinity PROPFIND)拉音频文件 → 增量比对旧索引 */
async function syncWebdav(source) {
    const cfg = source.config || {};
    const client = webdavClient(cfg);
    const contents = await withTimeout(client.getDirectoryContents('/', { deep: true }), 120000);
    const prev = loadIndexMap(source.id);
    const next = new Map();
    let changed = 0;
    for (const f of contents) {
        if (!f || f.type !== 'file' || !isAudio(f.basename)) continue;
        const relPath = String(f.filename || '').replace(/^\/+/, '');
        if (!relPath) continue;
        const etag = f.etag ? String(f.etag).replace(/^"|"$/g, '') : '';
        const mtimeMs = Date.parse(f.lastmod || '') || 0;
        const size = Number(f.size) || 0;
        const old = prev.get(relPath);
        // 增量:etag 可比则比 etag;否则 size+mtime(规格:「源侧 mtime/etag 对比能做则做」)
        const unchanged = old && (etag ? (old.etag && old.etag === etag) : (old.size === size && old.mtime === mtimeMs));
        if (unchanged) next.set(relPath, old);
        else { next.set(relPath, buildRemoteItem(source.id, 'webdav', relPath, { size, mtimeMs, etag })); changed++; }
    }
    const removed = prev.size - [...prev.keys()].filter(k => next.has(k)).length;
    return { map: next, changed, removed, total: next.size };
}
/** WebDAV 文件直链(代理流播用):基址 + 相对路径段级编码 */
function webdavFileUrl(cfg, relPath) {
    const base = webdavBase(cfg);
    const safeSeg = (seg) => /[^A-Za-z0-9\-._~!$&'()*+,;=:@]/.test(seg) ? encodeURIComponent(seg) : seg;
    return base + '/' + String(relPath || '').replace(/^\/+/, '').split('/').filter(Boolean).map(safeSeg).join('/');
}

// ══════════════════════ OpenList 连接器(AList v3 兼容 API,原生 fetch) ══════════════════════
function openlistAddr(cfg) {
    const addr = String((cfg && cfg.addr) || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(addr)) throw new Error('OpenList 实例地址必须以 http:// 或 https:// 开头');
    return addr;
}
async function openlistFetch(cfg, apiPath, body) {
    const res = await withTimeout(fetch(openlistAddr(cfg) + apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': String((cfg && cfg.token) || '') },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }));
    let j;
    try { j = await res.json(); }
    catch { throw new Error(`实例响应非 JSON(HTTP ${res.status}):确认地址指向 OpenList/AList 实例`); }
    if (j.code !== 200) throw new Error(`实例返回错误:${j.message || j.code}(token 无效或权限不足)`);
    return j.data || {};
}
/** 测试连接:fs/list 根目录(token 校验 + 可达性) */
async function testOpenlist(cfg) {
    try {
        const data = await openlistFetch(cfg, '/api/fs/list', { path: '/', page: 1, per_page: 0, refresh: false });
        const content = Array.isArray(data.content) ? data.content : [];
        return { ok: true, dirCount: content.filter(e => e.is_dir).length, message: `已连接 · 根目录 ${content.length} 项` };
    } catch (e) {
        return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
    }
}
/** 挂载目录树(管理端选择器):从 path 起 BFS 只取目录,depth 层(默认 2,防巨型实例全树拖垮) */
async function openlistTree(cfg, rootPath = '/', depth = 2) {
    const out = { path: joinPosix(rootPath) || '/', children: [] };
    const walk = async (dirPath, remain, node) => {
        if (remain <= 0) return;
        let data;
        try { data = await openlistFetch(cfg, '/api/fs/list', { path: dirPath, page: 1, per_page: 0, refresh: false }); }
        catch (e) { node.error = String((e && e.message) || e).slice(0, 120); return; }
        const content = Array.isArray(data.content) ? data.content : [];
        for (const e of content) {
            if (!e || !e.is_dir) continue;
            const child = { path: joinPosix(dirPath, e.name), name: e.name, children: [] };
            node.children.push(child);
            await walk(child.path, remain - 1, child);
        }
    };
    await walk(out.path, Math.max(1, Math.min(depth || 2, 4)), out);
    return out;
}
/** 扫描:BFS 递归 fs/list 勾选目录树,收集音频文件 → 增量比对(同 WebDAV 口径) */
async function syncOpenlist(source) {
    const cfg = source.config || {};
    const paths = Array.isArray(cfg.paths) && cfg.paths.length ? cfg.paths : ['/'];
    const files = [];
    const seenDirs = new Set();
    const queue = [...paths.map(p => joinPosix(p) || '/')];
    while (queue.length) {
        const dirPath = queue.shift();
        if (seenDirs.has(dirPath)) continue;
        seenDirs.add(dirPath);
        const data = await openlistFetch(cfg, '/api/fs/list', { path: dirPath, page: 1, per_page: 0, refresh: false });
        for (const e of (Array.isArray(data.content) ? data.content : [])) {
            if (!e || !e.name) continue;
            const full = joinPosix(dirPath, e.name);
            if (e.is_dir) queue.push(full);
            else if (isAudio(e.name)) files.push({ relPath: full, size: Number(e.size) || 0, mtimeMs: Date.parse(e.modified || '') || 0, etag: '' });
        }
    }
    const prev = loadIndexMap(source.id);
    const next = new Map();
    let changed = 0;
    for (const f of files) {
        const relPath = f.relPath.replace(/^\/+/, ''); // 源内相对路径(勾选目录前缀保留,流播直拼 OpenList path)
        const old = prev.get(relPath);
        // OpenList fs/list 无 etag → size+mtime 增量
        if (old && old.size === f.size && old.mtime === f.mtimeMs) next.set(relPath, old);
        else { next.set(relPath, buildRemoteItem(source.id, 'openlist', relPath, f)); changed++; }
    }
    const removed = prev.size - [...prev.keys()].filter(k => next.has(k)).length;
    return { map: next, changed, removed, total: next.size };
}
/** OpenList 文件真实直链(代理流播用):fs/get → raw_url(每次现取,签名直链可能过期) */
async function openlistRawUrl(cfg, relPath) {
    const data = await openlistFetch(cfg, '/api/fs/get', { path: joinPosix(relPath) });
    if (!data.raw_url) throw new Error('实例未返回 raw_url(检查存储驱动/签名设置)');
    return data.raw_url;
}

module.exports = {
    AUDIO_EXTS,
    parseSongFromBasename, buildRemoteItem,
    loadIndexMap, saveIndexMap, deleteIndex,
    testWebdav, syncWebdav, webdavFileUrl,
    testOpenlist, syncOpenlist, openlistTree, openlistRawUrl,
};
