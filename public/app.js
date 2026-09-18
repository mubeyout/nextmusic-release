/*
 * NextMusic Server 控制台 v3.1
 * 深邃控制台 × 玻璃拟态 · 纯静态零依赖
 * API 面与 lxserver 2.0.1 管理台 100% 对齐
 */
'use strict';

const API_BASE = '';

function stringToColor(str) {
    if (!str) return 'var(--green)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
}

class App {
    constructor() {
        this.password = null;
        this.currentView = 'dashboard';
        this.users = [];
        this.allUsers = [];
        this.configLoaded = false;
        this.monitorTimer = null;
        this.currentLogType = 'app';
        this.cpuHistory = [];
        this.memHistory = [];
        this.usersHistory = [];
        this.devicesHistory = [];
        this.init();
        this.initVersion();
    }

    /* ================= 初始化 ================= */
    init() {
        const saved = localStorage.getItem('lx_auth');
        if (saved) {
            this.password = saved;
            this.showApp();
            this.loadConfig();
            this.loadDashboard();
        }

        document.getElementById('login-btn')?.addEventListener('click', () => this.login());
        document.getElementById('access-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = item.dataset.view;
                if (view === 'music') return; // 播放器链接直接跳转
                e.preventDefault();
                this.switchView(view);
                this.closeMobileSidebar();
            });
        });

        // 仪表盘快捷动作
        document.querySelectorAll('.q[data-qact]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.qact;
                if (act === 'add-user') { this.switchView('users'); setTimeout(() => this.showAddUserModal(), 120); }
                else if (act === 'snapshot') this.switchView('snapshots');
                else if (act === 'config') this.switchView('config');
                else if (act === 'logs') this.switchView('logs');
            });
        });
        document.getElementById('dash-sync-btn')?.addEventListener('click', async () => {
            try {
                const st = await this.request('/api/status');
                if (!st.isWebDAVConfigured) { showInfo('WebDAV 未配置，请先在设置中配置云端同步'); return; }
                this.switchView('webdav');
            } catch (e) { showError('获取状态失败'); }
        });
        document.getElementById('dash-snapshot-btn')?.addEventListener('click', () => this.switchView('snapshots'));
        document.getElementById('restart-server-btn')?.addEventListener('click', () => this.restartServer());
        document.getElementById('restart-server-config-btn')?.addEventListener('click', () => this.restartServer());

        // 用户管理
        document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddUserModal());
        document.getElementById('refresh-users-btn')?.addEventListener('click', async () => {
            try {
                await this.saveConfig(true);
                await this.request('/api/admin/reload', { method: 'POST' });
                this.loadUsers();
                this.loadDashboard();
                showSuccess('重载数据成功');
            } catch (err) { showError('重载数据失败: ' + err.message); }
        });
        document.getElementById('batch-delete-users-btn')?.addEventListener('click', () => this.batchDeleteUsers());
        document.getElementById('select-all-users')?.addEventListener('change', (e) => this.toggleAllUsers(e.target.checked));
        document.getElementById('user-search-input')?.addEventListener('input', () => this.filterUsers());
        document.getElementById('save-password-btn')?.addEventListener('click', () => this.saveNewPassword());
        document.getElementById('save-rename-user-btn')?.addEventListener('click', () => this.saveRenameUser());

        document.getElementById('user-custom-dir-enable-toggle')?.addEventListener('change', (e) => {
            const container = document.getElementById('user-custom-dir-container');
            if (e.target.checked) {
                container?.classList.remove('hidden');
                this.validateUserCustomDirState();
            } else {
                container?.classList.add('hidden');
                this.setUserConfigConfirmBtnState(true);
            }
        });
        document.getElementById('user-custom-dir-input')?.addEventListener('input', () => {
            this.setUserConfigConfirmBtnState(false);
            const statusEl = document.getElementById('user-custom-dir-status');
            if (statusEl) {
                statusEl.textContent = '目录路径已修改，请点击右侧「检测」验证可用性';
                statusEl.style.color = 'var(--muted)';
            }
        });
        document.getElementById('test-user-custom-dir-btn')?.addEventListener('click', () => this.testUserCustomDir());

        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('edit-password-modal')?.classList.add('hidden');
                document.getElementById('rename-user-modal')?.classList.add('hidden');
                document.getElementById('modal')?.classList.add('hidden');
            });
        });

        // 数据查看
        document.getElementById('refresh-data-btn')?.addEventListener('click', () => this.loadUserData());

        // 配置
        document.getElementById('config-form')?.addEventListener('submit', (e) => { e.preventDefault(); this.saveConfig(); });
        document.getElementById('reload-config-btn')?.addEventListener('click', async () => {
            await this.saveConfig(true);
            this.loadConfig();
        });
        document.getElementById('config-discard-btn')?.addEventListener('click', () => { this.loadConfig(); showInfo('已放弃未保存的更改'); });
        document.querySelector('input[name="user.enablePublicFavorites"]')?.addEventListener('change', () => this.togglePublicNonAdminAccessVisibility());
        document.querySelector('input[name="user.enablePublicRestriction"]')?.addEventListener('change', () => this.togglePublicNonAdminLocalMusicVisibility());

        // 日志
        document.getElementById('refresh-logs-btn')?.addEventListener('click', () => this.loadLogs());

        // 模态框
        document.getElementById('modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });

        // WebDAV / 文件
        this.bindWebDAVEvents();
        this.bindFileManagerEvents();

        // 快照上传
        document.getElementById('snapshot-upload-input')?.addEventListener('change', (e) => this.handleSnapshotUpload(e));
        document.getElementById('cs-refresh-btn')?.addEventListener('click', () => this.loadCsList());
        document.getElementById('cs-url-btn')?.addEventListener('click', () => this.csAddUrl());
        document.getElementById('cs-upload-btn')?.addEventListener('click', () => document.getElementById('cs-file-input')?.click());
        document.getElementById('cs-file-input')?.addEventListener('change', (e) => this.handleCsUpload(e));

        // PWA
        this.deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            document.getElementById('install-pwa-btn').style.display = 'inline-flex';
            document.getElementById('about-pwa-btn').style.display = 'inline-flex';
        });
        document.getElementById('install-pwa-btn')?.addEventListener('click', () => this.installPWA());
        document.getElementById('about-pwa-btn')?.addEventListener('click', () => this.installPWA());

        // 播放器入口
        document.getElementById('open-player-btn')?.addEventListener('click', () => this.openPlayer());
        document.getElementById('open-player-btn2')?.addEventListener('click', () => this.openPlayer());
        document.getElementById('open-fm-btn')?.addEventListener('click', () => { window.location.href = 'filemanager.html'; });

        // 下拉：点击外部关闭
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.usel')) {
                document.querySelectorAll('.usel-menu').forEach(m => m.classList.add('hidden'));
            }
        });

        this.initMobileEvents();
    }

    openPlayer() {
        window.location.href = (window.CONFIG && window.CONFIG['player.path']) || '/';
    }

    initMobileEvents() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const scrim = document.getElementById('mobile-sidebar-overlay');
        const sidebar = document.getElementById('sidebar');
        const toggle = () => {
            sidebar?.classList.toggle('open');
            const open = sidebar?.classList.contains('open');
            scrim?.classList.toggle('show', open);
        };
        menuBtn?.addEventListener('click', toggle);
        scrim?.addEventListener('click', toggle);
    }

    closeMobileSidebar() {
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('mobile-sidebar-overlay')?.classList.remove('show');
    }

    async installPWA() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        await this.deferredPrompt.userChoice;
        this.deferredPrompt = null;
        document.getElementById('install-pwa-btn').style.display = 'none';
        document.getElementById('about-pwa-btn').style.display = 'none';
    }

    /* ================= 登录 ================= */
    async login() {
        const password = document.getElementById('access-password').value;
        const errorEl = document.getElementById('login-error');
        if (!password) { errorEl.textContent = '请输入密码'; return; }
        try {
            const res = await this.request('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
            if (res.success) {
                this.password = password;
                localStorage.setItem('lx_auth', password);
                this.showApp();
                this.loadConfig();
                this.loadDashboard();
            } else {
                errorEl.textContent = '密码错误';
            }
        } catch (err) {
            errorEl.textContent = '登录失败，请重试';
        }
    }

    logout() {
        localStorage.removeItem('lx_auth');
        location.reload();
    }

    showApp() {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }

    /* ================= 视图切换 ================= */
    async switchView(viewName) {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('on', item.dataset.view === viewName));
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== `view-${viewName}`));
        this.currentView = viewName;
        window.scrollTo({ top: 0 });

        switch (viewName) {
            case 'dashboard': this.loadDashboard(); break;
            case 'users': this.loadUsers(); break;
            case 'data': this.loadUserData(); break;
            case 'config': this.loadConfig(); break;
            case 'logs': this.loadLogs(); break;
            case 'webdav':
                try {
                    const status = await this.request('/api/status');
                    this.checkWebDAVConfig(status.isWebDAVConfigured);
                    this.loadSyncLogs();
                } catch (e) { console.error('webdav status failed', e); }
                break;
            case 'sources': this.loadCsList(); break;
            case 'snapshots': this.loadSnapshots(); break;
            case 'about': this.loadAbout(); break;
            case 'files': this.loadFiles(this.currentPath || ''); break;
        }
    }

    ctab(btn) {
        document.querySelectorAll('.ctab').forEach(t => t.classList.remove('on'));
        btn.classList.add('on');
        document.querySelectorAll('.cpane').forEach(p => p.classList.remove('on'));
        document.getElementById(btn.dataset.t).classList.add('on');
    }

    /* ================= 仪表盘 ================= */
    async loadDashboard() {
        this.updateGreeting();
        try {
            const status = await this.request('/api/status');
            this.updateDashboard(status);

            this.allUsers = status.users != null ? null : this.allUsers; // 占位：users 从 /api/users 取
            const users = await this.request('/api/users');
            this.allUsers = users;
            this.renderUserMenu('data');
            this.renderUserMenu('snapshot');
            this.startMonitor();
        } catch (err) {
            console.error('Failed to load dashboard:', err);
        }
    }

    updateGreeting() {
        const hour = new Date().getHours();
        let greeting = '你好';
        if (hour < 6) greeting = '深夜好';
        else if (hour < 9) greeting = '早安';
        else if (hour < 12) greeting = '上午好';
        else if (hour < 14) greeting = '中午好';
        else if (hour < 18) greeting = '下午好';
        else if (hour < 22) greeting = '晚上好';
        document.getElementById('greeting-text').textContent = greeting + '，管理员';
        document.getElementById('dash-date')?.textContent ? null : null;
        const d = document.getElementById('dash-date');
        if (d) d.textContent = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    }

    startMonitor() {
        if (this.monitorTimer) return;
        this.monitorTimer = setInterval(async () => {
            if (this.currentView !== 'dashboard' || !this.password) {
                clearInterval(this.monitorTimer);
                this.monitorTimer = null;
                return;
            }
            try {
                const status = await this.request('/api/status');
                this.updateDashboard(status);
            } catch (e) { /* 静默重试 */ }
        }, 3000);
    }

    updateDashboard(status) {
        const sysCpu = parseFloat(status.cpuUsage) || 0;
        const procCpu = parseFloat(status.processCpuUsage) || 0;
        const sysMem = parseFloat(status.systemMemoryUsage) || 0;

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('stat-users', status.users);
        set('stat-devices', status.devices);
        set('stat-cpu', sysCpu.toFixed(0));
        set('stat-process-cpu', '/ ' + procCpu.toFixed(2) + '%');
        set('stat-memory-percent', sysMem.toFixed(0));
        set('stat-memory', this.formatFileSize(status.memory));
        set('stat-process-memory-percent', '进程 ' + (parseFloat(status.processMemoryUsage) || 0).toFixed(2) + '%');
        set('stat-uptime', this.formatUptime(status.uptime));
        set('dash-uptime', this.formatUptime(status.uptime));
        set('dash-summary', '');
        const sum = document.getElementById('dash-summary');
        if (sum) sum.innerHTML = `<b>${status.users}</b> 位用户 · <b>${status.devices}</b> 个同步连接`;
        const ci = document.getElementById('stat-cpu-info');
        if (ci && status.cpus) ci.textContent = `${status.cpus} 核 @ ${(status.cpuSpeed / 1000).toFixed(1)}GHz`;

        const sevCpu = document.getElementById('sev-cpu');
        if (sevCpu) sevCpu.className = 'sev' + (sysCpu > 80 ? ' err' : sysCpu > 50 ? ' warn' : '');
        const sevMem = document.getElementById('sev-mem');
        if (sevMem) sevMem.className = 'sev' + (sysMem > 85 ? ' err' : sysMem > 60 ? ' warn' : '');
        const fill = document.getElementById('membar-fill');
        if (fill) { fill.style.width = sysMem + '%'; fill.className = sysMem > 85 ? 'warn' : ''; }

        // 历史曲线
        this.cpuHistory.push(sysCpu);
        this.memHistory.push(sysMem);
        this.usersHistory.push(status.users);
        this.devicesHistory.push(status.devices);
        [this.cpuHistory, this.memHistory, this.usersHistory, this.devicesHistory].forEach(h => { if (h.length > 40) h.shift(); });

        this.renderSpark('spark-cpu', this.cpuHistory, '#1ED760');
        this.renderSpark('spark-devices', this.devicesHistory, '#4A90E2');
        this.renderUsersSpark();
        this.renderLoadChart();

        // WebDAV / Subsonic 状态行
        const wd = document.getElementById('webdav-state-dash');
        if (wd) wd.textContent = status.isWebDAVConfigured ? '已配置' : '未配置';
        const ss = document.getElementById('subsonic-state-dash');
        if (ss) ss.textContent = status.isSubsonicEnabled === false ? '未启用' : '运行中';

        // 关于页同步
        set('about-uptime', this.formatUptime(status.uptime));
        set('about-devices', status.devices + ' 个连接');
    }

    renderUsersSpark() {
        const svg = document.getElementById('spark-users');
        if (!svg) return;
        // 用户数无曲线：显示静态绿色装饰波形
        svg.innerHTML = `<defs><linearGradient id="gu1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1ED760" stop-opacity=".4"/><stop offset="1" stop-color="#1ED760" stop-opacity=".04"/></linearGradient></defs>
        <path d="M0,18 L14,14 L28,17 L42,10 L56,13 L70,7 L84,11 L100,6 L100,30 L0,30 Z" fill="url(#gu1)"/>
        <path d="M0,18 L14,14 L28,17 L42,10 L56,13 L70,7 L84,11 L100,6" fill="none" stroke="#1ED760" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
    }

    renderSpark(id, data, color) {
        const svg = document.getElementById(id);
        if (!svg || data.length < 2) return;
        const w = 100, h = 30, pad = 4;
        const max = Math.max(...data, 10);
        const pts = data.map((v, i) => [i / (data.length - 1) * w, h - (v / max) * (h - pad * 2) - pad]);
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2;
            d += ` Q ${pts[i][0]} ${pts[i][1]} ${xc} ${yc}`;
        }
        d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
        const gid = 'sg-' + id;
        svg.innerHTML = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="${color}" stop-opacity=".04"/></linearGradient></defs>
        <path d="${d} L ${w} ${h} L 0 ${h} Z" fill="url(#${gid})"/>
        <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`;
    }

    renderLoadChart() {
        const svg = document.getElementById('load-chart');
        if (!svg || this.cpuHistory.length < 2) return;
        const W = 600, H = 150, pad = 8;
        const line = (data, maxScale) => {
            const n = data.length;
            const pts = data.map((v, i) => [i / (n - 1) * W, H - (Math.min(v, maxScale) / maxScale) * (H - pad * 2) - pad]);
            let d = `M ${pts[0][0]} ${pts[0][1]}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2;
                d += ` Q ${pts[i][0]} ${pts[i][1]} ${xc} ${yc}`;
            }
            d += ` L ${pts[n - 1][0]} ${pts[n - 1][1]}`;
            return { d, last: pts[n - 1] };
        };
        const cpuL = line(this.cpuHistory, 100);
        const memL = line(this.memHistory, 100);
        svg.innerHTML = `
            <g stroke="rgba(255,255,255,.06)" stroke-width="1">
                <line x1="0" y1="30" x2="600" y2="30"/><line x1="0" y1="60" x2="600" y2="60"/>
                <line x1="0" y1="90" x2="600" y2="90"/><line x1="0" y1="120" x2="600" y2="120"/>
            </g>
            <text x="4" y="26" fill="#6A6A6A" font-size="9">75%</text>
            <text x="4" y="56" fill="#6A6A6A" font-size="9">50%</text>
            <text x="4" y="86" fill="#6A6A6A" font-size="9">25%</text>
            <text x="4" y="116" fill="#6A6A6A" font-size="9">0%</text>
            <path d="${cpuL.d} L 600 150 L 0 150 Z" fill="rgba(30,215,96,.10)"/>
            <path d="${cpuL.d}" fill="none" stroke="#1ED760" stroke-width="2" stroke-linecap="round"/>
            <path d="${memL.d}" fill="none" stroke="#4A90E2" stroke-width="2" stroke-linecap="round" opacity=".85"/>
            <circle cx="${cpuL.last[0]}" cy="${cpuL.last[1]}" r="3.5" fill="#1ED760"/>
            <circle cx="${cpuL.last[0]}" cy="${cpuL.last[1]}" r="7" fill="none" stroke="#1ED760" stroke-opacity=".3"/>
            <circle cx="${memL.last[0]}" cy="${memL.last[1]}" r="3" fill="#4A90E2"/>`;
    }

    /* ================= 用户管理 ================= */
    renderUserMenu(type) {
        const menu = document.getElementById(`${type}-user-menu`);
        if (!menu || !this.allUsers) return;
        const current = document.getElementById(`${type}-user-select`).value;
        menu.innerHTML = this.allUsers.map(user => {
            const isPublic = user.name === '_open';
            const label = isPublic ? '公开用户' : this.escapeHtml(user.name);
            return `<div class="usel-item ${user.name === current ? 'on' : ''}" onclick="app.selectUser('${type}', '${this.escapeHtml(user.name)}')">
                <span class="mini-ava" style="background:${stringToColor(user.name)}">${isPublic ? '⌘' : this.escapeHtml(user.name.charAt(0).toUpperCase())}</span>
                <span>${label}${isPublic ? ' (_open)' : ''}</span>
                ${user.name === current ? '<svg class="ck ic" viewBox="0 0 24 24"><use href="#i-check"/></svg>' : ''}
            </div>`;
        }).join('');
    }

    toggleUserDropdown(type) {
        const menu = document.getElementById(`${type}-user-menu`);
        document.querySelectorAll('.usel-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
        menu?.classList.toggle('hidden');
    }

    selectUser(type, username) {
        document.getElementById(`${type}-user-select`).value = username;
        const label = document.querySelector(`#${type}-user-selector .usel-label`);
        if (label) label.textContent = username === '_open' ? '公开用户 (_open)' : username;
        document.getElementById(`${type}-user-menu`)?.classList.add('hidden');
        this.renderUserMenu(type);
        if (type === 'data') this.loadUserData();
        else this.loadSnapshots();
    }

    renderUserGrid(type) {
        const container = type === 'data' ? document.getElementById('data-content') : document.getElementById('snapshots-list');
        if (!container || !this.allUsers) return;
        const table = document.getElementById('snapshots-table');
        if (type === 'data') {
            document.getElementById('data-stats').classList.add('hidden');
            document.getElementById('data-tabs-container').classList.add('hidden');
        }
        container.innerHTML = `<div class="glass"><div class="user-grid">${this.allUsers.map(user => {
            const isPublic = user.name === '_open';
            return `<div class="user-cell" onclick="app.selectUser('${type}', '${this.escapeHtml(user.name)}')">
                <div class="ava" style="background:${stringToColor(user.name)}">${isPublic ? '⌘' : this.escapeHtml(user.name.charAt(0).toUpperCase())}</div>
                <b>${isPublic ? '公开用户' : this.escapeHtml(user.name)}</b>
                <span>${isPublic ? '公共数据与歌单' : '用户数据'}</span>
            </div>`;
        }).join('')}</div></div>`;
    }

    async loadUsers() {
        try {
            const users = await this.request('/api/users');
            this.users = users.filter(u => u.name !== '_open');
            this.renderUsers();
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }

    renderUsers() {
        const container = document.getElementById('users-list');
        const sub = document.getElementById('users-subtitle');
        if (sub) sub.textContent = `${this.users.length} 位注册用户`;
        if (!this.users.length) {
            container.innerHTML = `<div class="empty-state">暂无用户，点击右上角「新增用户」创建第一个同步账号</div>`;
            return;
        }
        container.innerHTML = this.users.map((user, index) => `
            <div class="trow users-row" data-username="${this.escapeHtml(user.name.toLowerCase())}">
                <span>
                    <span class="u-name"><span class="ava" style="background:${stringToColor(user.name)}">${this.escapeHtml(user.name.charAt(0).toUpperCase())}</span><b>${this.escapeHtml(user.name)}</b>
                    ${user.enableCustomMusicDir ? '<span class="badge blue" style="margin-left:6px">自定义目录</span>' : ''}
                    <span class="u-sub" style="width:100%;margin-left:40px">${user.password ? '******' : ''}</span></span>
                </span>
                <span class="row-acts" style="justify-content:flex-start">
                    <button class="mini" onclick="app.togglePasswordVisibility(${index})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-eye"/></svg></button>
                    <button class="mini" onclick="app.showEditPasswordModal(${index})">改密</button>
                </span>
                <span class="col-devices"><span class="badge ok">活跃</span></span>
                <span style="font-size:11px;color:var(--muted)">${user.enableCustomMusicDir ? this.escapeHtml(user.customMusicDir || '未设置') : '—'}</span>
                <span class="row-acts">
                    <button class="mini" onclick="app.showRenameUserModal(${index})">配置</button>
                    <button class="mini danger" onclick="app.deleteUser(${index})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg> 删除</button>
                </span>
            </div>
        `).join('');
        const selectAll = document.getElementById('select-all-users');
        if (selectAll) selectAll.checked = false;
        this.updateUserBatchBtn();
    }

    filterUsers() {
        const query = document.getElementById('user-search-input').value.toLowerCase().trim();
        document.querySelectorAll('#users-list .users-row').forEach(row => {
            row.style.display = (row.dataset.username || '').includes(query) ? '' : 'none';
        });
    }

    togglePasswordVisibility(index) {
        const user = this.users[index];
        if (!user) return;
        const sub = document.querySelector(`#users-list .users-row[data-username="${user.name.toLowerCase()}"] .u-sub`);
        if (sub) sub.textContent = sub.textContent === '******' ? (user.password || '') : '******';
    }

    showAddUserModal() {
        const modal = document.getElementById('modal');
        document.getElementById('modal-title').textContent = '新增用户';
        document.getElementById('modal-body').innerHTML = `
            <div class="field"><label>用户名</label><input type="text" id="add-user-name" class="inp" placeholder="用户名（用于客户端连接）"></div>
            <div class="field"><label>连接密码</label><input type="password" id="add-user-password" class="inp" placeholder="连接密码"></div>
            <div class="cfg-btns" style="justify-content:flex-end;margin-top:16px">
                <button class="pill ghost" onclick="app.closeModal()">取消</button>
                <button class="pill" id="add-user-confirm"><svg class="ic"><use href="#i-plus"/></svg> 添加</button>
            </div>`;
        modal.classList.remove('hidden');
        document.getElementById('add-user-confirm').addEventListener('click', async () => {
            const name = document.getElementById('add-user-name').value.trim();
            const password = document.getElementById('add-user-password').value;
            if (!name || !password) { showInfo('请填写用户名与密码'); return; }
            try {
                await this.request('/api/users', { method: 'POST', body: JSON.stringify({ name, password }) });
                this.closeModal();
                this.loadUsers();
                this.loadDashboard();
                showSuccess('用户添加成功');
            } catch (err) { showError('添加用户失败: ' + err.message); }
        });
    }

    showEditPasswordModal(index) {
        const user = this.users[index];
        if (!user) return;
        this.editingUser = user.name;
        document.getElementById('edit-password-input').value = '';
        document.getElementById('edit-password-modal').classList.remove('hidden');
    }

    async saveNewPassword() {
        const newPassword = document.getElementById('edit-password-input').value;
        if (!newPassword) { showInfo('请填写新密码'); return; }
        try {
            await this.request('/api/users', {
                method: 'PUT',
                body: JSON.stringify({ name: this.editingUser, password: newPassword })
            });
            document.getElementById('edit-password-modal').classList.add('hidden');
            this.loadUsers();
            showSuccess('密码修改成功');
        } catch (err) { showError('修改失败: ' + err.message); }
    }

    async deleteUser(index) {
        const user = this.users[index];
        if (!user) return;
        const deleteData = await this.confirmDeleteData(`确定要删除用户 "${user.name}" 吗？`);
        if (deleteData === null) return;
        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ name: user.name, deleteData })
            });
            this.loadUsers();
            this.loadDashboard();
            showSuccess('用户已删除');
        } catch (err) { showError('删除用户失败: ' + err.message); }
    }

    async batchDeleteUsers() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        const names = Array.from(checked).map(cb => this.users[parseInt(cb.dataset.index)]?.name).filter(Boolean);
        if (!names.length) return;
        const deleteData = await this.confirmDeleteData(`确定要删除选中的 ${names.length} 个用户吗？`);
        if (deleteData === null) return;
        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ names, deleteData })
            });
            this.loadUsers();
            this.loadDashboard();
            showSuccess('批量删除成功');
        } catch (err) { showError('删除失败: ' + err.message); }
    }

    // 返回 true/false=确认（是否删数据），null=取消
    confirmDeleteData(message) {
        return new Promise(resolve => {
            const modal = document.getElementById('modal');
            document.getElementById('modal-title').textContent = '删除确认';
            document.getElementById('modal-body').innerHTML = `
                <p style="font-size:13px;line-height:1.7">${message}</p>
                <label style="display:flex;align-items:center;gap:8px;margin-top:16px;font-size:12.5px;cursor:pointer">
                    <input type="checkbox" class="sel" id="confirm-delete-data" style="width:15px;height:15px">
                    同时删除用户数据文件夹（不可恢复）
                </label>
                <div class="cfg-btns" style="justify-content:flex-end;margin-top:18px">
                    <button class="pill ghost" id="cf-cancel">取消</button>
                    <button class="pill danger" id="cf-ok">确认删除</button>
                </div>`;
            modal.classList.remove('hidden');
            document.getElementById('cf-ok').addEventListener('click', () => {
                const v = document.getElementById('confirm-delete-data').checked;
                modal.classList.add('hidden');
                resolve(v);
            });
            document.getElementById('cf-cancel').addEventListener('click', () => {
                modal.classList.add('hidden');
                resolve(null);
            });
        });
    }

    toggleAllUsers(checked) {
        document.querySelectorAll('.user-checkbox').forEach(cb => {
            if (cb.closest('.users-row').style.display !== 'none') cb.checked = checked;
        });
        this.updateUserBatchBtn();
    }

    updateUserBatchBtn() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        const btn = document.getElementById('batch-delete-users-btn');
        const countSpan = document.getElementById('user-selected-count');
        if (btn && countSpan) {
            btn.classList.toggle('hidden', checked.length === 0);
            countSpan.textContent = checked.length;
        }
        const selectAll = document.getElementById('select-all-users');
        const all = document.querySelectorAll('.user-checkbox');
        if (selectAll) selectAll.checked = all.length > 0 && checked.length === all.length;
    }

    setUserConfigConfirmBtnState(enabled) {
        const btn = document.getElementById('save-rename-user-btn');
        if (btn) { btn.disabled = !enabled; btn.style.opacity = enabled ? '1' : '0.5'; }
    }

    validateUserCustomDirState() {
        const toggle = document.getElementById('user-custom-dir-enable-toggle');
        const input = document.getElementById('user-custom-dir-input');
        const statusEl = document.getElementById('user-custom-dir-status');
        if (toggle?.checked) {
            this.setUserConfigConfirmBtnState(false);
            if (statusEl) {
                statusEl.textContent = input?.value.trim() ? '请点击「检测」验证目录可用性' : '请输入自定义歌曲目录地址';
                statusEl.style.color = input?.value.trim() ? 'var(--muted)' : 'var(--red)';
            }
        } else {
            this.setUserConfigConfirmBtnState(true);
            if (statusEl) statusEl.textContent = '';
        }
    }

    async testUserCustomDir() {
        const dirPath = document.getElementById('user-custom-dir-input')?.value.trim();
        const statusEl = document.getElementById('user-custom-dir-status');
        if (!dirPath) {
            if (statusEl) { statusEl.textContent = '请输入自定义歌曲目录地址'; statusEl.style.color = 'var(--red)'; }
            this.setUserConfigConfirmBtnState(false);
            return;
        }
        if (statusEl) { statusEl.textContent = '正在检测目录可用性...'; statusEl.style.color = 'var(--blue)'; }
        try {
            const res = await this.request('/api/utils/check-dir', { method: 'POST', body: JSON.stringify({ dirPath }) });
            if (res?.success) {
                if (statusEl) { statusEl.textContent = `目录可用 (${res.path || dirPath})`; statusEl.style.color = 'var(--green)'; }
                this.setUserConfigConfirmBtnState(true);
            } else {
                if (statusEl) { statusEl.textContent = res?.message || '目录不可用'; statusEl.style.color = 'var(--red)'; }
                this.setUserConfigConfirmBtnState(false);
            }
        } catch (err) {
            if (statusEl) { statusEl.textContent = '检测失败: ' + err.message; statusEl.style.color = 'var(--red)'; }
            this.setUserConfigConfirmBtnState(false);
        }
    }

    showRenameUserModal(index) {
        const user = this.users[index];
        if (!user) return;
        this.editingUser = user.name;
        document.getElementById('rename-user-input').value = user.name;
        const toggle = document.getElementById('user-custom-dir-enable-toggle');
        const container = document.getElementById('user-custom-dir-container');
        const dirInput = document.getElementById('user-custom-dir-input');
        const operateToggle = document.getElementById('user-custom-dir-operate-toggle');
        const writeToggle = document.getElementById('user-custom-dir-write-toggle');
        const statusEl = document.getElementById('user-custom-dir-status');
        if (toggle) toggle.checked = user.enableCustomMusicDir === true;
        if (dirInput) dirInput.value = user.customMusicDir || '';
        if (operateToggle) operateToggle.checked = user.allowOperateCustomMusicDir === true;
        if (writeToggle) writeToggle.checked = user.allowWriteCustomMusicDir === true;
        if (statusEl) statusEl.textContent = '';
        container?.classList.toggle('hidden', !user.enableCustomMusicDir);
        this.setUserConfigConfirmBtnState(true);
        document.getElementById('rename-user-modal').classList.remove('hidden');
    }

    async saveRenameUser() {
        const newName = document.getElementById('rename-user-input').value.trim();
        const enableCustomDir = document.getElementById('user-custom-dir-enable-toggle')?.checked || false;
        const customDir = document.getElementById('user-custom-dir-input')?.value.trim() || '';
        const allowOperate = document.getElementById('user-custom-dir-operate-toggle')?.checked || false;
        const allowWrite = document.getElementById('user-custom-dir-write-toggle')?.checked || false;
        if (!newName) { showInfo('请填写用户名'); return; }
        const bodyData = {
            name: this.editingUser,
            enableCustomMusicDir: enableCustomDir,
            customMusicDir: customDir,
            allowOperateCustomMusicDir: allowOperate,
            allowWriteCustomMusicDir: allowWrite
        };
        if (newName !== this.editingUser) bodyData.newName = newName;
        try {
            await this.request('/api/users', { method: 'PUT', body: JSON.stringify(bodyData) });
            document.getElementById('rename-user-modal').classList.add('hidden');
            this.loadUsers();
            this.loadDashboard();
            showSuccess(newName !== this.editingUser ? '用户配置及名称修改成功' : '用户配置更新成功');
        } catch (err) { showError('保存失败: ' + err.message); }
    }

    closeModal() {
        document.getElementById('modal')?.classList.add('hidden');
    }

    /* ================= 数据查看 ================= */
    currentUserData = null;
    currentPlaylistView = null;
    currentDataTab = 'all';

    getSourceLabel(source) {
        const map = { tx: 'QQ音乐', wy: '网易云', kw: '酷我', kg: '酷狗', mg: '咪咕', local: '本地' };
        return map[source] || source || '';
    }

    async loadUserData() {
        const username = document.getElementById('data-user-select')?.value;
        const statsContainer = document.getElementById('data-stats');
        const contentContainer = document.getElementById('data-content');
        if (!username) { this.renderUserGrid('data'); return; }

        try {
            const data = await this.request(`/api/data?user=${encodeURIComponent(username)}`);
            this.currentUserData = { username, data };

            let totalSongs = 0;
            const defaultCount = data.defaultList?.length || 0;
            const loveCount = data.loveList?.length || 0;
            const userListCount = data.userList?.length || 0;
            const albumsCount = data.albums?.length || 0;
            const artistsCount = data.artists?.length || 0;
            data.userList?.forEach(list => totalSongs += list.list?.length || 0);
            totalSongs += defaultCount + loveCount;

            statsContainer.classList.remove('hidden');
            statsContainer.innerHTML = `
                <div class="dstat" onclick="app.viewAllSongs()"><div class="dl">总歌曲数 <svg class="ic"><use href="#i-music"/></svg></div><div class="dv">${totalSongs}</div></div>
                <div class="dstat" onclick="app.viewSystemList('default')"><div class="dl">试听列表 <svg class="ic"><use href="#i-play"/></svg></div><div class="dv">${defaultCount}</div></div>
                <div class="dstat" onclick="app.viewSystemList('love')"><div class="dl">我的收藏 <svg class="ic"><use href="#i-heart"/></svg></div><div class="dv">${loveCount}</div></div>
                <div class="dstat ${this.currentDataTab === 'playlists' ? 'on' : ''}" onclick="app.setDataTab('playlists')"><div class="dl">播放列表 <svg class="ic"><use href="#i-log"/></svg></div><div class="dv">${userListCount}</div></div>
                <div class="dstat ${this.currentDataTab === 'albums' ? 'on' : ''}" onclick="app.setDataTab('albums')"><div class="dl">收藏专辑 <svg class="ic"><use href="#i-disc"/></svg></div><div class="dv">${albumsCount}</div></div>
                <div class="dstat ${this.currentDataTab === 'artists' ? 'on' : ''}" onclick="app.setDataTab('artists')"><div class="dl">收藏歌手 <svg class="ic"><use href="#i-mic"/></svg></div><div class="dv">${artistsCount}</div></div>`;

            document.getElementById('data-tabs-container').classList.remove('hidden');
            document.getElementById('tab-count-playlists').textContent = userListCount;
            document.getElementById('tab-count-albums').textContent = albumsCount;
            document.getElementById('tab-count-artists').textContent = artistsCount;
            this.renderCurrentDataTab();
        } catch (err) {
            contentContainer.innerHTML = '<p style="color:var(--red);padding:2rem;text-align:center">加载数据失败</p>';
        }
    }

    setDataTab(tab) {
        this.currentDataTab = tab;
        this.currentPlaylistView = null;
        document.querySelectorAll('#data-tabs-container .tab').forEach(btn => btn.classList.toggle('on', btn.dataset.tab === tab));
        document.querySelectorAll('#data-stats .dstat').forEach((card, i) => card.classList.toggle('on', [3, 4, 5].includes(i) && ['playlists', 'albums', 'artists'][i - 3] === tab));
        this.renderCurrentDataTab();
    }

    renderCurrentDataTab() {
        const data = this.currentUserData?.data;
        const contentContainer = document.getElementById('data-content');
        if (!data || !contentContainer) return;
        this.currentPlaylistView = null;
        document.getElementById('data-tabs-container')?.classList.remove('hidden');
        const tab = this.currentDataTab || 'all';
        let html = '';
        if (tab === 'all' || tab === 'playlists') html += this.getPlaylistsHtml(data.userList || [], tab === 'all');
        if (tab === 'all' || tab === 'albums') html += this.getAlbumsHtml(data.albums || [], tab === 'all');
        if (tab === 'all' || tab === 'artists') html += this.getArtistsHtml(data.artists || [], tab === 'all');
        contentContainer.innerHTML = html;
    }

    coverGrad(name) {
        let h = 0;
        for (let i = 0; i < (name || '').length; i++) h = (name || '').charCodeAt(i) + ((h << 5) - h);
        return 'g' + (Math.abs(h) % 6);
    }

    getPlaylistsHtml(userList, isAll) {
        let html = `<div class="sec-hd" style="padding:16px 0 0"><h4>播放列表</h4><span>共 ${userList.length} 个自定义歌单</span></div><div style="height:12px"></div>`;
        if (userList.length) {
            html += '<div class="cover-grid">';
            userList.forEach((list, index) => {
                const songCount = list.list?.length || 0;
                html += `
                    <div class="cover">
                        <div class="cv ${this.coverGrad(list.name)}" onclick="app.viewPlaylistDetails(${index})">
                            <span class="cnt">${songCount} 首</span>
                            <span class="cvic"><svg class="ic" style="width:26px;height:26px"><use href="#i-music"/></svg></span>
                            <div class="cv-acts">
                                <button class="mini" onclick="event.stopPropagation();app.viewPlaylistDetails(${index})">查看</button>
                                <button class="mini danger" onclick="event.stopPropagation();app.deletePlaylist(${index})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>
                            </div>
                        </div>
                        <b title="${this.escapeHtml(list.name)}">${this.escapeHtml(list.name)}</b>
                        <span>歌单 · ID ${this.escapeHtml(String(list.id))}</span>
                    </div>`;
            });
            html += '</div>';
        } else {
            html += '<div class="glass empty-state">暂无自定义歌单</div>';
        }
        if (isAll) html += '<div style="height:20px"></div>';
        return html;
    }

    getAlbumsHtml(albums, withGap) {
        let html = `<div class="sec-hd" style="padding:16px 0 0"><h4>收藏专辑</h4><span>共 ${albums.length} 张</span></div><div style="height:12px"></div>`;
        if (albums.length) {
            html += '<div class="cover-grid">';
            albums.forEach((album, index) => {
                const songCount = album.list?.length || 0;
                const picUrl = album.picUrl || album.meta?.picUrl || album.list?.[0]?.img || '';
                const artist = album.artistName || album.singer || album.list?.[0]?.singer || '未知歌手';
                const sourceLabel = this.getSourceLabel(album.source);
                html += `
                    <div class="cover" onclick="app.viewAlbumDetails(${index})" title="点击查看专辑曲目">
                        <div class="cv ${picUrl ? '' : this.coverGrad(album.name)}">
                            ${picUrl ? `<img src="${this.escapeHtml(picUrl)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
                            <span class="cnt">${songCount} 首</span>
                            <span class="cvic"><svg class="ic" style="width:26px;height:26px"><use href="#i-disc"/></svg></span>
                            <div class="cv-acts"><span class="badge" style="pointer-events:none">查看曲目</span></div>
                        </div>
                        <b title="${this.escapeHtml(album.name)}">${this.escapeHtml(album.name)}</b>
                        <span>${this.escapeHtml(artist)}${sourceLabel ? ' · ' + sourceLabel : ''}</span>
                    </div>`;
            });
            html += '</div>';
        } else {
            html += '<div class="glass empty-state">暂无收藏专辑</div>';
        }
        if (withGap) html += '<div style="height:20px"></div>';
        return html;
    }

    getArtistsHtml(artists) {
        let html = `<div class="sec-hd" style="padding:16px 0 0"><h4>收藏歌手</h4><span>共 ${artists.length} 位</span></div><div style="height:12px"></div>`;
        if (artists.length) {
            html += '<div class="cover-grid">';
            artists.forEach(artist => {
                const picUrl = artist.picUrl || '';
                const sourceLabel = this.getSourceLabel(artist.source);
                html += `
                    <div class="cover" style="cursor:default">
                        <div class="cv ${picUrl ? '' : this.coverGrad(artist.name)}" style="align-items:center;justify-content:center">
                            ${picUrl ? `<img src="${this.escapeHtml(picUrl)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
                            <span class="ava" style="position:relative;margin:0;width:64px;height:64px;border-radius:32px;font-size:24px;background:${stringToColor(artist.name)}">${this.escapeHtml((artist.name || '?').charAt(0))}</span>
                        </div>
                        <b title="${this.escapeHtml(artist.name)}">${this.escapeHtml(artist.name)}</b>
                        <span>${sourceLabel || '关注歌手'}</span>
                    </div>`;
            });
            html += '</div>';
        } else {
            html += '<div class="glass empty-state">暂无收藏歌手</div>';
        }
        return html;
    }

    detailBackHtml(title, metaHtml) {
        return `<div class="detail-hd">
            <button class="back" onclick="app.renderCurrentDataTab()"><svg class="ic"><use href="#i-back"/></svg> 返回列表</button>
            <h3>${title}</h3>${metaHtml}
        </div>`;
    }

    searchSortHtml(withSource) {
        return `<div class="batch-bar">
            <div class="search-box"><svg class="ic"><use href="#i-search"/></svg><input type="text" id="song-search" placeholder="搜索歌曲、歌手..." oninput="app.filterSongs()"></div>
            <select class="inp" id="song-sort" style="height:34px;border-radius:17px;width:auto" onchange="app.sortSongs()">
                <option value="">默认排序</option>
                <option value="name-asc">歌曲名 A-Z</option>
                <option value="name-desc">歌曲名 Z-A</option>
                <option value="artist-asc">歌手 A-Z</option>
                <option value="artist-desc">歌手 Z-A</option>
                ${withSource ? '<option value="source-asc">所属列表 A-Z</option><option value="source-desc">所属列表 Z-A</option>' : ''}
            </select>
        </div>`;
    }

    songTagsHtml(song) {
        let html = '<span class="song-tags">';
        if (song.source) html += `<span class="tag-q">${this.escapeHtml(song.source)}</span>`;
        const qualitys = song.meta ? (song.meta._qualitys || song.meta.qualitys) : null;
        if (qualitys) {
            const has = t => Array.isArray(qualitys) ? qualitys.some(q => q.type === t) : qualitys[t];
            if (has('flac24bit')) html += '<span class="tag-q hr">Hi-Res</span>';
            else if (has('flac')) html += '<span class="tag-q sq">SQ</span>';
            else if (has('320k')) html += '<span class="tag-q">HQ</span>';
        }
        html += '</span>';
        return html;
    }

    songNameCell(song, defaultCover = '') {
        const picUrl = song.img || song.picUrl || song.cover || song.meta?.picUrl || defaultCover || '';
        const coverHtml = picUrl
            ? `<img src="${this.escapeHtml(picUrl)}" class="song-cover" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
            : `<span class="song-cover ph"><svg class="ic"><use href="#i-music"/></svg></span>`;
        return `<div class="song-cell-name">${coverHtml}<span class="song-name" title="${this.escapeHtml(song.name || '未知歌曲')}">${this.escapeHtml(song.name || '未知歌曲')}</span>${this.songTagsHtml(song)}</div>`;
    }

    viewPlaylistDetails(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;
        this.currentPlaylistView = index;
        document.getElementById('data-tabs-container')?.classList.add('hidden');
        let content = this.detailBackHtml(this.escapeHtml(playlist.name), `<span class="meta">ID: ${this.escapeHtml(String(playlist.id))} · ${playlist.list?.length || 0} 首歌曲</span>
            <button class="mini" onclick="app.editPlaylistName(${index})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-edit"/></svg> 改名</button>
            <button class="mini danger" onclick="app.deletePlaylist(${index})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg> 删除歌单</button>`);
        if (playlist.list?.length) {
            content += this.searchSortHtml(false);
            content += `<div class="batch-bar"><div class="l">
                    <button class="mini" onclick="app.selectAllSongs()">全选</button>
                    <button class="mini" onclick="app.invertSelection()">反选</button>
                    <button class="mini" onclick="app.clearSelection()">清空</button>
                </div>
                <button class="pill danger" id="batch-delete-btn" onclick="app.batchDeleteSongs()" disabled><svg class="ic"><use href="#i-trash"/></svg> 批量删除 (<span id="selected-count">0</span>)</button>
            </div>`;
            content += '<div class="songs-table">';
            content += `<div class="song-row hd cb"><span><input type="checkbox" class="sel" id="select-all-checkbox" onchange="app.toggleAllSongs(this.checked)"></span><span>#</span><span>歌曲</span><span>歌手</span><span>来源</span><span class="col-acts-w" style="text-align:right">操作</span></div>`;
            playlist.list.forEach((song, songIndex) => {
                content += `<div class="song-row cb">
                    <span><input type="checkbox" class="sel song-checkbox" data-index="${songIndex}" onchange="app.updateBatchDeleteBtn()"></span>
                    <span style="color:var(--muted)">${songIndex + 1}</span>
                    ${this.songNameCell(song)}
                    <span class="song-artist">${this.escapeHtml(song.singer || '未知歌手')}</span>
                    <span class="song-src">${this.getSourceLabel(song.source)}</span>
                    <span class="col-acts-w row-acts"><button class="mini danger" onclick="app.deleteSong(${index}, ${songIndex})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></span>
                </div>`;
            });
            content += '</div>';
        } else {
            content += '<div class="glass empty-state">此歌单暂无歌曲</div>';
        }
        document.getElementById('data-content').innerHTML = content;
    }

    viewSystemList(listType) {
        const data = this.currentUserData?.data;
        if (!data) return;
        const listMap = {
            default: { list: data.defaultList, name: '试听列表', id: 'default' },
            love: { list: data.loveList, name: '我的收藏', id: 'love' }
        };
        const systemList = listMap[listType];
        if (!systemList) return;
        this.currentPlaylistView = listType;
        document.getElementById('data-tabs-container')?.classList.add('hidden');
        let content = this.detailBackHtml(systemList.name, `<span class="meta">系统列表 · ${systemList.list?.length || 0} 首歌曲</span>`);
        if (systemList.list?.length) {
            content += this.searchSortHtml(false);
            content += '<div class="songs-table">';
            content += '<div class="song-row hd"><span>#</span><span>歌曲</span><span>歌手</span><span>来源</span><span class="col-acts-w" style="text-align:right">操作</span></div>';
            systemList.list.forEach((song, songIndex) => {
                content += `<div class="song-row">
                    <span style="color:var(--muted)">${songIndex + 1}</span>
                    ${this.songNameCell(song)}
                    <span class="song-artist">${this.escapeHtml(song.singer || '未知歌手')}</span>
                    <span class="song-src">${this.getSourceLabel(song.source)}</span>
                    <span class="col-acts-w row-acts"><button class="mini danger" onclick="app.deleteSong('${listType}', ${songIndex})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></span>
                </div>`;
            });
            content += '</div>';
        } else {
            content += '<div class="glass empty-state">此列表暂无歌曲</div>';
        }
        document.getElementById('data-content').innerHTML = content;
    }

    viewAllSongs() {
        const data = this.currentUserData?.data;
        if (!data) return;
        this.currentPlaylistView = 'all';
        document.getElementById('data-tabs-container')?.classList.add('hidden');
        let allSongs = [];
        data.defaultList?.forEach(song => allSongs.push({ ...song, _source: '试听列表' }));
        data.loveList?.forEach(song => allSongs.push({ ...song, _source: '我的收藏' }));
        data.userList?.forEach(list => list.list?.forEach(song => allSongs.push({ ...song, _source: list.name })));
        let content = this.detailBackHtml('所有歌曲', `<span class="meta">总计 ${allSongs.length} 首</span>`);
        if (allSongs.length) {
            content += this.searchSortHtml(true);
            content += '<div class="songs-table">';
            content += '<div class="song-row hd"><span>#</span><span>歌曲</span><span>歌手</span><span>所属列表</span><span class="col-acts-w"></span></div>';
            allSongs.forEach((song, i) => {
                content += `<div class="song-row">
                    <span style="color:var(--muted)">${i + 1}</span>
                    ${this.songNameCell(song)}
                    <span class="song-artist">${this.escapeHtml(song.singer || '未知歌手')}</span>
                    <span class="song-src">${this.escapeHtml(song._source)}</span>
                    <span class="col-acts-w"></span>
                </div>`;
            });
            content += '</div>';
        } else {
            content += '<div class="glass empty-state">暂无歌曲</div>';
        }
        document.getElementById('data-content').innerHTML = content;
    }

    viewAlbumDetails(index) {
        const album = this.currentUserData?.data?.albums?.[index];
        if (!album) return;
        this.currentAlbumView = index;
        document.getElementById('data-tabs-container')?.classList.add('hidden');
        const picUrl = album.picUrl || album.meta?.picUrl || album.list?.[0]?.img || '';
        const artist = album.artistName || album.singer || album.list?.[0]?.singer || '未知歌手';
        const sourceLabel = this.getSourceLabel(album.source);
        let content = this.detailBackHtml(this.escapeHtml(album.name), `<span class="meta">${this.escapeHtml(artist)} · ${album.list?.length || 0} 首${sourceLabel ? ' · ' + sourceLabel : ''}${album.id ? ' · ID: ' + this.escapeHtml(String(album.id)) : ''}</span>`);
        if (album.list?.length) {
            content += this.searchSortHtml(false);
            content += '<div class="songs-table">';
            content += '<div class="song-row hd"><span>#</span><span>歌曲</span><span>歌手</span><span>来源</span><span class="col-acts-w song-int">时长</span></div>';
            album.list.forEach((song, songIndex) => {
                content += `<div class="song-row">
                    <span style="color:var(--muted)">${songIndex + 1}</span>
                    ${this.songNameCell(song, picUrl)}
                    <span class="song-artist">${this.escapeHtml(song.singer || artist || '未知歌手')}</span>
                    <span class="song-src">${this.getSourceLabel(song.source)}</span>
                    <span class="song-int col-acts-w">${this.escapeHtml(song.interval || '--:--')}</span>
                </div>`;
            });
            content += '</div>';
        } else {
            content += '<div class="glass empty-state">此专辑暂无曲目</div>';
        }
        document.getElementById('data-content').innerHTML = content;
    }

    async deletePlaylist(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;
        if (!(await showSelect('删除歌单', `确定要删除歌单 "${playlist.name}" 吗？此操作将删除歌单及其中的所有歌曲！`, { danger: true }))) return;
        try {
            await this.request('/api/data/delete-playlist', {
                method: 'POST',
                body: JSON.stringify({ username: this.currentUserData.username, playlistId: playlist.id })
            });
            showSuccess('删除成功');
            this.loadUserData();
        } catch (err) { showError('删除失败: ' + err.message); }
    }

    async editPlaylistName(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;
        const newName = await showInput('编辑歌单名称', '请输入新的歌单名称：', { defaultValue: playlist.name });
        if (!newName || newName === playlist.name) return;
        try {
            await this.request('/api/data/rename-playlist', {
                method: 'POST',
                body: JSON.stringify({ username: this.currentUserData.username, playlistId: playlist.id, newName })
            });
            showSuccess('重命名成功');
            await this.loadUserData();
            this.viewPlaylistDetails(index);
        } catch (err) { showError('重命名失败: ' + err.message); }
    }

    async deleteSong(playlistIndexOrType, songIndex) {
        let playlist, song, playlistId, isSystemList = false;
        if (typeof playlistIndexOrType === 'string') {
            isSystemList = true;
            const listMap = {
                default: { list: this.currentUserData?.data?.defaultList, name: '试听列表', id: 'default' },
                love: { list: this.currentUserData?.data?.loveList, name: '我的收藏', id: 'love' }
            };
            playlist = listMap[playlistIndexOrType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        } else {
            playlist = this.currentUserData?.data?.userList?.[playlistIndexOrType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        }
        if (!song) return;
        if (!(await showSelect('删除歌曲', `确定要从 "${playlist.name}" 中删除歌曲 "${song.name}" 吗？`, { danger: true }))) return;
        try {
            await this.request('/api/data/delete-song', {
                method: 'POST',
                body: JSON.stringify({ username: this.currentUserData.username, playlistId, songIndex })
            });
            showSuccess('删除成功');
            await this.loadUserData();
            if (isSystemList) this.viewSystemList(playlistIndexOrType);
            else this.viewPlaylistDetails(playlistIndexOrType);
        } catch (err) { showError('删除失败: ' + err.message); }
    }

    updateBatchDeleteBtn() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        const count = checkboxes.length;
        const btn = document.getElementById('batch-delete-btn');
        const countSpan = document.getElementById('selected-count');
        if (countSpan) countSpan.textContent = count;
        if (btn) btn.disabled = count === 0;
        const all = document.querySelectorAll('.song-checkbox');
        const selectAll = document.getElementById('select-all-checkbox');
        if (selectAll && all.length) {
            selectAll.checked = count === all.length;
            selectAll.indeterminate = count > 0 && count < all.length;
        }
    }

    toggleAllSongs(checked) {
        document.querySelectorAll('.song-checkbox').forEach(cb => cb.checked = checked);
        this.updateBatchDeleteBtn();
    }

    selectAllSongs() { this.toggleAllSongs(true); }
    invertSelection() {
        document.querySelectorAll('.song-checkbox').forEach(cb => cb.checked = !cb.checked);
        this.updateBatchDeleteBtn();
    }
    clearSelection() { this.toggleAllSongs(false); }

    async batchDeleteSongs() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        if (!checkboxes.length) return;
        const playlistIndex = this.currentPlaylistView;
        const playlist = this.currentUserData?.data?.userList?.[playlistIndex];
        if (!playlist) return;
        if (!(await showSelect('批量删除', `确定要删除选中的 ${checkboxes.length} 首歌曲吗？`, { danger: true }))) return;
        try {
            const songIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index)).sort((a, b) => b - a);
            await this.request('/api/data/batch-delete-songs', {
                method: 'POST',
                body: JSON.stringify({ username: this.currentUserData.username, playlistId: playlist.id, songIndices })
            });
            showSuccess('批量删除成功');
            await this.loadUserData();
            this.viewPlaylistDetails(playlistIndex);
        } catch (err) { showError('批量删除失败: ' + err.message); }
    }

    filterSongs() {
        const searchText = document.getElementById('song-search')?.value.toLowerCase() || '';
        document.querySelectorAll('.songs-table .song-row:not(.hd)').forEach(row => {
            const name = row.querySelector('.song-name')?.textContent.toLowerCase() || '';
            const artist = row.querySelector('.song-artist')?.textContent.toLowerCase() || '';
            row.style.display = (name.includes(searchText) || artist.includes(searchText)) ? '' : 'none';
        });
    }

    sortSongs() {
        const sortValue = document.getElementById('song-sort')?.value;
        if (!sortValue) {
            if (typeof this.currentPlaylistView === 'number') this.viewPlaylistDetails(this.currentPlaylistView);
            else if (typeof this.currentPlaylistView === 'string' && this.currentPlaylistView !== 'all') this.viewSystemList(this.currentPlaylistView);
            else if (this.currentPlaylistView === 'all') this.viewAllSongs();
            else if (this.currentAlbumView != null) this.viewAlbumDetails(this.currentAlbumView);
            return;
        }
        const [field, order] = sortValue.split('-');
        const table = document.querySelector('.songs-table');
        if (!table) return;
        const header = table.querySelector('.song-row.hd');
        const rows = Array.from(table.querySelectorAll('.song-row:not(.hd)'));
        rows.sort((a, b) => {
            let aValue = '', bValue = '';
            if (field === 'name') { aValue = a.querySelector('.song-name')?.textContent || ''; bValue = b.querySelector('.song-name')?.textContent || ''; }
            else if (field === 'artist') { aValue = a.querySelector('.song-artist')?.textContent || ''; bValue = b.querySelector('.song-artist')?.textContent || ''; }
            else if (field === 'source') { aValue = a.querySelector('.song-src')?.textContent || ''; bValue = b.querySelector('.song-src')?.textContent || ''; }
            const c = (aValue || '').localeCompare(bValue || '', 'zh-CN');
            return order === 'asc' ? c : -c;
        });
        rows.forEach(row => table.appendChild(row));
        if (header) table.prepend(header);
    }

    /* ================= 配置 ================= */
    async loadConfig() {
        try {
            const config = await this.request('/api/config');
            this.configLoaded = true;
            this.lastConfig = config;
            const form = document.getElementById('config-form');
            const el = n => form.elements[n];
            const set = (n, v) => { if (el(n)) el(n).value = v ?? ''; };
            const setChk = (n, v) => { if (el(n)) el(n).checked = v === true; };

            set('serverName', config.serverName);
            set('maxSnapshotNum', config.maxSnapshotNum || 10);
            set('list.addMusicLocationType', config['list.addMusicLocationType'] || 'top');
            setChk('proxy.enabled', config['proxy.enabled']);
            set('proxy.header', config['proxy.header']);
            setChk('proxy.all.enabled', config['proxy.all.enabled']);
            set('proxy.all.address', config['proxy.all.address']);
            setChk('user.enablePath', config['user.enablePath'] !== false);
            setChk('user.enableRoot', config['user.enableRoot'] === true);
            setChk('user.enablePublicRestriction', config['user.enablePublicRestriction'] === true);
            setChk('user.enablePublicNonAdminLocalMusic', config['user.enablePublicNonAdminLocalMusic'] === true);
            setChk('user.enablePublicNonAdminBrowserDownload', config['user.enablePublicNonAdminBrowserDownload'] !== false);
            setChk('user.enablePublicNonAdminServerCache', config['user.enablePublicNonAdminServerCache'] === true);
            this.togglePublicNonAdminLocalMusicVisibility();
            setChk('user.enablePublicFavorites', config['user.enablePublicFavorites'] === true);
            setChk('user.enablePublicNonAdminAccess', config['user.enablePublicNonAdminAccess'] === true);
            this.togglePublicNonAdminAccessVisibility();
            setChk('user.enableLoginCacheRestriction', config['user.enableLoginCacheRestriction'] === true);
            setChk('user.enableCacheSizeLimit', config['user.enableCacheSizeLimit'] === true);
            set('user.cacheSizeLimit', config['user.cacheSizeLimit'] || 2000);
            setChk('system.allowUnsafeVM', config['system.allowUnsafeVM'] === true);
            set('singer.sourcePriority', config['singer.sourcePriority'] || 'tx,wy');
            set('frontend.password', config['frontend.password']);
            setChk('player.enableAuth', config['player.enableAuth'] === true);
            set('player.password', config['player.password']);
            setChk('webdav.enable', config['webdav.enable'] === true);
            set('webdav.url', config['webdav.url']);
            set('webdav.username', config['webdav.username']);
            set('webdav.password', config['webdav.password']);
            set('webdav.syncPath', config['webdav.syncPath'] || '/lx-sync');
            set('webdav.backupPath', config['webdav.backupPath'] || '/lx-sync-backups');
            set('sync.interval', config['sync.interval'] || 60);
            set('sync.backupInterval', config['sync.backupInterval'] || 24);
            set('admin.path', config['admin.path']);
            const pPath = config['player.path'] ?? '/';
            set('player.path', pPath === '' ? '/' : pPath);

            setChk('subsonic.enable', config['subsonic.enable'] === true);
            set('subsonic.path', config['subsonic.path'] || '/rest');
            setChk('subsonic.enableDebug', config['subsonic.enableDebug'] === true);
            setChk('subsonic.onlineSearch', config['subsonic.onlineSearch'] !== false);
            set('subsonic.onlineSearchMode', config['subsonic.onlineSearchMode'] || 'fallback');
            set('subsonic.onlineSearchSources', config['subsonic.onlineSearchSources'] || 'wy,tx,kw,kg,mg');
            setChk('subsonic.lyricTranslation', config['subsonic.lyricTranslation'] !== false);
            setChk('user.enableCustomMusicDir', config['user.enableCustomMusicDir'] === true);

            const ref = document.getElementById('config-js-path-ref');
            if (ref && config.configFilePath) ref.textContent = config.configFilePath;

            const navPlayerLink = document.getElementById('nav-player-link');
            if (navPlayerLink) navPlayerLink.href = config['player.path'] === '' ? '/' : (config['player.path'] ?? '/');
            const aboutName = document.getElementById('about-servername');
            if (aboutName) aboutName.textContent = config.serverName || '-';
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    }

    togglePublicNonAdminAccessVisibility() {
        const favCb = document.querySelector('input[name="user.enablePublicFavorites"]');
        const wrapper = document.getElementById('public-non-admin-access-wrapper');
        if (favCb && wrapper) wrapper.style.display = favCb.checked ? 'block' : 'none';
    }

    togglePublicNonAdminLocalMusicVisibility() {
        const resCb = document.querySelector('input[name="user.enablePublicRestriction"]');
        const wrapper = document.getElementById('public-non-admin-local-music-wrapper');
        if (resCb && wrapper) wrapper.style.display = resCb.checked ? 'block' : 'none';
    }

    async saveConfig(silent = false) {
        if (!this.configLoaded) return;
        const form = document.getElementById('config-form');
        const formData = new FormData(form);

        const adminPath = (formData.get('admin.path') || '').trim();
        const playerPath = (formData.get('player.path') || '').trim();
        const errEl = document.getElementById('path-conflict-error');
        let pathError = '';
        if (!playerPath) pathError = '播放器路径不能为空';
        else if (!playerPath.startsWith('/')) pathError = '播放器路径必须以 / 开头';
        else if (adminPath !== '' && !adminPath.startsWith('/')) pathError = '后台路径必须以 / 开头（或留空表示根路径）';
        else if ((adminPath || '/') === (playerPath === '/' ? '/' : playerPath.replace(/\/+$/, ''))) pathError = '后台管理路径与播放器路径不能相同';
        else if (adminPath.startsWith('/api') || playerPath.startsWith('/api')) pathError = '路径不能以 /api 开头（与 API 路由冲突）';
        if (errEl) {
            errEl.textContent = pathError;
            errEl.classList.toggle('show', !!pathError);
        }
        if (pathError) { if (!silent) showError('路径配置有误，请检查'); return; }

        const on = k => formData.get(k) === 'on';
        const config = {
            serverName: formData.get('serverName'),
            maxSnapshotNum: parseInt(formData.get('maxSnapshotNum')),
            'list.addMusicLocationType': formData.get('list.addMusicLocationType'),
            'proxy.enabled': on('proxy.enabled'),
            'proxy.header': formData.get('proxy.header'),
            'proxy.all.enabled': on('proxy.all.enabled'),
            'proxy.all.address': formData.get('proxy.all.address'),
            'user.enablePath': on('user.enablePath'),
            'user.enableRoot': on('user.enableRoot'),
            'user.enablePublicRestriction': on('user.enablePublicRestriction'),
            'user.enablePublicNonAdminLocalMusic': on('user.enablePublicNonAdminLocalMusic'),
            'user.enablePublicNonAdminBrowserDownload': on('user.enablePublicNonAdminBrowserDownload'),
            'user.enablePublicNonAdminServerCache': on('user.enablePublicNonAdminServerCache'),
            'user.enablePublicFavorites': on('user.enablePublicFavorites'),
            'user.enablePublicNonAdminAccess': on('user.enablePublicNonAdminAccess'),
            'user.enableCustomMusicDir': on('user.enableCustomMusicDir'),
            'user.enableLoginCacheRestriction': on('user.enableLoginCacheRestriction'),
            'user.enableCacheSizeLimit': on('user.enableCacheSizeLimit'),
            'user.cacheSizeLimit': parseInt(formData.get('user.cacheSizeLimit')) || 2000,
            'frontend.password': formData.get('frontend.password'),
            'player.enableAuth': on('player.enableAuth'),
            'player.password': formData.get('player.password'),
            'webdav.enable': on('webdav.enable'),
            'webdav.url': formData.get('webdav.url'),
            'webdav.username': formData.get('webdav.username'),
            'webdav.password': formData.get('webdav.password'),
            'webdav.syncPath': (formData.get('webdav.syncPath') || '').trim() || '/lx-sync',
            'webdav.backupPath': (formData.get('webdav.backupPath') || '').trim() || '/lx-sync-backups',
            'sync.interval': parseInt(formData.get('sync.interval')) || 60,
            'sync.backupInterval': parseInt(formData.get('sync.backupInterval')) || 24,
            'admin.path': adminPath,
            'player.path': playerPath,
            'subsonic.enable': on('subsonic.enable'),
            'subsonic.path': (formData.get('subsonic.path') || '').trim() || '/rest',
            'subsonic.enableDebug': on('subsonic.enableDebug'),
            'subsonic.onlineSearch': on('subsonic.onlineSearch'),
            'subsonic.onlineSearchMode': formData.get('subsonic.onlineSearchMode') || 'fallback',
            'subsonic.onlineSearchSources': (formData.get('subsonic.onlineSearchSources') || '').trim() || 'wy,tx,kw,kg,mg',
            'subsonic.lyricTranslation': on('subsonic.lyricTranslation'),
            'singer.sourcePriority': formData.get('singer.sourcePriority'),
            'system.allowUnsafeVM': on('system.allowUnsafeVM'),
        };

        try {
            const res = await this.request('/api/config', { method: 'POST', body: JSON.stringify(config) });
            if (config['frontend.password'] && config['frontend.password'] !== this.password) {
                this.password = config['frontend.password'];
                localStorage.setItem('lx_auth', config['frontend.password']);
            }
            const navPlayerLink = document.getElementById('nav-player-link');
            if (navPlayerLink) navPlayerLink.href = playerPath === '' ? '/' : playerPath;
            if (!silent) {
                if (res.warning) showInfo('配置保存成功！\n\n警告：' + res.warning);
                else showSuccess('配置保存成功');
            }
        } catch (err) {
            if (!silent) showError('配置保存失败: ' + err.message);
            throw err;
        }
    }

    /* ================= 日志 ================= */
    async loadLogs() {
        try {
            const data = await this.request(`/api/logs?type=${this.currentLogType}&lines=200`);
            const container = document.getElementById('logs-content');
            if (data.logs && data.logs.length) {
                container.innerHTML = data.logs
                    .filter(line => line.trim())
                    .map(line => {
                        const esc = this.escapeHtml(line);
                        // 识别常见日志级别
                        let m = esc.match(/^\[?(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)]?/);
                        let rest = esc, t = '';
                        if (m) { t = `<span class="t">${m[1]}</span>`; rest = esc.slice(m[0].length); }
                        let lv = '';
                        const lm = rest.match(/\[(INFO|WARN|ERROR|DEBUG|SYNC)\]|(^|\s)(INFO|WARN|ERROR)\b/);
                        if (lm) {
                            const tag = (lm[1] || lm[3]).toUpperCase();
                            const cls = tag === 'ERROR' ? 'e' : tag === 'WARN' ? 'w' : tag === 'SYNC' ? 's' : 'i';
                            lv = `<span class="lv ${cls}">${tag}</span>`;
                            rest = rest.replace(lm[0], (lm[2] || '') + '\x00').replace('\x00', '');
                        }
                        return `<div>${t}${lv}<span class="m">${rest.trim() || ' '}</span></div>`;
                    }).join('');
                container.scrollTop = container.scrollHeight;
            } else {
                container.innerHTML = '<p style="color:var(--muted)">暂无日志</p>';
            }
        } catch (err) {
            document.getElementById('logs-content').innerHTML = '<p style="color:var(--red)">加载日志失败</p>';
        }
    }

    toggleLogTypeDropdown() {
        document.getElementById('log-type-menu')?.classList.toggle('hidden');
    }

    selectLogType(v) {
        this.currentLogType = v;
        document.getElementById('log-type-label').textContent = {
            app: '应用日志', access: '访问日志', login: '登录日志', token: 'Token 日志', errors: '错误日志'
        }[v] || v;
        document.querySelectorAll('#log-type-menu .usel-item').forEach(i => i.classList.toggle('on', i.dataset.v === v));
        document.getElementById('log-type-menu').classList.add('hidden');
        this.loadLogs();
    }

    /* ================= WebDAV ================= */
    async testWebDAV() {
        try {
            const result = await this.request('/api/webdav/test', { method: 'POST' });
            if (result.success) showSuccess('WebDAV 连接成功\n' + (result.message || ''));
            else showError('WebDAV 连接失败\n' + (result.message || ''));
        } catch (err) { showError('连接失败: ' + err.message); }
    }

    async testProxy() {
        const address = document.querySelector('input[name="proxy.all.address"]').value;
        if (!address) { showInfo('请输入代理地址'); return; }
        showInfo('正在测试代理，请稍候...');
        try {
            const result = await this.request('/api/config/test-proxy', { method: 'POST', body: JSON.stringify({ address }) });
            if (result.success) showSuccess(result.message);
            else showError(result.message);
        } catch (err) { showError('测试失败: ' + err.message); }
    }

    async backupToWebDAV() {
        if (!(await showSelect('WebDAV 备份', '确定要创建全量备份并上传到 WebDAV 吗？'))) return;
        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color:var(--amber)">正在备份...</p>';
        this.showProgress(true);
        try {
            const result = await this.request('/api/webdav/backup', { method: 'POST', body: JSON.stringify({ force: true }) });
            if (result.success) {
                statusEl.innerHTML = '<p style="color:var(--green)">备份成功</p>';
                this.loadSyncLogs();
            } else {
                statusEl.innerHTML = '<p style="color:var(--red)">备份失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color:var(--red)">备份失败: ' + this.escapeHtml(err.message) + '</p>';
        } finally {
            setTimeout(() => this.showProgress(false), 3000);
        }
    }

    async restoreFromWebDAV() {
        if (!(await showSelect('WebDAV 恢复', '警告：从云端恢复将覆盖本地所有数据！\n\n确定要继续吗？', { danger: true }))) return;
        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color:var(--amber)">正在从云端恢复数据...</p>';
        try {
            const result = await this.request('/api/webdav/restore', { method: 'POST' });
            if (result.success) {
                statusEl.innerHTML = '<p style="color:var(--green)">恢复成功！页面将刷新...</p>';
                setTimeout(() => location.reload(), 2000);
            } else {
                statusEl.innerHTML = '<p style="color:var(--red)">恢复失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color:var(--red)">恢复失败: ' + this.escapeHtml(err.message) + '</p>';
        }
    }

    async syncFilesToWebDAV() {
        if (!(await showSelect('同步文件', '确定要强制同步所有文件到 WebDAV 吗？'))) return;
        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color:var(--amber)">正在同步文件...</p>';
        this.showProgress(true);
        try {
            const result = await this.request('/api/webdav/sync', { method: 'POST' });
            if (result.success) {
                statusEl.innerHTML = '<p style="color:var(--green)">同步成功</p>';
                this.loadSyncLogs();
            } else {
                statusEl.innerHTML = '<p style="color:var(--red)">同步失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color:var(--red)">同步失败: ' + this.escapeHtml(err.message) + '</p>';
        } finally {
            setTimeout(() => this.showProgress(false), 3000);
        }
    }

    showProgress(show) {
        const container = document.getElementById('sync-progress-container');
        container?.classList.toggle('show', show);
        if (show) this.updateProgress(0, '准备中...');
    }

    updateProgress(percent, text) {
        const bar = document.getElementById('progress-bar');
        const textEl = document.getElementById('progress-text');
        const percentEl = document.getElementById('progress-percent');
        if (bar) bar.style.width = `${percent}%`;
        if (textEl) textEl.textContent = text;
        if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    }

    initSSE() {
        if (this.sseSource) return;
        const auth = this.password || localStorage.getItem('lx_auth');
        if (!auth) return;
        this.sseSource = new EventSource(`/api/webdav/progress?auth=${encodeURIComponent(auth)}`);
        this.sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'backup') {
                    if (data.status === 'uploading') this.updateProgress((data.current / data.total) * 100, `正在上传备份: ${this.formatFileSize(data.current)} / ${this.formatFileSize(data.total)}`);
                    else if (data.status === 'packing') this.updateProgress(5, data.message || '正在打包文件...');
                    else if (data.status === 'preparing') this.updateProgress(0, data.message);
                    else if (data.status === 'success') this.updateProgress(100, '备份上传完成');
                } else if (data.type === 'sync') {
                    if (data.status === 'processing') this.updateProgress((data.current / data.total) * 100, `正在同步文件 (${data.current}/${data.total}): ${data.file}`);
                    else if (data.status === 'finish') this.updateProgress(100, '文件同步完成');
                } else if (data.type === 'restore') {
                    if (data.status === 'processing') this.updateProgress((data.current / data.total) * 100, `正在恢复文件 (${data.current}/${data.total}): ${data.file}`);
                    else if (data.status === 'downloading') this.updateProgress(30, data.message || '正在下载备份...');
                    else if (data.status === 'extracting') this.updateProgress(70, data.message || '正在解压备份...');
                    else if (data.status === 'start') this.updateProgress(0, data.message || '正在从云端恢复数据...');
                    else if (data.status === 'finish') this.updateProgress(100, data.message || '数据恢复完成');
                    else if (data.status === 'error') this.updateProgress(0, data.message || '恢复失败');
                }
            } catch (e) { /* ignore */ }
        };
        this.sseSource.onerror = () => { /* 静默重试 */ };
    }

    async loadSyncLogs() {
        try {
            const data = await this.request('/api/webdav/logs');
            const container = document.getElementById('sync-logs-content');
            if (!data.logs || !data.logs.length) {
                container.innerHTML = '<p style="color:var(--muted);padding:1rem;text-align:center">暂无同步日志</p>';
                return;
            }
            const types = { upload: '上传', download: '下载', backup: '备份', restore: '恢复' };
            container.innerHTML = data.logs.map(log => `
                <div class="sync-log-item">
                    <div>
                        <span class="badge ${log.status === 'success' ? 'ok' : 'err'}">${types[log.type] || log.type}</span>
                        <span class="file" style="margin-left:8px">${this.escapeHtml(log.file || '')}</span>
                        ${log.message ? `<div class="msg">${this.escapeHtml(log.message)}</div>` : ''}
                    </div>
                    <div class="r">
                        <span style="font-size:10.5px;color:${log.status === 'success' ? 'var(--green)' : 'var(--red)'}">${log.status === 'success' ? '成功' : '失败'}</span>
                        <span class="tm">${this.formatTime(log.timestamp)}</span>
                    </div>
                </div>`).join('');
        } catch (err) {
            console.error('Failed to load sync logs:', err);
        }
    }

    checkWebDAVConfig(isConfigured) {
        document.getElementById('webdav-cloud-group')?.classList.toggle('hidden', !isConfigured);
        document.getElementById('webdav-logs-section')?.classList.toggle('hidden', !isConfigured);
        document.getElementById('webdav-config-guide')?.classList.toggle('hidden', isConfigured);
        const sev = document.getElementById('webdav-sev');
        const line = document.getElementById('webdav-state-line');
        if (sev) sev.className = 'sev' + (isConfigured ? '' : ' warn');
        if (line) line.textContent = isConfigured ? '已配置云端同步' : '未配置';
        if (isConfigured) {
            this.request('/api/config').then(cfg => {
                const hint = document.getElementById('webdav-host-hint');
                if (hint && cfg['webdav.url']) {
                    try { hint.textContent = new URL(cfg['webdav.url']).host; } catch (e) { hint.textContent = ''; }
                }
            }).catch(() => { });
        }
    }

    jumpToWebDAVConfig() {
        this.switchView('config');
        setTimeout(() => {
            document.querySelectorAll('.ctab').forEach(t => t.classList.remove('on'));
            const tab = document.querySelector('.ctab[data-t="t4"]');
            tab?.classList.add('on');
            document.querySelectorAll('.cpane').forEach(p => p.classList.remove('on'));
            document.getElementById('t4')?.classList.add('on');
            // 滚动到 WebDAV 卡片
            const cards = document.querySelectorAll('#t4 .cfg');
            cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
    }

    getLogTypeText(type) {
        return { upload: '上传', download: '下载', backup: '备份', restore: '恢复' }[type] || type;
    }

    /* ================= 文件管理 ================= */
    currentPath = '';

    async loadFiles(path = '') {
        this.currentPath = path;
        try {
            const data = await this.request(`/api/files?path=${encodeURIComponent(path)}`);
            this.renderFileList(data.items || []);
            this.updateBreadcrumb(path);
        } catch (err) {
            document.getElementById('file-items').innerHTML = '<p style="padding:2rem;text-align:center;color:var(--red)">加载文件失败</p>';
        }
    }

    renderFileList(items) {
        const container = document.getElementById('file-items');
        if (!items.length) {
            container.innerHTML = '<div class="empty-state" style="padding:32px">此文件夹为空</div>';
            return;
        }
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        container.innerHTML = items.map(item => `
            <div class="trow fm-row">
                <span class="song-cell-name" style="cursor:pointer" onclick="app.${item.isDirectory ? `loadFiles('${this.escapeJs(item.path)}')` : `viewFile('${this.escapeJs(item.path)}')`}">
                    <svg class="ic" style="color:${item.isDirectory ? 'var(--blue)' : 'var(--muted)'}"><use href="#${item.isDirectory ? 'i-folder' : 'i-file'}"/></svg>
                    <span class="song-name">${this.escapeHtml(item.name)}</span>
                </span>
                <span style="color:var(--muted)">${item.isDirectory ? '—' : this.formatFileSize(item.size)}</span>
                <span style="color:var(--muted);font-size:11px">${this.formatDate(item.mtime)}</span>
                <span>${item.isDirectory ? '<span class="badge">文件夹</span>' : '<span class="badge">文件</span>'}</span>
                <span class="row-acts">
                    ${!item.isDirectory ? `<button class="mini" onclick="app.editFile('${this.escapeJs(item.path)}')">编辑</button>` : ''}
                    <button class="mini" onclick="app.downloadFile('${this.escapeJs(item.path)}')"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-down"/></svg></button>
                    <button class="mini danger" onclick="app.deleteFile('${this.escapeJs(item.path)}', ${item.isDirectory})"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>
                </span>
            </div>`).join('');
    }

    updateBreadcrumb(path) {
        const el = document.getElementById('file-breadcrumb');
        const parts = path ? path.split('/').filter(Boolean) : [];
        let html = '<span class="crumb-link" onclick="app.loadFiles(\'\')">根目录</span>';
        let cur = '';
        parts.forEach(part => {
            cur = cur ? `${cur}/${part}` : part;
            html += `<span class="crumb-sep">/</span><span class="crumb-link" onclick="app.loadFiles('${this.escapeJs(cur)}')">${this.escapeHtml(part)}</span>`;
        });
        el.innerHTML = html;
    }

    async createNewFile() {
        const filename = await showInput('创建文件', '请输入文件名：');
        if (!filename) return;
        const path = this.currentPath ? `${this.currentPath}/${filename}` : filename;
        try {
            await this.request('/api/files', { method: 'POST', body: JSON.stringify({ path, content: '', isDirectory: false }) });
            this.loadFiles(this.currentPath);
            showSuccess('文件创建成功');
        } catch (err) { showError('创建文件失败: ' + err.message); }
    }

    async createNewFolder() {
        const foldername = await showInput('创建文件夹', '请输入文件夹名：');
        if (!foldername) return;
        const path = this.currentPath ? `${this.currentPath}/${foldername}` : foldername;
        try {
            await this.request('/api/files', { method: 'POST', body: JSON.stringify({ path, isDirectory: true }) });
            this.loadFiles(this.currentPath);
            showSuccess('文件夹创建成功');
        } catch (err) { showError('创建文件夹失败: ' + err.message); }
    }

    async editFile(filePath) {
        const newContent = await showInput('编辑文件', '输入新内容后点击确定（简易编辑器）：', { defaultValue: '' });
        if (newContent === null) return;
        try {
            await this.request('/api/files', { method: 'PUT', body: JSON.stringify({ path: filePath, content: newContent }) });
            showSuccess('保存成功');
        } catch (err) { showError('保存失败: ' + err.message); }
    }

    viewFile(filePath) {
        showInfo('文件查看：' + filePath + '\n\n可通过下载按钮下载文件后查看');
    }

    async downloadFile(filePath) {
        const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop();
        a.click();
    }

    async deleteFile(filePath, isDirectory) {
        const type = isDirectory ? '文件夹' : '文件';
        if (!(await showSelect('删除文件', `确定要删除${type} "${filePath}" 吗？${isDirectory ? '\n\n警告：文件夹内的所有内容也会被删除！' : ''}`, { danger: true }))) return;
        try {
            await this.request('/api/files', { method: 'DELETE', body: JSON.stringify({ path: filePath }) });
            this.loadFiles(this.currentPath);
            showSuccess('删除成功');
        } catch (err) { showError('删除失败: ' + err.message); }
    }

    /* ================= 音源管理(后台完整管理, 播放器端只读) ================= */
    async loadCsList() {
        const container = document.getElementById('cs-list');
        try {
            const list = await this.request('/api/custom-source/list');
            if (!list.length) {
                container.innerHTML = '<div class="empty-state">暂无服务器音源<br><button class="pill" onclick="document.getElementById(\'cs-url-btn\').click()"><svg class="ic"><use href="#i-plus"/></svg> 添加第一个音源</button></div>';
                return;
            }
            const SRC = { tx: 'QQ', wy: '网易', kw: '酷我', kg: '酷狗', mg: '咪咕', git: 'Git' };
            container.innerHTML = list.map(cs => `
                <div class="trow users-row" style="grid-template-columns:2.4fr 1fr 1fr .6fr 1.4fr">
                    <span><b>${this.escapeHtml(cs.name)}</b><div class="u-sub">${this.escapeHtml(cs.author || '')}${cs.description ? ' · ' + this.escapeHtml(cs.description.slice(0, 30)) : ''}</div></span>
                    <span>${this.escapeHtml(cs.version || '-')}</span>
                    <span style="font-size:11px;color:var(--text2)">${(cs.supportedSources || []).map(x => SRC[x] || x).join(' ')}</span>
                    <span><div class="cswitch ${cs.enabled ? 'on' : ''}" title="${cs.enabled ? '点击停用' : '点击启用'}" onclick="app.csToggle('${this.escapeJs(cs.id)}', ${!cs.enabled})"><div class="knob"></div></div></span>
                    <span class="row-acts">
                        <button class="mini danger" onclick="app.csDelete('${this.escapeJs(cs.id)}', '${this.escapeJs(cs.name)}')"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg> 删除</button>
                    </span>
                </div>`).join('');
        } catch (err) {
            container.innerHTML = '<div class="empty-state">加载失败: ' + this.escapeHtml(err.message) + '</div>';
        }
    }

    async csToggle(id, enabled) {
        try {
            await this.request('/api/custom-source/toggle', {
                method: 'POST',
                body: JSON.stringify({ id, enabled })
            });
            showSuccess(enabled ? '已启用' : '已停用');
            this.loadCsList();
        } catch (err) { showError('操作失败: ' + err.message); }
    }

    async csDelete(id, name) {
        if (!(await showSelect('删除音源', `确定要删除「${name}」吗？所有端将不再可用。`, { danger: true }))) return;
        try {
            await this.request('/api/custom-source/delete', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            showSuccess('已删除');
            this.loadCsList();
        } catch (err) { showError('删除失败: ' + err.message); }
    }

    async csAddUrl() {
        const url = await showInput('URL 添加音源', '音源脚本 URL(共享,全端可用)：');
        if (!url) return;
        try {
            await this.request('/api/custom-source/upload', {
                method: 'POST',
                body: JSON.stringify({ url })
            });
            showSuccess('已上传为共享音源');
            this.loadCsList();
        } catch (err) { showError('添加失败: ' + err.message); }
    }

    async handleCsUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        try {
            const content = await file.text();
            await this.request('/api/custom-source/upload', {
                method: 'POST',
                body: JSON.stringify({ filename: file.name, content })
            });
            showSuccess('已上传: ' + file.name);
            this.loadCsList();
        } catch (err) { showError('上传失败: ' + err.message); }
    }

    /* ================= 快照 ================= */
    async loadSnapshots() {
        const username = document.getElementById('snapshot-user-select')?.value;
        const container = document.getElementById('snapshots-list');
        if (!username) { this.renderUserGrid('snapshot'); return; }
        try {
            const list = await this.request(`/api/data/snapshots?user=${encodeURIComponent(username)}`);
            if (!list.length) {
                container.innerHTML = '<div class="empty-state">还没有快照<br><button class="pill" onclick="app.showCreateSnapshotHint()"><svg class="ic"><use href="#i-snap"/></svg> 创建第一份快照</button></div>';
                return;
            }
            container.innerHTML = list.map(item => `
                <div class="trow snap-row">
                    <span><b>snapshot_${this.escapeHtml(String(item.id))}</b><div class="u-sub">${new Date(item.time).toLocaleString('zh-CN')}</div></span>
                    <span>${this.formatFileSize(item.size)}</span>
                    <span><span class="badge ok">快照</span></span>
                    <span class="row-acts">
                        <button class="mini" onclick="app.downloadSnapshot('${this.escapeJs(item.id)}')"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-down"/></svg> 下载</button>
                        <button class="mini" onclick="app.restoreSnapshot('${this.escapeJs(item.id)}')"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-refresh"/></svg> 回滚</button>
                        <button class="mini danger" onclick="app.deleteSnapshot('${this.escapeJs(item.id)}')"><svg class="mbtn-ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg> 删除</button>
                    </span>
                </div>`).join('');
        } catch (err) {
            showError('加载快照列表失败: ' + err.message);
        }
    }

    showCreateSnapshotHint() {
        showInfo('快照由客户端同步或服务器自动创建\n也可在客户端执行「备份数据」生成快照');
    }

    triggerUploadSnapshot() {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) { showInfo('请先选择用户'); return; }
        document.getElementById('snapshot-upload-input').click();
    }

    async handleSnapshotUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) return;
        event.target.value = '';
        try {
            const content = await file.text();
            const response = await fetch(`/api/data/upload-snapshot?user=${encodeURIComponent(username)}&time=${file.lastModified}&filename=${encodeURIComponent(file.name)}`, {
                method: 'POST',
                headers: { 'X-Frontend-Auth': this.password },
                body: content
            });
            if (!response.ok) throw new Error(await response.text() || 'Upload failed');
            showSuccess('上传成功');
            this.loadSnapshots();
        } catch (err) {
            showError('上传失败: ' + err.message);
        }
    }

    async deleteSnapshot(id) {
        if (!(await showSelect('删除快照', '确定要删除这个快照吗？', { danger: true }))) return;
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) return;
        try {
            const response = await fetch(`/api/data/delete-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Frontend-Auth': this.password },
                body: JSON.stringify({ id })
            });
            if (!response.ok) throw new Error(await response.text() || 'Delete failed');
            this.loadSnapshots();
            showSuccess('删除成功');
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    async downloadSnapshot(id) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) { showInfo('请先选择用户'); return; }
        try {
            const data = await this.request(`/api/data/snapshot?id=${id}&user=${encodeURIComponent(username)}`);
            const backupData = {
                type: 'playList_v2',
                data: [
                    { id: 'default', name: 'list__name_default', list: data.defaultList || [] },
                    { id: 'love', name: 'list__name_love', list: data.loveList || [] },
                    ...(data.userList || []),
                ],
            };
            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lx_backup_${username}_${String(id).substring(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            showError('导出快照失败: ' + err.message);
        }
    }

    async restoreSnapshot(id) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) { showInfo('请先选择用户'); return; }
        if (!(await showSelect('回滚快照', '警告：此操作将把服务器数据回滚到选定的快照状态！\n\n1. 当前所有未保存的更改将丢失。\n2. 所有客户端的同步状态将被重置。\n3. 客户端连接后，请务必选择【远程覆盖本地】以获取回滚后的数据。\n\n确定要继续吗？', { danger: true }))) return;
        try {
            await this.request(`/api/data/restore-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            showSuccess('回滚成功！请重启客户端或重新连接同步服务。');
            this.loadDashboard();
        } catch (err) {
            showError('回滚失败: ' + err.message);
        }
    }

    /* ================= 本地备份 ================= */
    async downloadLocalBackup() {
        if (!(await showSelect('本地备份', '确定要创建并下载本地全量 ZIP 备份吗？\n\n这可能需要一些时间，取决于数据量。'))) return;
        try {
            const url = `/api/backup/download?auth=${encodeURIComponent(this.password)}`;
            const a = document.createElement('a');
            a.href = url;
            a.download = `lx-sync-backup-local-${new Date().toISOString().split('T')[0]}.zip`;
            a.click();
        } catch (err) {
            showError('下载本地备份失败: ' + err.message);
        }
    }

    async handleLocalRestore(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (!(await showSelect('还原数据', '确定要从上传的 ZIP 文件还原数据吗？\n\n警告：这将覆盖当前的服务器所有数据！\n强烈建议在还原前先手动下载一个本地备份。操作不可撤销。', { danger: true }))) {
            event.target.value = '';
            return;
        }
        const formData = new FormData();
        formData.append('backup', file);
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'restore-overlay';
        loadingOverlay.innerHTML = `<div class="glass restore-box"><div class="spin"></div><h2>正在还原数据...</h2><p>正在解压并恢复文件，请勿关闭或刷新页面。</p></div>`;
        document.body.appendChild(loadingOverlay);
        try {
            const response = await fetch('/api/backup/upload', {
                method: 'POST',
                headers: { 'X-Frontend-Auth': this.password },
                body: formData
            });
            if (!response.ok) throw new Error(await response.text() || 'Restore failed');
            showSuccess('还原成功！数据已更新，页面将立即刷新。');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            showError('本地还原失败: ' + err.message);
            loadingOverlay.remove();
        } finally {
            event.target.value = '';
        }
    }

    async restartServer() {
        if (!(await showSelect('重启服务器', '确定要重启服务器吗？\n\n重启后所有连接的客户端将断开，大约需要几秒钟时间。', { danger: true }))) return;
        try {
            const result = await this.request('/api/restart', { method: 'POST' });
            if (result.success) {
                showSuccess('服务器正在重启，请稍候...\n\n页面将在 5 秒后自动刷新。');
                setTimeout(() => window.location.reload(), 5000);
            } else {
                showError('重启失败: ' + (result.message || '未知错误'));
            }
        } catch (err) {
            showError('重启请求失败: ' + err.message);
        }
    }

    /* ================= 关于 ================= */
    async loadAbout() {
        const container = document.getElementById('about-content');
        if (!container) return;
        const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
        const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
        document.getElementById('about-version').textContent = version;
        document.getElementById('about-build').textContent = buildHash;
        try {
            const response = await fetch('/about.md');
            if (!response.ok) throw new Error('failed');
            const text = await response.text();
            if (window.marked) {
                let content = text.replace(/{{version}}/g, version).replace(/{{buildHash}}/g, buildHash);
                container.innerHTML = window.marked.parse(content);
            } else {
                container.innerText = text;
            }
        } catch (e) {
            container.innerHTML = '<p style="color:var(--red);text-align:center">加载关于页面失败</p>';
        }
    }

    checkForUpdates() {
        if (window.LxNotification && window.LxNotification.checkUpdates) {
            window.LxNotification.checkUpdates(true);
        } else {
            showInfo('通知服务未就绪，请稍后重试');
        }
    }

    initVersion() {
        if (window.CONFIG?.version) {
            const el = document.getElementById('sidebar-version');
            if (el) el.textContent = `NextMusic Server · ${window.CONFIG.version}`;
        }
        const navPlayerLink = document.getElementById('nav-player-link');
        if (navPlayerLink && window.CONFIG?.['player.path']) {
            navPlayerLink.href = window.CONFIG['player.path'];
        }
    }

    /* ================= 通用 ================= */
    async request(url, options = {}) {
        const response = await fetch(API_BASE + url, {
            headers: { 'Content-Type': 'application/json', 'X-Frontend-Auth': this.password },
            ...options
        });
        if (response.status === 401) {
            this.logout();
            throw new Error('Unauthorized');
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Request failed');
        }
        return response.json();
    }

    formatFileSize(bytes) {
        if (bytes == null) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    formatDate(timestamp) {
        if (!timestamp) return '-';
        return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;
        if (diff < minute) return '刚刚';
        if (diff < hour) return Math.floor(diff / minute) + '分钟前';
        if (diff < day) return Math.floor(diff / hour) + '小时前';
        return new Date(timestamp).toLocaleString('zh-CN');
    }

    formatUptime(seconds) {
        if (!seconds) return '0m';
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(`${d}天`);
        if (h > 0) parts.push(`${h}小时`);
        if (m > 0) parts.push(`${m}分`);
        if (!parts.length) parts.push('0分');
        return parts.join(' ');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    escapeJs(text) {
        return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '');
    }

    bindWebDAVEvents() {
        document.getElementById('test-webdav-btn')?.addEventListener('click', () => this.testWebDAV());
        document.getElementById('backup-webdav-btn')?.addEventListener('click', () => this.backupToWebDAV());
        document.getElementById('restore-webdav-btn')?.addEventListener('click', () => this.restoreFromWebDAV());
        document.getElementById('sync-files-btn')?.addEventListener('click', () => this.syncFilesToWebDAV());
        document.getElementById('sync-files-btn2')?.addEventListener('click', () => this.syncFilesToWebDAV());
        document.getElementById('refresh-sync-logs-btn')?.addEventListener('click', () => this.loadSyncLogs());
        document.getElementById('test-proxy-btn')?.addEventListener('click', () => this.testProxy());
        document.getElementById('backup-local-btn')?.addEventListener('click', () => this.downloadLocalBackup());
        document.getElementById('restore-local-btn')?.addEventListener('click', () => document.getElementById('local-backup-input')?.click());
        document.getElementById('local-backup-input')?.addEventListener('change', (e) => this.handleLocalRestore(e));
        this.initSSE();
    }

    bindFileManagerEvents() {
        document.getElementById('new-file-btn')?.addEventListener('click', () => this.createNewFile());
        document.getElementById('new-folder-btn')?.addEventListener('click', () => this.createNewFolder());
        document.getElementById('refresh-files-btn')?.addEventListener('click', () => this.loadFiles(this.currentPath));
    }
}

const app = new App();
