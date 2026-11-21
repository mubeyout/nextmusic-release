/* Presentation and interaction helpers. Server APIs remain in app.js. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const names = {dashboard:'服务总览',users:'用户与数据',data:'音乐数据',sources:'音源管理',library:'曲库管理',webdav:'云端同步',snapshots:'快照备份',files:'文件管理',logs:'运行日志',config:'系统设置',about:'关于 NextMusic'};
    const form = $('config-form');
    let baseline = null;
    const fingerprint = () => JSON.stringify(Array.from(form.elements).filter(el=>el.name).map(el=>[el.name,el.type==='checkbox'?el.checked:el.value]));
    const dirty = () => baseline !== null && fingerprint() !== baseline;
    function updateSaveState() {
        const el = $('config-save-status'), changed = dirty();
        el.classList.toggle('dirty', changed);
        el.replaceChildren(Object.assign(document.createElement('i')),document.createTextNode(changed?'有未保存的更改':'配置已同步'));
        $('config-discard-btn').disabled = !changed;
    }
    function configSaved(){baseline=fingerprint();updateSaveState();}
    function dialog(title,message,options={}) {
        return new Promise(resolve=>{
            const previous=document.activeElement;
            const d=document.createElement('dialog');d.className='console-dialog';
            const heading=document.createElement('h3');heading.id='console-dialog-title';heading.textContent=title;
            d.setAttribute('aria-labelledby',heading.id);
            const p=document.createElement('p');p.textContent=message;d.append(heading,p);
            let input=null, checkbox=null;
            if(options.input){input=document.createElement(options.multiline?'textarea':'input');input.className='inp';input.value=options.defaultValue||'';input.setAttribute('aria-label',message);d.append(input);}
            if(options.deleteData){const label=document.createElement('label');label.className='delete-data-choice';checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='sel';label.append(checkbox,document.createTextNode('同时删除用户数据文件夹（不可恢复）'));d.append(label);}
            const actions=document.createElement('div');actions.className='dialog-actions';
            const cancel=document.createElement('button');cancel.className='pill ghost';cancel.textContent=options.cancelText||'取消';
            const ok=document.createElement('button');ok.className='pill'+(options.danger?' danger':'');ok.textContent=options.confirmText||(options.danger?'确认操作':'确定');
            actions.append(cancel,ok);d.append(actions);document.body.append(d);
            let settled=false;
            const finish=result=>{if(settled)return;settled=true;d.close();d.remove();previous?.focus();resolve(result);};
            cancel.onclick=()=>finish(options.deleteData?null:options.input?null:false);
            ok.onclick=()=>finish(options.deleteData?checkbox.checked:options.input?input.value:true);
            d.addEventListener('cancel',e=>{e.preventDefault();cancel.click();});
            d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cancel.click();}});
            input?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!options.multiline){e.preventDefault();ok.click();}});
            d.showModal();(input||cancel).focus();if(input)input.select();
        });
    }
    const canDiscard=async(restore=false)=>{if(!dirty())return true;const confirmed=await dialog('放弃未保存的更改？','当前配置尚未保存。离开或重新加载后，这些更改将丢失。',{confirmText:'放弃更改',cancelText:'继续编辑',danger:true});if(confirmed&&restore){await app.loadConfig();return app.configLoaded;}return confirmed;};
    window.NextConsole={configSaved,canDiscard,confirmDeleteData:message=>dialog('删除用户',message,{danger:true,deleteData:true,confirmText:'确认删除'}),viewChanged(view){
        $('console-page-name').textContent=names[view]||'管理控制台';document.title=`${names[view]||'管理控制台'} · NextMusic`;
        document.querySelectorAll('.nav-item[data-view]').forEach(a=>{if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    },connection(ok){
        const el=$('console-connection');el.className='connection-state '+(ok?'connected':'disconnected');el.querySelector('span').textContent=ok?'服务已连接':'连接中断';
        $('dash-run-state').textContent=ok?'服务运行中':'连接中断';
    }};
    const originalLoad=app.loadConfig.bind(app);
    app.loadConfig=async function(){this.configLoaded=false;form.inert=true;form.setAttribute('aria-busy','true');$('config-save-btn').disabled=true;try{await originalLoad();if(this.configLoaded)configSaved();else showError('配置加载失败，请重新加载后再编辑');}finally{form.inert=false;form.removeAttribute('aria-busy');$('config-save-btn').disabled=!this.configLoaded;}};
    // The constructor may already be loading the initial configuration.
    if(app.configLoaded)configSaved();
    const originalSave=app.saveConfig.bind(app);let saving=false;
    app.saveConfig=async function(silent=false){if(saving)return;saving=true;const b=$('config-save-btn');b.disabled=true;try{return await originalSave(silent);}catch(e){return false;}finally{saving=false;b.disabled=false;}};
    app.confirmDeleteData=message=>window.NextConsole.confirmDeleteData(message);
    form.addEventListener('input',updateSaveState);form.addEventListener('change',updateSaveState);
    window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
    const themeButton=$('console-theme');
    function updateTheme(){const dark=document.documentElement.dataset.theme==='dark';for(const b of document.querySelectorAll('[data-theme-control]')){b.setAttribute('aria-label',dark?'切换为浅色主题':'切换为深色主题');b.title=dark?'切换为浅色主题':'切换为深色主题';b.setAttribute('aria-pressed',String(dark));}}
    themeButton.dataset.themeControl='';
    const loginTheme=themeButton.cloneNode(true);loginTheme.id='login-theme';loginTheme.classList.add('login-theme');document.body.append(loginTheme);
    for(const b of [themeButton,loginTheme])b.addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('nextmusic-admin-theme',t);}catch(e){}updateTheme();});updateTheme();
    new MutationObserver(()=>loginTheme.classList.toggle('hidden',$('login-overlay').classList.contains('hidden'))).observe($('login-overlay'),{attributes:true,attributeFilter:['class']});
    loginTheme.classList.toggle('hidden',$('login-overlay').classList.contains('hidden'));
    $('overview-date').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
    document.querySelectorAll('.q').forEach(el=>{el.tabIndex=0;el.setAttribute('role','button');el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});});
    document.querySelectorAll('.field').forEach((field,i)=>{const label=field.querySelector('label'),input=field.querySelector('.inp');if(label&&input&&!label.htmlFor){if(!input.id)input.id='console-field-'+i;label.htmlFor=input.id;}});
    document.querySelectorAll('.sw-wrap input').forEach(input=>{const title=input.closest('.switch-row')?.querySelector('.t')?.textContent;if(title)input.setAttribute('aria-label',title);});
    // Match all existing destructive and input dialogs to the current theme.
    window.showSelect=(title,message,options={})=>dialog(title,message,options);
    window.showInput=(title,message,options={})=>dialog(title,message,{...options,input:true,multiline:title==='编辑文件'});
    const toasts=document.createElement('div');toasts.className='console-toasts';toasts.setAttribute('aria-live','polite');document.body.append(toasts);
    window.showToast=(type,message,duration=4000)=>{const card=document.createElement('div');card.className='console-toast '+type;card.setAttribute('role',type==='error'?'alert':'status');const icon=document.createElement('span');icon.className='toast-dot';icon.textContent=type==='success'?'✓':type==='error'?'!':'i';const text=document.createElement('span');text.textContent=message;card.append(icon,text);toasts.append(card);setTimeout(()=>card.remove(),duration);};
    window.showSuccess=message=>showToast('success',message);window.showInfo=message=>showToast('info',message);window.showError=message=>showToast('error',message,6000);
    // Existing edit dialogs also get keyboard dismissal, focus management and a close control.
    document.querySelectorAll('.modal').forEach(modal=>{
        const card=modal.querySelector('.modal-card');if(!card)return;
        card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.tabIndex=-1;
        const heading=card.querySelector('h3');if(heading){if(!heading.id)heading.id=modal.id+'-title';card.setAttribute('aria-labelledby',heading.id);}
        if(!card.querySelector('.console-close')){const b=document.createElement('button');b.type='button';b.className='console-close';b.textContent='×';b.setAttribute('aria-label','关闭对话框');b.onclick=()=>modal.classList.add('hidden');card.append(b);}
        let previous;
        new MutationObserver(()=>{if(!modal.classList.contains('hidden')){previous=document.activeElement;setTimeout(()=>{(card.querySelector('input:not([type=hidden]),textarea')||card).focus();},0);}else previous?.focus();}).observe(modal,{attributes:true,attributeFilter:['class']});
        modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();modal.classList.add('hidden');}if(e.key==='Tab'){const all=Array.from(card.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]')).filter(el=>el.getClientRects().length);if(!all.length)return;const first=all[0],last=all[all.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===card)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    });
    NextConsole.viewChanged(app.currentView);updateSaveState();
})();
