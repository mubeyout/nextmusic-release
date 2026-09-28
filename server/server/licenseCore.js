// licenseCore.js —— License/entitlement 底座(老板 0924 全案拍板,10 项按推荐;D1a 0928 四案进化)
// 形态:Ed25519 签名 entitlement;自托管=每实例独立密钥(首次启动生成,客户端 TOFU 锁定公钥)。
// 签名密钥永不轮换(运维红线:丢失=该实例全部 license 失效)。
// tier(D1a 定案): free/pro/family/m1_beta/trial——pro/family=买断 perpetual(无 exp 无续期,family seats≤6);
//   trial=限时(默认 7 天,Pro 全权益试用);m1_beta=内测全开。host/community 已废。
// payload v2(D1a): features 布尔节(五源 provider_* 恒真——A 案三类源全免费)+limits 数值节(与布尔分家,
//   library_connections 缺省/-1=不限——预留能力,A 案计数门控未启用,本期不接执法点)。
// D1a 两态语义已废(托管侧死):门控一律功能级;library_server 基础直通不入 gate 表(gate 价值转移至整理进阶,未来功能)。
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ── 密钥管理(实例级,永不轮换) ──
let keypair = null; // {publicKey, privateKey}(KeyObject)
function keyPath() {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data');
    return path.join(dataPath, 'license_ed25519.key');
}
function ensureKeys() {
    if (keypair)
        return keypair;
    const p = keyPath();
    try {
        const raw = fs.readFileSync(p, 'utf-8').trim();
        // 从私钥推导公钥(规范做法,公钥不落盘)
        const privateKey = crypto.createPrivateKey(raw);
        keypair = { privateKey, publicKey: crypto.createPublicKey(privateKey) };
        return keypair;
    }
    catch (e) { /* 无私钥 → 首次生成 */ }
    try {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, pem, { mode: 0o600 });
        console.log('[license] Ed25519 keypair generated (KEEP SAFE — 永不轮换,丢失=全部 license 失效)');
        keypair = { publicKey, privateKey };
        return keypair;
    }
    catch (e) {
        console.error('[license] key init failed:', e.message);
        return null;
    }
}
function publicKeyB64() {
    const k = ensureKeys();
    if (!k)
        return null;
    return k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// ── features 推导(门控口径 0924 定案;D1a 0928:library_server 出表+两态废+源类型检查移除) ──
// 客户端 Pro 候选 + 服务端门;基础播放/歌词/断点恢复永不入门(红线)
// canonical 源=NextMusic/shared/benefits.json 的 pro_features.id(MAX 0924 定稿,构建期注入客户端同读)——两套命名对齐于此,禁再分叉
// 免费层含自托管曲库(部署者权利);A 案:三类源全免费——五源(provider_*)不入 gate 表,payload 恒真;源类型检查已删
const TIER_FEATURES = {
    free: [], // 免费层=上游能力面+免费生态底座(benefits.free_forever;原 community 更名对齐 tier 枚举)
    pro: ['eq_custom', 'lyrics_deep', 'webdav_backup', 'offline_batch', 'progress_roam', 'tv_pack', 'carlink', 'theme_store'],
    family: ['share_group'], // = pro 全集+共享组(featuresFor 运行期并集;表内只列独有项,保 payload 键集完整)
    m1_beta: ['*'], // M1 内测:全开
    trial: [], // 由 pro 推导(Pro 试用,限时 exp)
};
// D1a:五源布尔(payload v2 features 节恒真——A 案源全免费,B 案再按 tier 翻转;不入 gate 表)
const PROVIDER_FEATURES = ['provider_emby', 'provider_plex', 'provider_audiostation', 'provider_feiniu', 'provider_daoliyu'];
// D1a:等价物引导表(客户端拦截提示用——免费/降级时的源替代建议)
const PRO_TYPE_ALTS = { emby: 'Jellyfin', plex: 'Jellyfin', audiostation: 'WebDAV', feiniu: 'WebDAV', daoliyu: 'Navidrome' };
// D1a:limits 节(数值型与布尔分家)——缺省/-1=不限;A 案计数门控未启用,预留能力不执法
const TIER_LIMITS = {
    free: { library_connections: 2 },
    trial: { library_connections: -1 },
    pro: { library_connections: -1 },
    family: { library_connections: -1 },
    m1_beta: { library_connections: -1 },
};
function tierLimits(tier) {
    return Object.assign({}, TIER_LIMITS[tier] || TIER_LIMITS.free);
}
function featuresFor(tier, extra) {
    const base = (tier === 'family' || tier === 'trial') ? [...TIER_FEATURES.pro] : [...(TIER_FEATURES[tier] || [])];
    if (tier === 'family')
        base.push('share_group');
    if (Array.isArray(extra))
        base.push(...extra);
    return base;
}
/** payload v2 features 布尔节:键集=gate 表并集∪传入数组('*' 展开)→布尔映射+五源恒真(A 案) */
function featuresPayloadMap(featureList) {
    const arr = Array.isArray(featureList) ? featureList : [];
    const all = arr.includes('*');
    const map = {};
    for (const f of new Set([...Object.values(TIER_FEATURES).flat(), ...arr]))
        if (f !== '*')
            map[f] = all || arr.includes(f);
    for (const p of PROVIDER_FEATURES)
        map[p] = true;
    return map;
}

// ── entitlement 签发/验证 ──
function canonicalJson(obj) {
    // 稳定序列化(键排序,数组保序)——签名双方必须字节一致
    if (obj === null || typeof obj !== 'object')
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return '[' + obj.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}
/** 签发(登录激活成功后调用):payload+Ed25519 签名 → {payload, sig, alg:'ed25519', serverPubkey} */
function signEntitlement(payload) {
    const k = ensureKeys();
    if (!k)
        throw new Error('license key unavailable');
    const body = canonicalJson(payload);
    const sig = crypto.sign(null, Buffer.from(body, 'utf-8'), k.privateKey);
    return { payload, sig: sig.toString('base64'), alg: 'ed25519', serverPubkey: publicKeyB64() };
}
/** 验证(客户端上报回服务器复核/调试用) */
function verifyEntitlement(ent) {
    try {
        const k = ensureKeys();
        const body = Buffer.from(canonicalJson(ent.payload), 'utf-8');
        return crypto.verify(null, body, k.publicKey, Buffer.from(ent.sig, 'base64'));
    }
    catch (e) {
        return false;
    }
}

// ── license 记录管理(data/licenses.json) ──
function storePath() {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data');
    return path.join(dataPath, 'licenses.json');
}
function readAll() {
    try {
        return JSON.parse(fs.readFileSync(storePath(), 'utf-8'));
    }
    catch (e) {
        return {};
    }
}
function writeAll(all) {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(all, null, 2));
}
/** 生成展示用 key: NM-XXXXX-XXXXX-XXXXX */
function newLicenseKey() {
    const seg = () => crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    return `NM-${seg()}-${seg()}-${seg()}`;
}
/** admin/发码流创建 license(D1a:family=买断 perpetual seats≤6;trial=限时默认 7 天;pro/m1_beta=perpetual 无续期) */
function createLicense({ tier, seats, maxDevices, features, limits, note, trialDays }) {
    const all = readAll();
    const key = newLicenseKey();
    const t = tier || 'pro';
    const days = Number(trialDays) || 7;
    all[key] = {
        key, tier: t,
        seats: t === 'family' ? Math.min(Number(seats) || 6, 6) : 1,
        maxDevices: Math.min(Number(maxDevices) || 5, 10),
        features: featuresFor(t, features),
        limits: limits || tierLimits(t),
        note: note || '',
        boundAccount: null, activatedAt: null,
        revoked: false, createdAt: Date.now(),
        exp: t === 'trial' ? Date.now() + days * 86400000 : null, // trial=限时;pro/family/m1_beta=perpetual(买断口径,无续期)
        devices: [],
    };
    writeAll(all);
    return all[key];
}
/** 激活:绑定账号+登记设备(超 maxDevices 拒新);返回 entitlement 签名包 */
function activate(key, account, installId, deviceName) {
    const all = readAll();
    const lic = all[key];
    if (!lic)
        return { ok: false, code: 404, reason: 'license 不存在' };
    if (lic.revoked)
        return { ok: false, code: 403, reason: 'license 已吊销' };
    if (lic.exp && Date.now() > lic.exp)
        return { ok: false, code: 403, reason: 'license 已过期' };
    if (lic.boundAccount && lic.boundAccount !== account)
        return { ok: false, code: 403, reason: `license 已绑定账号 ${lic.boundAccount}` };
    if (!lic.boundAccount) {
        lic.boundAccount = account;
        lic.activatedAt = Date.now();
    }
    // 设备登记(LRU:lastAt 刷新;超限拒新,用户可在 app/后台删设备)
    let dev = lic.devices.find(d => d.installId === installId);
    if (!dev) {
        if (lic.devices.length >= lic.maxDevices)
            return { ok: false, code: 403, reason: `设备数已达上限(${lic.maxDevices}),请先在设备管理移除旧设备` };
        dev = { installId, name: deviceName || '未命名设备', firstAt: Date.now() };
        lic.devices.push(dev);
    }
    dev.lastAt = Date.now();
    writeAll(all);
    const ent = signEntitlement({
        v: 2, key, tier: lic.tier, // D1a payload v2
        features: featuresPayloadMap(lic.features), // 布尔节(五源恒真——A 案源全免费)
        limits: lic.limits || tierLimits(lic.tier), // 数值节(缺省/-1=不限,本期不接执法点)
        seats: lic.seats,
        account, device: { installId, name: dev.name },
        iat: Date.now(), exp: lic.exp, // 永久=exp:null(随 license 吊销失效,复核用 revokedAt)
    });
    return { ok: true, ent };
}
/** 复核(客户端定期/离线宽限期过后重验):吊销/过期检查 */
function revalidate(key, account, installId) {
    const lic = readAll()[key];
    if (!lic || lic.revoked || (lic.exp && Date.now() > lic.exp))
        return { ok: false, reason: 'license 已失效' };
    if (lic.boundAccount !== account)
        return { ok: false, reason: 'license 与账号不匹配' };
    if (!lic.devices.some(d => d.installId === installId))
        return { ok: false, reason: '设备未登记' };
    return { ok: true };
}
function byAccount(account) {
    const all = readAll();
    return Object.values(all).filter(l => l.boundAccount === account && !l.revoked)
        .map(l => ({ key: l.key, tier: l.tier, seats: l.seats, features: l.features, limits: l.limits || tierLimits(l.tier), maxDevices: l.maxDevices, devices: l.devices, exp: l.exp, activatedAt: l.activatedAt }));
}
function removeDevice(key, installId) {
    const all = readAll();
    const lic = all[key];
    if (!lic)
        return false;
    const before = lic.devices.length;
    lic.devices = lic.devices.filter(d => d.installId !== installId);
    writeAll(all);
    return lic.devices.length < before;
}
function revoke(key) {
    const all = readAll();
    if (!all[key])
        return false;
    all[key].revoked = true;
    writeAll(all);
    return true;
}

