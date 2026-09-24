// sharedLib.js —— 共享媒体库(P2 0924,MOMO 放行;命名口径:与 _open 公共音源/公共歌单严格区分)
// 模型:管理员把服务器某目录设为共享库(public|allow 白名单);ownerKey='shared_<libId>' 复用 customMusicManager 全链(目录解析已泛化)
// 授权语义:自托管全能力(管理员自由设);人数/商用约束在授权层(商业化 config 注入),不在本代码
// 家庭库=共享存储池:一份目录一份索引,allowList 只是"看得见"的名单(存储不按人头放大)
const fs = require("fs");
const path = require("path");
const node_path_1 = require("path");

const DEFAULTS = () => [];

function readLibs() {
    return Array.isArray(global.lx.config.sharedLibraries) ? global.lx.config.sharedLibraries : [];
}
function saveLibs(libs) {
    global.lx.config.sharedLibraries = libs;
    // 走既有 saveConfig 通道(index.js saveConfigToFile=全量序列化 config.js,后台设置同机制)
    if (typeof global.lx?.saveConfig === 'function')
        global.lx.saveConfig();
    else
        console.error('[sharedLib] saveConfig unavailable');
}

/** 权限解析:返回 {ok, ownerKey, lib} 或 {ok:false, code:404|403, reason, lock}
 * v1.2 spec⑪C:锁卡四字段 {name, reason, owner, songCount} 直渲染——lock 补 owner+精确 songCount */
function resolveAccess(libId, username) {
    const lib = readLibs().find(l => l.id === libId && l.enabled !== false);
    if (!lib) return { ok: false, code: 404, reason: '共享库不存在或未启用' };
    if (lib.access === 'public') return { ok: true, ownerKey: 'shared_' + lib.id, lib };
    if (lib.access === 'allow') {
        const list = Array.isArray(lib.allowList) ? lib.allowList : [];
        if (username && list.includes(username)) return { ok: true, ownerKey: 'shared_' + lib.id, lib };
        return {
            ok: false, code: 403, reason: `仅限授权成员`, lib,
            lock: { name: lib.name || lib.id, reason: '仅限授权成员', owner: lib.owner || '管理员', songCount: lib.songCountHint || 0 },
        };
    }
    return { ok: false, code: 403, reason: '未知的访问模式' };
}

/** v1.2 spec⑪C:申请访问——写入 lib.requests(admin 消息中心=admin 节列表带回) */
function requestAccess(libId, username) {
    const libs = readLibs();
    const lib = libs.find(l => l.id === libId && l.enabled !== false);
    if (!lib) return { ok: false, code: 404, reason: '共享库不存在' };
    if (!Array.isArray(lib.requests)) lib.requests = [];
    if (lib.requests.some(r => r.user === username)) return { ok: true, dup: true };
    lib.requests.push({ user: username, at: Date.now() });
    saveLibs(libs);
    return { ok: true };
}
/** admin 审批:一键加白名单(清掉该 request) */
function approve(libId, username) {
    const libs = readLibs();
    const lib = libs.find(l => l.id === libId);
    if (!lib) return false;
    if (!Array.isArray(lib.allowList)) lib.allowList = [];
    if (!lib.allowList.includes(username)) lib.allowList.push(username);
    lib.requests = (lib.requests || []).filter(r => r.user !== username);
    saveLibs(libs);
    return true;
}

/** 用户可见清单(锁态也要展示——锁卡是 spec ⑨ 的态) */
function listForUser(username) {
    return readLibs().filter(l => l.enabled !== false).map(l => {
        const canSee = l.access === 'public' || (l.access === 'allow' && username && (l.allowList || []).includes(username));
        return {
            id: l.id, name: l.name || l.id,
            access: l.access,
            locked: !canSee,
            songCountHint: l.songCountHint || 0, // 上次扫描回填的粗计数(锁态也展示"342 首")
            syncedAt: l.syncedAt || 0,
        };
    });
}

/** admin CRUD 校验 */
function validateLib(body) {
    const { id, name, dir, access, allowList } = body || {};
    if (!id || !/^[a-z0-9_-]{1,32}$/i.test(id)) return 'id 必填(≤32 位字母数字_-)';
    if (!dir || !path.isAbsolute(dir)) return 'dir 必填(服务器绝对路径)';
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 'dir 不存在或不是目录';
    if (access && !['public', 'allow'].includes(access)) return 'access 只能是 public|allow';
    if (access === 'allow' && !Array.isArray(allowList)) return 'allow 模式需 allowList 数组';
    return null;
}

module.exports = { readLibs, saveLibs, resolveAccess, listForUser, validateLib, requestAccess, approve, DEFAULTS };
