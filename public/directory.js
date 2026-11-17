// 事项目录：把已有的 分类 → 课程/项目 两个字段自动汇总成两级目录，点一下只看这一类。
// 不新增数据字段，所以旧快照、备份文件和云端 validState 校验都不用改。
(() => {
  const UNK = '—';
  const UNK_LABEL = '未归类';
  const ORDER = ['学习', '工作', '生活', '个人'];
  const drawer = () => document.querySelector('#dir-drawer');
  const live = t => t.status === 'todo' || t.status === 'pending';
  const late = t => t.status === 'todo' && !!t.due && C.dueTime(t.due) < Date.now();
  const label = v => v === UNK ? UNK_LABEL : v;

  function groups() {
    const map = new Map();
    for (const t of state.tasks.filter(live)) {
      const cat = t.category || UNK;
      if (!map.has(cat)) map.set(cat, { name: cat, total: 0, pending: 0, over: 0, courses: new Map() });
      const g = map.get(cat);
      g.total += 1;
      if (t.status === 'pending') g.pending += 1;
      if (late(t)) g.over += 1;
      const key = t.course || UNK;
      if (!g.courses.has(key)) g.courses.set(key, { name: key, total: 0, over: 0 });
      const c = g.courses.get(key);
      c.total += 1;
      if (late(t)) c.over += 1;
    }
    const rank = n => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; };
    return [...map.values()]
      .sort((a, b) => rank(a.name) - rank(b.name) || b.total - a.total || a.name.localeCompare(b.name))
      .map(g => ({ ...g, courses: [...g.courses.values()].sort((a, b) => (a.name === UNK) - (b.name === UNK) || b.total - a.total) }));
  }

  function node(kind, text, count, over, pending, cat, course, active) {
    return `<button class="dir-node ${kind}${active ? ' active' : ''}" data-cat="${esc(cat)}" data-course="${esc(course)}"${active ? ' aria-current="true"' : ''}><span class="dir-label" title="${esc(text)}">${esc(text)}</span>${over ? `<i class="dir-warn">${over} 逾期</i>` : ''}${pending ? `<i class="dir-pill">待核对 ${pending}</i>` : ''}<b class="dir-count">${count}</b></button>`;
  }

  function markup() {
    const list = groups();
    const total = list.reduce((n, g) => n + g.total, 0);
    if (!total) return '<p class="muted small dir-empty">还没有待办事项。添加或转入消息后，这里会自动长出目录。</p>';
    const overAll = state.tasks.filter(live).filter(late).length;
    let html = node('dir-root', '全部事项', total, overAll, 0, '全部', '', category === '全部' && !courseDir);
    for (const g of list) {
      html += node('dir-cat', g.name, g.total, g.over, g.pending, g.name, '', category === g.name && !courseDir);
      for (const c of g.courses) html += node('dir-course', label(c.name), c.total, c.over, 0, g.name, c.name, category === g.name && courseDir === c.name);
    }
    return html;
  }

  function crumb() {
    document.querySelector('.dir-crumb')?.remove();
    if (category === '全部' && !courseDir) return;
    const head = $('.section-head');
    if (!head) return;
    const path = [category !== '全部' ? category : '', courseDir ? label(courseDir) : ''].filter(Boolean).join(' / ');
    head.querySelector('h2')?.insertAdjacentHTML('afterend', `<span class="dir-crumb" title="${esc(path)}"><span>${esc(path)}</span><button data-dir-clear aria-label="清除目录筛选">×</button></span>`);
  }

  function paint() {
    const html = markup();
    for (const box of [$('#directory-tree'), $('#desktop-directory')]) if (box) box.innerHTML = html;
    crumb();
    const toggle = $('[data-open-drawer]');
    if (toggle) toggle.classList.toggle('has-filter', category !== '全部' || !!courseDir);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-drawer]')) {
      const d = drawer();
      d.showModal();
      (d.querySelector('.dir-node.active') || d.querySelector('.dir-node') || d.querySelector('[data-close-drawer]')).focus();
      return;
    }
    if (e.target.closest('[data-close-drawer]')) { drawer()?.close(); return; }
    if (e.target.closest('[data-dir-clear]')) { category = '全部'; courseDir = ''; render(); return; }
    const n = e.target.closest('.dir-node');
    if (!n) return;
    category = n.dataset.cat;
    courseDir = n.dataset.course || '';
    drawer()?.close();
    // 目录只作用于待办与已完成两个列表，从别的页面点进来时先把人带到能看到结果的地方。
    if (page === 'todo' || page === 'archive') render(); else navigate('todo');
  });

  const baseRender = render;
  render = function () { baseRender(); paint(); };
  paint();
})();
