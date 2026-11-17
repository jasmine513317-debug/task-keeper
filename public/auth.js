// 邮箱 + 密码账号。不登录也能在本机使用；登录只是打开云端同步。
(() => {
  const markerKey = 'task-keeper-account';
  const metaKey = 'task-keeper-cloud-v1';
  let user = null, notice = '', busy = false, lastEmail = '';

  const read = (key, fallback = '') => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  // 每个密码框旁都给一个「显示」开关，手机上打错字看不见很难受。
  const revealBtn = '<button type="button" class="reveal" data-reveal aria-pressed="false" aria-label="显示密码">显示</button>';
  const pwField = (label, input) => `<label class="field">${label}<span class="pw">${input}${revealBtn}</span></label>`;

  function toggleReveal(btn) {
    const input = btn.parentElement.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    const caret = input.value.length;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch {}
  }

  const owner = () => read(markerKey);
  // The local copy belongs to one account. Switching accounts without clearing it would push
  // the previous owner's tasks into the new account's cloud space.
  const clash = () => !!user && owner() !== user.id && state.tasks.length > 0;
  const forgetDevice = () => {
    try { localStorage.removeItem(KEY); localStorage.removeItem(metaKey); sessionStorage.removeItem('task-keeper-draft'); } catch {}
  };

  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Task-Keeper': 'auth-v1' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function afterSignIn(next) {
    user = next; lastEmail = next.email; notice = '';
    if (!owner() || owner() === next.id) write(markerKey, next.id);
    render();
    if (clash()) return accountClash();
    window.syncTaskCloud?.();
  }

  function accountClash() {
    openDialog(`<h2>本机记录属于另一个账号</h2>
<p class="muted">这台设备上的事项是在别的账号下积累的，继续同步会把它们并入 ${esc(user.email)}。</p>
<p class="muted small">如需保留，请先导出备份，之后可在“我的 → 恢复 JSON 备份”中合并。</p>
<div class="actions">
<button class="ghost" data-guard-export>导出本机备份</button>
<button class="ghost danger" data-guard-wipe>清空本机，使用新账号</button>
<button class="primary" data-guard-stay>退出新账号，保留本机数据</button>
</div>`);
  }

  function accountCard() {
    const summary = user ? `已登录 · ${esc(user.email)}${user.isAdmin ? ' · 管理员' : ''}` : '未登录，数据只保存在本机';
    const actions = user
      ? `<div class="actions"><button class="ghost" data-change-password>修改密码</button>${user.isAdmin ? '<button class="ghost" data-admin-reset>重置他人密码</button>' : ''}<button class="ghost danger" data-logout>退出登录</button></div>`
      : `<div class="actions"><button class="primary" data-signin>登录</button><button class="ghost" data-register>注册新账号</button></div>`;
    return `<h2>账号与同步</h2><p class="muted small">${summary}</p>${notice ? `<p class="error">${esc(notice)}</p>` : ''}${actions}<p class="muted small">忘记密码请联系站点管理员重置；重置后所有设备都需要重新登录。</p>`;
  }

  function paint() {
    const slot = $('#auth-slot');
    if (slot) slot.innerHTML = accountCard();
    const chip = $('#auth-entry');
    if (chip) {
      chip.hidden = false;
      chip.textContent = user ? (user.email.split('@')[0] || '已登录') : '登录';
      chip.title = user ? `已登录 · ${user.email}${user.isAdmin ? ' · 管理员' : ''}` : '登录或注册账号，开启跨设备同步';
    }
  }

  function authEntry() {
    if (!user) return authForm('login');
    openDialog(`<div class="split"><h2>当前账号</h2><button type="button" class="ghost" data-close aria-label="关闭">关闭</button></div>
<p class="muted">${esc(user.email)}${user.isAdmin ? ' · 管理员' : ''}</p>
<p class="muted small">${esc(window.TaskCloud && window.TaskCloud.label || '正在确认云端状态')}。修改密码、重置他人密码在「我的 → 账号与同步」。</p>
<div class="actions"><button class="ghost" data-sync-now>立即同步</button><button class="ghost" data-goto-account>账号设置</button><button class="ghost danger" data-logout>退出登录</button></div>`);
  }

  function authForm(mode) {
    const register = mode === 'register';
    openDialog(`<form id="auth-form" data-mode="${mode}">
<div class="split"><h2>${register ? '注册新账号' : '登录任务管家'}</h2><button type="button" class="ghost" data-close aria-label="关闭">关闭</button></div>
<p class="muted small">${register ? '邮箱用于确认身份，不会公开显示。' : '登录后云端同步自动开启，本机数据不会删除。'}</p>
<label class="field">邮箱<input name="email" type="email" required maxlength="254" autocomplete="username" inputmode="email" placeholder="you@example.com" value="${esc(lastEmail)}"></label>
${pwField('密码', `<input name="password" type="password" required maxlength="200" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="至少 10 个字符">`)}
${register ? pwField('再输入一次密码', '<input name="confirm" type="password" required maxlength="200" autocomplete="new-password">') : ''}
<label hidden aria-hidden="true">网站<input name="website" tabindex="-1" autocomplete="off"></label>
<p class="error" id="auth-error" role="alert"></p>
<div class="actions"><button class="primary">${register ? '创建账号' : '登录'}</button><button type="button" class="ghost" data-auth-switch="${register ? 'login' : 'register'}">${register ? '已有账号，去登录' : '还没有账号，去注册'}</button><button type="button" class="ghost" data-forgot>忘记密码</button></div>
</form>`);
  }

  async function submitAuth(form) {
    if (busy) return false;
    const fields = Object.fromEntries(new FormData(form));
    const error = $('#auth-error');
    error.textContent = '';
    if (form.dataset.mode === 'register' && fields.password !== fields.confirm) { error.textContent = '两次输入的密码不一致'; return false; }
    busy = true;
    try {
      const result = await post(`${API_BASE}/auth/${form.dataset.mode === 'register' ? 'register' : 'login'}`, {
        email: String(fields.email).trim(), password: fields.password, website: fields.website,
      });
      if (!result.ok) {
        error.textContent = result.data.message || (result.status === 429 ? '尝试次数过多，请稍后再试' : '操作未能完成，请稍后再试');
        return false;
      }
      closeDialog();
      afterSignIn(result.data.user);
      toast(form.dataset.mode === 'register' ? '账号已创建，正在同步云端' : '已登录，正在同步云端');
      return true;
    } catch {
      error.textContent = '无法连接账号服务，请检查网络后重试';
      return false;
    } finally { busy = false; }
  }

  function passwordForm() {
    openDialog(`<form id="password-form"><div class="split"><h2>修改密码</h2><button type="button" class="ghost" data-close>关闭</button></div>
<p class="muted small">修改后所有设备上的登录都会失效，需要用新密码重新登录。</p>
${pwField('当前密码', '<input name="currentPassword" type="password" required maxlength="200" autocomplete="current-password">')}
${pwField('新密码', '<input name="newPassword" type="password" required maxlength="200" autocomplete="new-password" placeholder="至少 10 个字符">')}
${pwField('再输入一次新密码', '<input name="confirm" type="password" required maxlength="200" autocomplete="new-password">')}
<p class="error" id="auth-error" role="alert"></p>
<div class="actions"><button class="primary">更新密码</button><button type="button" class="ghost" data-close>取消</button></div></form>`);
  }

  function adminResetForm() {
    openDialog(`<form id="reset-form"><div class="split"><h2>重置他人密码</h2><button type="button" class="ghost" data-close>关闭</button></div>
<p class="muted small">仅管理员可用。请把新密码私下告知对方，并提醒其登录后立即修改。</p>
<label class="field">对方邮箱<input name="email" type="email" required maxlength="254" inputmode="email"></label>
${pwField('新密码', '<input name="newPassword" type="password" required maxlength="200" placeholder="至少 10 个字符">')}
<p class="error" id="auth-error" role="alert"></p>
<div class="actions"><button class="primary">设置新密码</button><button type="button" class="ghost" data-close>取消</button></div></form>`);
  }

  async function submitPassword(form) {
    if (busy) return false;
    const fields = Object.fromEntries(new FormData(form));
    const error = $('#auth-error');
    error.textContent = '';
    if (fields.newPassword !== fields.confirm) { error.textContent = '两次输入的新密码不一致'; return false; }
    busy = true;
    try {
      const result = await post(`${API_BASE}/auth/password`, { currentPassword: fields.currentPassword, newPassword: fields.newPassword });
      if (!result.ok) { error.textContent = result.data.message || '密码未能更新'; return false; }
      user = null;
      closeDialog(); render();
      toast('密码已更新，请用新密码重新登录');
      return true;
    } catch {
      error.textContent = '无法连接账号服务，请稍后再试';
      return false;
    } finally { busy = false; }
  }

  async function submitReset(form) {
    if (busy) return false;
    const fields = Object.fromEntries(new FormData(form));
    const error = $('#auth-error');
    error.textContent = '';
    busy = true;
    try {
      const result = await post(`${API_BASE}/auth/admin/reset`, { email: String(fields.email).trim(), newPassword: fields.newPassword });
      if (!result.ok) { error.textContent = result.data.message || '重置未能完成'; return false; }
      closeDialog();
      toast(result.data.message || '已设置新密码');
      return true;
    } catch {
      error.textContent = '无法连接账号服务，请稍后再试';
      return false;
    } finally { busy = false; }
  }

  async function logout() {
    try { await post(`${API_BASE}/auth/logout`, {}); } catch {}
    user = null; notice = '';
    closeDialog();
    render();
    window.paintTaskCloud?.();
    toast('已退出登录，云端同步已停止');
  }

  async function probe() {
    try {
      const response = await fetch(`${API_BASE}/auth/session`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.user?.id) {
        if (!owner()) write(markerKey, data.user.id);
        user = { id: data.user.id, email: data.user.email || '', isAdmin: !!data.user.isAdmin };
        lastEmail = user.email;
      } else if (response.status === 503) {
        notice = '站点尚未配置账号服务，暂时无法登录。';
      }
    } catch { notice = '无法确认登录状态，请检查网络。'; }
    render();
    if (clash()) accountClash();
  }

  document.addEventListener('submit', e => {
    const form = e.target;
    if (form.id === 'auth-form') { e.preventDefault(); submitAuth(form); }
    if (form.id === 'password-form') { e.preventDefault(); submitPassword(form); }
    if (form.id === 'reset-form') { e.preventDefault(); submitReset(form); }
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('signin' in d) authForm('login');
    if ('register' in d) authForm('register');
    if (b.id === 'auth-entry') authEntry();
    if ('gotoAccount' in d) { closeDialog(); navigate('me'); }
    if (d.authSwitch) authForm(d.authSwitch);
    if ('forgot' in d) openDialog('<h2>忘记密码</h2><p class="muted">本站不发送重置邮件，也无法自助找回。请联系站点管理员（第一个注册的账号）为你设置新密码。</p><p class="muted small">设置完成后，该账号在所有设备上都需要重新登录。</p><div class="actions"><button class="primary" data-close>知道了</button></div>');
    if ('changePassword' in d) passwordForm();
    if ('reveal' in d) toggleReveal(b);
    if ('adminReset' in d) adminResetForm();
    if ('logout' in d) logout();
    if ('guardExport' in d) { download(JSON.stringify({ version: 2, ...state }, null, 2), 'task-keeper-backup-' + C.localDate() + '.json'); toast('已请求下载备份，请确认文件已保存'); }
    if ('guardWipe' in d) confirmDialog('清空本机数据？', '本机事项记录会被删除，随后从新账号的云端拉取。此操作无法撤销，建议先导出备份。', '确认清空', () => { forgetDevice(); write(markerKey, user.id); location.reload(); });
    if ('guardStay' in d) logout();
  });

  window.TaskAuth = { get user() { return user; }, get blocked() { return clash(); }, open: authForm, logout };

  const baseRender = render;
  render = function () { baseRender(); paint(); };
  probe();
})();