/** 门控执行(D1a:两态语义已废,一律功能级;library_server 基础直通——gate 价值转移至整理进阶,未来功能) */
const UNGATED_FEATURES = new Set(['library_server']); // 直通行(免费/无 license 亦过)
function checkFeature(account, feature) {
    if (UNGATED_FEATURES.has(feature))
        return { ok: true };
    const lics = byAccount(account);
    if (lics.some(l => l.features.includes('*') || l.features.includes(feature)))
        return { ok: true };
    return { ok: false, reason: '此功能需要 Pro 授权', feature };
}

// ── D1a:签名码紧凑编解码(发码器产出/兑换验签同径;canonical 序列化与 signEntitlement 字节一致) ──
// 码格式: b64u(canonicalJson(payload)) + '.' + b64u(Ed25519 sig)
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function unb64u(s) { return Buffer.from(s, 'base64url'); }
/** 紧凑签发(发码器:外部私钥 KeyObject/PEM——vendor 钥,区别于实例钥) */
function signCompact(payload, privateKey) {
    const pk = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
    const body = canonicalJson(payload);
    return b64u(Buffer.from(body, 'utf-8')) + '.' + b64u(crypto.sign(null, Buffer.from(body, 'utf-8'), pk));
}
/** 紧凑验签(兑换/回读:公钥 KeyObject/PEM)→ payload|null */
function verifyCompact(code, publicKey) {
    try {
        const pub = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
        const parts = String(code).trim().split('.');
        if (parts.length !== 2 || !parts[0] || !parts[1])
            return null;
        if (!crypto.verify(null, unb64u(parts[0]), pub, unb64u(parts[1])))
            return null;
        return JSON.parse(unb64u(parts[0]).toString('utf-8'));
    }
    catch (e) {
        return null;
    }
}

module.exports = {
    publicKeyB64, signEntitlement, verifyEntitlement,
    createLicense, activate, revalidate, byAccount, removeDevice, revoke,
    checkFeature, featuresFor, readAll, newLicenseKey,
    PRO_TYPE_ALTS, PROVIDER_FEATURES, TIER_LIMITS, tierLimits, featuresPayloadMap,
    signCompact, verifyCompact,
};
