/* 藏书管家 · 界面层
 * 单页应用：哈希路由 + 模板字符串渲染 + 事件委托。
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pct(v) { return (v * 100).toFixed(1) + '%'; }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 400);
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function toast(msg, opts) {
    opts = opts || {};
    var root = $('#toast-root');
    var el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' error' : '');
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    if (opts.action) {
      var btn = document.createElement('button');
      btn.textContent = opts.action.label;
      btn.onclick = function () {
        opts.action.run();
        el.remove();
      };
      el.appendChild(btn);
    }
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, opts.duration || 3600);
  }

  var state = {
    route: 'overview',
    q: '',
    filters: { category: '', tag: '', language: '', channel: '', decade: '' },
    sortBy: 'seq',
    sortDir: 'asc',
    page: 1,
    pageSize: 40,
    selectedIds: {}
  };

  var activeBookId = '';

  /* =========================================================
   * 图标 / 小部件
   * ======================================================= */
  function coverImg(b, cls) {
    if (!b || !b.cover) return '<div class="cover-placeholder ' + (cls || '') + '"><span>藏书</span></div>';
    return '<img class="book-cover ' + (cls || '') + '" src="' + esc(b.cover) + '" alt="' + esc(b.title || '封面') + '">';
  }

  function catPill(cat) {
    if (!cat) return '<span class="muted">—</span>';
    var c = Store.color(cat);
    return '<span class="cat-pill" style="background:' + c + '14;color:' + c + '">' +
      '<i class="dot" style="background:' + c + '"></i>' + esc(cat) + '</span>';
  }

  function kpi(label, value, unit, note) {
    return '<div class="card kpi"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' +
      (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>';
  }

  function donutSVG(data, total) {
    var R = 66, C = 2 * Math.PI * R, offset = 0, svg = '';
    data.forEach(function (d) {
      if (!d.count) return;
      var len = C * d.share;
      svg += '<circle cx="86" cy="86" r="' + R + '" fill="none" stroke="' + Store.color(d.name) +
        '" stroke-width="23" stroke-dasharray="' + Math.max(len - 2.5, 0.5) + ' ' + (C - Math.max(len - 2.5, 0.5)) +
        '" stroke-dashoffset="' + (-offset) + '" stroke-linecap="butt"></circle>';
      offset += len;
    });
    return '<div class="donut"><svg viewBox="0 0 172 172">' + svg + '</svg>' +
      '<div class="center"><div><b>' + total + '</b><span>种藏书</span></div></div></div>';
  }

  /* =========================================================
   * 总览
   * ======================================================= */
  function viewOverview() {
    var s = Store.stats();
    var h = '';

    h += '<div class="page-head"><div><h1>藏书总览</h1>' +
      '<div class="sub">共 ' + s.titles + ' 种 · ' + s.copies + ' 册 · ' +
      s.authorCount + ' 位作者 · ' + s.publisherCount + ' 家出版社</div></div>' +
      '<div class="btn-row"><button class="btn btn-soft btn-sm" data-action="new-book">+ 录入新书</button>' +
      '</div></div>';

    h += '<div class="grid kpis">' +
      kpi('藏书种数', s.titles, '种', '按书目记录统计') +
      kpi('总册数', s.copies, '册', '平均 ' + s.avgCopies.toFixed(1) + ' 册/种') +
      kpi('藏书类别', s.byCategory.length, '类', '有效类别数 ' + s.effectiveCategories.toFixed(1)) +
      kpi('作者人数', s.authorCount, '位', '人均 ' + (s.authorCount ? (s.titles / s.authorCount).toFixed(1) : '0') + ' 种') +
      kpi('出版社', s.publisherCount, '家', '前 8 家占 ' +
        (s.topPublishers.slice(0, 8).reduce(function (a, b) { return a + b.count; }, 0) /
          (s.titles || 1) * 100).toFixed(0) + '%') +
      kpi('单册占比', pct(s.titles ? s.singleCopy / s.titles : 0), '', s.multiCopy + ' 种为多卷本') +
      '</div>';

    h += '<div class="overview-top">';
    h += '<div class="card"><div class="section-title" style="padding:16px 20px 0"><h2>藏书类型构成</h2><span>按种数</span></div>' +
      '<div class="donut-wrap">' + donutSVG(s.byCategory, s.titles) + '<div class="legend">' +
      s.byCategory.map(function (d) {
        return '<div class="legend-row"><i class="dot" style="background:' + Store.color(d.name) + '"></i>' +
          '<span class="name">' + esc(d.name) + '</span><b>' + d.count + '</b>' +
          '<span class="pct">' + pct(d.share) + '</span></div>';
      }).join('') + '</div></div></div>';

    var maxTag = s.byTag.length ? s.byTag[0].count : 1;
    h += '<div class="card"><div class="section-title" style="padding:16px 20px 0"><h2>题材标签 · 前 8</h2>' +
      '<span>共 ' + s.byTag.length + ' 个标签</span></div><div class="bars">' +
      s.byTag.slice(0, 8).map(function (d, i) {
        return '<div class="bar-row"><span class="name">' + esc(d.name) + '</span>' +
          '<span class="bar-track"><i class="bar-fill" style="width:' + (d.count / maxTag * 100) +
          '%;background:' + (i === 0 ? 'var(--accent)' : 'var(--blue)') + ';opacity:' + (i === 0 ? 1 : 0.55 - i * 0.04) + '"></i></span>' +
          '<b>' + d.count + '</b></div>';
      }).join('') + '</div></div>';
    h += '</div>';

    var maxDec = s.byDecade.reduce(function (a, b) { return Math.max(a, b.count); }, 1);
    h += '<div class="overview-bottom">';
    h += '<div class="card"><div class="section-title" style="padding:16px 20px 0"><h2>出版年代</h2><span>按出版时间</span></div>' +
      '<div class="cols">' + s.byDecade.map(function (d) {
        var hot = d.count === maxDec ? ' hot' : '';
        return '<div class="col' + hot + '"><b>' + d.count + '</b>' +
          '<i class="bar" style="height:' + Math.max(4, d.count / maxDec * 100) + '%"></i>' +
          '<span>' + esc(d.name) + '</span></div>';
      }).join('') + '</div></div>';

    var maxCh = s.byChannel.reduce(function (a, b) { return Math.max(a, b.count); }, 1);
    h += '<div class="card"><div class="section-title" style="padding:16px 20px 0"><h2>获得渠道</h2><span>' +
      s.byChannel.length + ' 种渠道</span></div><div class="bars">' +
      s.byChannel.slice(0, 6).map(function (d, i) {
        return '<div class="bar-row"><span class="name">' + esc(d.name) + '</span>' +
          '<span class="bar-track"><i class="bar-fill" style="width:' + (d.count / maxCh * 100) +
          '%;background:var(--green);opacity:' + (1 - i * 0.12) + '"></i></span><b>' + d.count + '</b></div>';
      }).join('') + '</div></div>';

    var recent = Store.all().slice().sort(function (a, b) {
      return (b.createdAt || '') > (a.createdAt || '') ? 1 : (b.seq - a.seq);
    }).slice(0, 6);
    h += '<div class="card"><div class="section-title" style="padding:16px 20px 0"><h2>最近录入</h2>' +
      '<a class="muted" href="#/books" style="font-size:11.5px">查看全部 →</a></div><div class="recent">' +
      recent.map(function (b) {
        return '<div class="recent-item" data-action="book-open" data-id="' + b.id + '">' +
          '<i class="spine" style="background:' + Store.color(b.category) + '"></i>' +
          '<div><div class="t">' + esc(b.title) + '</div>' +
          '<div class="m">' + esc(b.author || '佚名') + ' · ' + esc(b.category || '未分类') + '</div></div>' +
          '<span class="muted" style="font-size:11.5px">' + esc(b.pubdate || '') + '</span></div>';
      }).join('') + '</div></div>';
    h += '</div>';
    return h;
  }

  /* =========================================================
   * 书目
   * ======================================================= */
  function selectedCount() {
    return Object.keys(state.selectedIds).filter(function (id) { return state.selectedIds[id]; }).length;
  }

  function syncSelection(list) {
    var valid = {};
    list.forEach(function (b) { valid[b.id] = true; });
    Object.keys(state.selectedIds).forEach(function (id) {
      if (!valid[id] || !Store.get(id)) delete state.selectedIds[id];
    });
  }

  function viewBooks() {
    var s = Store.stats();
    var list = Store.query({
      q: state.q,
      category: state.filters.category,
      tag: state.filters.tag,
      language: state.filters.language,
      channel: state.filters.channel,
      decade: state.filters.decade,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    });

    syncSelection(list);
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * state.pageSize;
    var pageList = list.slice(start, start + state.pageSize);

    var h = '<div class="page-head"><div><h1>书目</h1><div class="sub">' +
      (state.q ? '搜索「' + esc(state.q) + '」· ' : '') + '共 ' + total + ' 条' +
      (total !== s.titles ? '（全部 ' + s.titles + ' 条）' : '') + '</div></div>' +
      '<div class="btn-row"><button class="btn btn-primary btn-sm" data-action="new-book">+ 录入新书</button></div></div>';

    // 类别 chips
    h += '<div class="toolbar"><div class="chips">' +
      '<button class="chip' + (!state.filters.category ? ' active' : '') + '" data-action="filter" data-key="category" data-value="">' +
      '全部<span class="n">' + s.titles + '</span></button>' +
      s.byCategory.map(function (c) {
        return '<button class="chip' + (state.filters.category === c.name ? ' active' : '') +
          '" data-action="filter" data-key="category" data-value="' + esc(c.name) + '">' +
          esc(c.name) + '<span class="n">' + c.count + '</span></button>';
      }).join('') + '</div></div>';

    var langs = ['', '中文', '英文'];
    var decades = ['', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s', '未知'];
    var channels = [''].concat(s.byChannel.map(function (c) { return c.name; }));

    h += '<div class="toolbar">' +
      '<select class="select" data-action="filter-select" data-key="language">' +
      langs.map(function (l) { return '<option value="' + esc(l) + '"' + (state.filters.language === l ? ' selected' : '') + '>' + (l || '全部语言') + '</option>'; }).join('') +
      '</select>' +
      '<select class="select" data-action="filter-select" data-key="decade">' +
      decades.map(function (d) { return '<option value="' + esc(d) + '"' + (state.filters.decade === d ? ' selected' : '') + '>' + (d || '全部年代') + '</option>'; }).join('') +
      '</select>' +
      '<select class="select" data-action="filter-select" data-key="channel">' +
      channels.map(function (c) { return '<option value="' + esc(c) + '"' + (state.filters.channel === c ? ' selected' : '') + '>' + (c || '全部渠道') + '</option>'; }).join('') +
      '</select>' +
      '<button class="chip" data-action="clear-filters">清除筛选</button>' +
      '<span class="spacer"></span>' +
      '<select class="select" data-action="sort-select">' +
      [['seq', '按序号'], ['title', '按书名'], ['author', '按作者'], ['pubdate', '按出版时间'], ['copies', '按册数']]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (state.sortBy === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<button class="chip" data-action="toggle-dir" title="切换升降序">' + (state.sortDir === 'asc' ? '↑ 升序' : '↓ 降序') + '</button>' +
      '</div>';

    if (!total) {
      h += '<div class="card empty"><span class="big">☰</span><b>没有符合条件的书</b>' +
        '<div>换个关键词，或清除筛选条件试试</div>' +
        '<div class="btn-row" style="justify-content:center;margin-top:14px">' +
        '<button class="btn btn-ghost btn-sm" data-action="clear-filters">清除筛选</button>' +
        '<button class="btn btn-primary btn-sm" data-action="new-book">录入新书</button></div></div>';
      return h;
    }

    var selCount = selectedCount();
    var allSelected = total > 0 && list.every(function (b) { return !!state.selectedIds[b.id]; });
    h += '<div class="bulk-toolbar">' +
      '<label class="bulk-select-all"><input type="checkbox" data-action="select-all-books"' + (allSelected ? ' checked' : '') + '> 全选</label>' +
      '<span class="bulk-count">已选 ' + selCount + ' 本</span>' +
      (selCount ? '<button class="btn btn-danger btn-sm" data-action="bulk-delete-books">删除所选（' + selCount + '）</button>' : '') +
      '</div>';
    h += '<div class="card table-card"><div class="table-scroll"><table class="books"><thead><tr>' +
      '<th class="select-col"><input type="checkbox" data-action="select-all-books"' + (allSelected ? ' checked' : '') + ' aria-label="全选"></th>' +
      th('序号', 'seq') + th('书名', 'title') + th('作者', 'author') + th('出版社', 'publisher') +
      th('出版时间', 'pubdate') + '<th>类别</th><th>标签</th>' + th('册数', 'copies') + '<th class="right">操作</th>' +
      '</tr></thead><tbody>';

    pageList.forEach(function (b) {
      var tip = [
        b.translator ? '译者：' + b.translator : '',
        b.acquired ? '获取：' + b.acquired : '',
        b.note ? '备注：' + b.note : ''
      ].filter(Boolean).join(' · ');
      h += '<tr data-action="book-open" data-id="' + b.id + '">' +
        '<td class="select-col"><input type="checkbox" data-action="select-book" data-id="' + b.id + '"' + (state.selectedIds[b.id] ? ' checked' : '') + ' aria-label="选择《' + esc(b.title) + '"></td>' +
        '<td class="muted num" style="text-align:left">' + b.seq + '</td>' +
        '<td><div class="cell-title"><i class="spine" style="background:' + Store.color(b.category) + '"></i>' +
        '<div><div class="t" title="' + esc(tip) + '">' + esc(b.title) + '</div>' +
        (b.note ? '<div class="s">' + esc(b.note) + '</div>' : '') + '</div></div></td>' +
        '<td>' + esc(b.author || '—') + '</td>' +
        '<td class="muted">' + esc(b.publisher || '—') + '</td>' +
        '<td class="muted nowrap">' + esc(b.pubdate || '—') + '</td>' +
        '<td>' + catPill(b.category) + '</td>' +
        '<td><span class="tag-pill">' + esc(b.tag || '—') + '</span></td>' +
        '<td class="num">' + b.copies + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="icon-btn" data-action="book-edit" data-id="' + b.id + '" title="编辑">✎</button>' +
        '<button class="icon-btn danger" data-action="book-delete" data-id="' + b.id + '" title="删除">✕</button>' +
        '</div></td></tr>';
    });

    h += '</tbody></table></div>';

    h += '<div class="table-foot"><span>第 ' + (start + 1) + '–' + Math.min(start + state.pageSize, total) +
      ' 条，共 ' + total + ' 条 · 合计 ' +
      list.reduce(function (a, b) { return a + b.copies; }, 0) + ' 册</span>' + pager(pages) + '</div></div>';
    return h;
  }

  function th(label, key) {
    var arrow = state.sortBy === key ? (state.sortDir === 'asc' ? '↑' : '↓') : '';
    return '<th data-action="sort" data-key="' + key + '">' + label + '<span class="arrow">' + arrow + '</span></th>';
  }

  function pager(pages) {
    if (pages <= 1) return '';
    var out = '<div class="pager">';
    out += '<button data-action="page" data-page="' + (state.page - 1) + '"' + (state.page === 1 ? ' disabled' : '') + '>‹</button>';
    var from = Math.max(1, state.page - 2), to = Math.min(pages, from + 4);
    from = Math.max(1, to - 4);
    for (var p = from; p <= to; p++) {
      out += '<button data-action="page" data-page="' + p + '"' + (p === state.page ? ' class="on"' : '') + '>' + p + '</button>';
    }
    out += '<button data-action="page" data-page="' + (state.page + 1) + '"' + (state.page === pages ? ' disabled' : '') + '>›</button>';
    return out + '</div>';
  }

  /* =========================================================
   * 书架
   * ======================================================= */
  function viewShelf() {
    var list = Store.query({ q: state.q, category: state.filters.category, tag: state.filters.tag, language: state.filters.language, channel: state.filters.channel, decade: state.filters.decade, sortBy: 'title', sortDir: 'asc' });
    var s = Store.stats();
    var h = '<div class="page-head"><div><h1>我的书架</h1><div class="sub">把藏书以实体书架的方式展示 · 共 ' + list.length + ' 种</div></div><div class="btn-row"><button class="btn btn-primary btn-sm" data-action="new-book">+ 录入新书</button></div></div>';
    h += '<div class="shelf-toolbar"><span>共 ' + s.titles + ' 种 · ' + s.copies + ' 册</span><button class="chip" data-action="clear-filters">清除筛选</button></div>';
    if (!list.length) return h + '<div class="card empty"><span class="big">▥</span><b>书架上暂时没有符合条件的书</b><div>可以先录入一本书，或者清除搜索/筛选条件。</div></div>';
    h += '<div class="bookshelf">';
    list.forEach(function (b) {
      var color = Store.color(b.category);
      h += '<div class="shelf-book" data-action="book-open" data-id="' + b.id + '" title="点击查看《' + esc(b.title) + '》"><div class="shelf-cover-wrap">' + coverImg(b, 'shelf-cover') + '<i class="shelf-spine" style="background:' + color + '"></i></div><div class="shelf-title">' + esc(b.title) + '</div><div class="shelf-author">' + esc(b.author || '佚名') + '</div><div class="shelf-meta">' + esc(b.category || '未分类') + (b.copies > 1 ? ' · ' + b.copies + '册' : '') + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  /* =========================================================
   * 分类
   * ======================================================= */
  function viewCategories() {
    var s = Store.stats();
    var h = '<div class="page-head"><div><h1>分类视图</h1>' +
      '<div class="sub">把藏书按五个大类摊开看，点任意一类进入对应书目</div></div></div>';

    h += '<div class="cat-grid">';
    s.byCategory.forEach(function (c) {
      var color = Store.color(c.name);
      var tags = s.byTag.filter(function (t) { return Store.tagsOf(c.name).indexOf(t.name) >= 0; }).slice(0, 6);
      h += '<div class="card cat-card" style="color:' + color + '">' +
        '<div class="cat-head"><i class="cat-dot" style="background:' + color + '"></i>' +
        '<h3 style="color:var(--ink)">' + esc(c.name) + '</h3>' +
        '<span class="muted" style="margin-left:auto;font-size:11.5px">' + pct(c.share) + '</span></div>' +
        '<div class="big" style="color:var(--ink)">' + c.count + '<small> 种</small></div>' +
        '<div class="progress"><i style="width:' + Math.min(100, c.share * 100) + '%;background:' + color + '"></i></div>' +
        '<div class="tags">' + tags.map(function (t) {
          return '<span class="tag-pill">' + esc(t.name) + ' ' + t.count + '</span>';
        }).join('') + '</div>' +
        '<div style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-action="goto-cat" data-value="' +
        esc(c.name) + '">查看书目 →</button></div></div>';
    });
    h += '</div>';

    h += '<div class="card" style="margin-top:16px;padding:18px 20px">' +
      '<div class="section-title"><h2>结构提示</h2><span>自动估算</span></div>' +
      '<div class="muted" style="font-size:12.5px;line-height:1.9">' +
      '有效类别数 <b style="color:var(--ink)">' + s.effectiveCategories.toFixed(1) + ' / ' + s.byCategory.length +
      '</b>（按 1 / Σ占比² 计算）。数值越接近类别总数，结构越均衡；' +
      '当前藏书主要集中在「' + esc(s.byCategory[0] ? s.byCategory[0].name : '—') + '」，占 ' +
      pct(s.byCategory[0] ? s.byCategory[0].share : 0) + '。</div></div>';
    return h;
  }

  /* =========================================================
   * 词典
   * ======================================================= */
  function viewDict() {
    var d = Store.data.dict;
    var h = '<div class="page-head"><div><h1>分类词典</h1>' +
      '<div class="sub">类别与标签、出版社、作者、渠道，录入时的下拉选项都来自这里</div></div></div>';

    h += '<div class="dict-grid">';
    h += '<div class="card dict-block"><div class="section-title"><h3>类别与标签</h3><span>' +
      d.categories.length + ' 类</span></div>' +
      '<div class="hint">标签与类别绑定：录入时先选类别，标签下拉只显示该类别的标签。</div>';

    d.categories.forEach(function (c) {
      h += '<div style="margin-bottom:16px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<i class="cat-dot" style="width:9px;height:9px;border-radius:3px;background:' + Store.color(c.name) + '"></i>' +
        '<b style="font-size:13px">' + esc(c.name) + '</b>' +
        '<span class="muted" style="font-size:11px">' + c.tags.length + ' 个标签</span>' +
        '<button class="icon-btn" style="width:22px;height:22px;font-size:11px;margin-left:auto" ' +
        'data-action="dict-rename-cat" data-cat="' + esc(c.name) + '" title="重命名类别">✎</button>' +
        '</div><div class="tag-list">' +
        c.tags.map(function (t) {
          var n = Store.data.books.filter(function (b) { return b.category === c.name && b.tag === t; }).length;
          return '<span class="tag-chip">' + esc(t) + '<i class="cnt">' + n + '</i>' +
            '<button class="x" data-action="dict-del-tag" data-cat="' + esc(c.name) + '" data-tag="' + esc(t) + '" title="删除标签">×</button></span>';
        }).join('') + '</div>' +
        '<form class="inline-form" data-form="add-tag" data-cat="' + esc(c.name) + '">' +
        '<input name="tag" placeholder="新增标签…" autocomplete="off">' +
        '<button class="btn btn-ghost btn-sm" type="submit">添加</button></form></div>';
    });

    h += '<form class="inline-form" data-form="add-cat" style="margin-top:6px">' +
      '<input name="cat" placeholder="新增类别，例如：外语学习" autocomplete="off">' +
      '<button class="btn btn-ghost btn-sm" type="submit">添加类别</button></form>';
    h += '</div>';

    h += '<div class="card dict-block"><div class="section-title"><h3>出版社 / 作者 / 渠道</h3><span>自动收录</span></div>' +
      '<div class="hint">录入新书时如果填了不存在的值，会自动加入这里。</div>';

    h += listBlock('publishers', '出版社', 'publisher');
    h += listBlock('authors', '作者', 'author');
    h += listBlock('channels', '获得渠道', 'channel');
    h += '</div></div>';
    return h;
  }

  function listBlock(key, label, field) {
    var arr = Store.data.dict[key];
    var h = '<div style="margin-bottom:16px"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">' +
      '<b style="font-size:13px">' + label + '</b><span class="muted" style="font-size:11px">' + arr.length + ' 个</span></div>' +
      '<div class="list-scroll"><div class="tag-list">';
    arr.forEach(function (v) {
      var n = Store.usage(field, v);
      h += '<span class="tag-chip">' + esc(v) + '<i class="cnt">' + n + '</i>' +
        '<button class="x" data-action="dict-del-list" data-key="' + key + '" data-value="' + esc(v) + '" title="删除">×</button></span>';
    });
    h += '</div></div>';
    h += '<form class="inline-form" data-form="add-list" data-key="' + key + '">' +
      '<input name="value" placeholder="新增' + label + '…" autocomplete="off">' +
      '<button class="btn btn-ghost btn-sm" type="submit">添加</button></form></div>';
    return h;
  }

  /* =========================================================
   * 数据与备份
   * ======================================================= */
  function viewData() {
    var raw = JSON.stringify(Store.data);
    var kb = (raw.length / 1024).toFixed(1);
    var h = '<div class="page-head"><div><h1>数据与备份</h1>' +
      '<div class="sub">数据保存在当前浏览器本地；换设备或清缓存前请先导出备份</div></div></div>';

    h += '<div class="data-grid">';
    h += '<div class="card data-block"><h3>导出</h3>' +
      '<p>导出为 Excel 可与原「书目.xlsx」互相替换；JSON 用于完整备份（含分类词典）。</p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary btn-sm" data-action="export-xlsx">导出 Excel (.xlsx)</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="export-csv">导出 CSV</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="export-json">导出 JSON 备份</button>' +
      '</div>' +
      '<div class="file-meta">当前数据：' + Store.data.books.length + ' 种书 · 约 ' + kb + ' KB · ' +
      (Store.lastError || '最近保存正常') + '</div></div>';

    h += '<div class="card data-block"><h3>导入</h3>' +
      '<p>支持 .xlsx / .csv / .json。Excel 需包含表头：序号、书名、作者、出版社、出版时间、类别、标签、语言、译者、册数、获得渠道、获取时间、备注。</p>' +
      '<div class="dropzone" data-action="pick-file" id="dropzone">' +
      '<b>点击选择文件，或拖拽到这里</b>支持 xlsx / csv / json</div>' +
      '<input type="file" id="file-input" class="hidden" accept=".xlsx,.csv,.json">' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:12px;font-size:12px">' +
      '<label style="display:flex;gap:6px;align-items:center"><input type="radio" name="import-mode" value="replace" checked> 替换现有数据</label>' +
      '<label style="display:flex;gap:6px;align-items:center"><input type="radio" name="import-mode" value="merge"> 合并（按书名+作者去重）</label>' +
      '</div></div>';

    h += '<div class="card data-block"><h3>维护</h3>' +
      '<p>「恢复初始数据」会用内置的 172 种书目覆盖当前数据。</p>' +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost btn-sm" data-action="reset-data">恢复初始数据</button>' +
      '<button class="btn btn-danger btn-sm" data-action="clear-data">清空全部</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="undo">撤销上一步</button>' +
      '</div></div>';

    h += '<div class="card data-block"><h3>关于</h3>' +
      '<p>藏书管家 · 纯本地单页应用，无需安装、不联网也能用。数据存在浏览器 localStorage，' +
      '同一台电脑换浏览器或清理站点数据会丢失，请定期导出 JSON 备份。</p>' +
      '</div>';
    h += '</div>';
    return h;
  }

  /* =========================================================
   * 渲染与路由
   * ======================================================= */
  function render() {
    var view = $('#view');
    var html = '';
    switch (state.route) {
      case 'books': html = viewBooks(); break;
      case 'shelf': html = viewShelf(); break;
      case 'categories': html = viewCategories(); break;
      case 'dict': html = viewDict(); break;
      case 'data': html = viewData(); break;
      default: html = viewOverview();
    }
    view.innerHTML = html;
    updateChrome();
  }

  function updateChrome() {
    var s = Store.stats();
    $('#side-titles').textContent = s.titles;
    $('#side-copies').textContent = s.copies;
    $$('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === state.route);
    });
    $$('[data-mobile-route]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-mobile-route') === state.route);
    });
    var search = $('#search');
    if (search && document.activeElement !== search) search.value = state.q;
  }

  function go(route) {
    if (location.hash !== '#/' + route) location.hash = '#/' + route;
    else { state.route = route; render(); }
  }

  /* =========================================================
   * 弹窗基座
   * ======================================================= */
  var modalCleanup = null;

  function openModal(html, onMount, onClose) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-mask" data-action="close-modal"></div>' +
      '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    modalCleanup = onClose || null;
    if (onMount) onMount(root);
    var first = root.querySelector('input, select, textarea, button');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) { } }, 30);
  }

  function closeModal() {
    var root = $('#modal-root');
    root.classList.remove('open');
    root.innerHTML = '';
    document.body.style.overflow = '';
    if (modalCleanup) {
      try { modalCleanup(); } catch (e) { }
      modalCleanup = null;
    }
  }

  /* =========================================================
   * 书目表单
   * ======================================================= */
  function field(label, inner, opts) {
    opts = opts || {};
    return '<div class="field' + (opts.full ? ' full' : '') + '">' +
      '<label>' + label + (opts.req ? ' <span class="req">*</span>' : '') + '</label>' +
      inner + (opts.help ? '<div class="help">' + opts.help + '</div>' : '') + '</div>';
  }

  function compressCover(file, done) {
    if (!file || !/^image\//i.test(file.type)) { toast('请选择图片文件', { error: true }); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var maxW = 800, maxH = 1100;
        var scale = Math.min(1, maxW / img.width, maxH / img.height);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { toast('封面图片读取失败', { error: true }); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('封面图片读取失败', { error: true }); };
    reader.readAsDataURL(file);
  }

  function openBookModal(id, preset) {
    activeBookId = id || '';
    var b = id ? Store.get(id) : null;
    var isEdit = !!b;
    b = b || Object.assign({
      title: '', author: '', publisher: '', pubdate: '', category: (Store.categories()[0] || ''),
      tag: '', language: '中文', translator: '', copies: 1, channel: '', acquired: '', note: '', cover: ''
    }, preset || {});

    var cats = Store.categories();
    var html = '<div class="modal-head"><div><h2>' + (isEdit ? '编辑书目' : '录入新书') + '</h2>' +
      '<div class="sub">' + (isEdit ? '序号 ' + b.seq + ' · 修改后自动保存' : '带 * 为必填项') + '</div></div>' +
      '<button class="icon-btn" data-action="close-modal">✕</button></div>';

    html += '<div class="modal-body"><form id="book-form" class="form-grid" autocomplete="off">' +
      field('书名 <span class="req">*</span>', '<input name="title" value="' + esc(b.title) + '" placeholder="例如：平凡的世界">', { full: false }) +
      field('封面', '<div class="cover-input"><div id="cover-preview">' + coverImg(b, 'form-cover') + '</div><div class="cover-actions"><label class="btn btn-soft btn-sm camera-label">📷 拍照/选择封面<input id="cover-input" type="file" accept="image/*" capture="environment" hidden></label><button type="button" class="btn btn-ghost btn-sm" data-action="remove-cover">移除封面</button></div><div class="help">手机可直接调用相机拍摄书封面；图片会压缩后保存在本机。</div></div>', { full: true }) +
      field('作者', '<input name="author" value="' + esc(b.author) + '" list="dl-authors" placeholder="例如：路遥">') +
      field('出版社', '<input name="publisher" value="' + esc(b.publisher) + '" list="dl-publishers" placeholder="例如：北京十月文艺出版社">') +
      field('出版时间', '<input name="pubdate" value="' + esc(b.pubdate) + '" placeholder="2019 或 2019-05">') +
      field('类别', '<select name="category">' + cats.map(function (c) {
        return '<option value="' + esc(c) + '"' + (b.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select>') +
      field('标签', '<input name="tag" value="' + esc(b.tag) + '" list="dl-tags" placeholder="选择或输入标签">', { help: '标签下拉随类别变化；输入新标签会自动加入词典' }) +
      field('语言', '<select name="language">' + Store.data.dict.languages.map(function (l) {
        return '<option value="' + esc(l) + '"' + (b.language === l ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>') +
      field('译者', '<input name="translator" value="' + esc(b.translator) + '" placeholder="外文书可填，例如：傅雷">') +
      field('册数', '<input name="copies" type="number" min="1" step="1" value="' + (b.copies || 1) + '">') +
      field('获得渠道', '<input name="channel" value="' + esc(b.channel) + '" list="dl-channels" placeholder="例如：网购、书店购入">') +
      field('获取时间', '<input name="acquired" value="' + esc(b.acquired) + '" placeholder="2021 或 2021-09">') +
      field('备注', '<textarea name="note" placeholder="版本、品相、借出记录…">' + esc(b.note) + '</textarea>', { full: true }) +
      '</form>' +
      '<div class="dup-warn" id="dup-warn"></div>' +
      '<div class="form-error" id="form-error"></div>' +
      '</div>';

    html += '<div class="modal-foot"><div class="left">' + (isEdit ? '创建于 ' + (b.createdAt || '—') : '录入后可随时修改') + '</div>' +
      '<div class="right">' +
      (isEdit ? '<button class="btn btn-danger btn-sm" data-action="book-delete" data-id="' + b.id + '" data-from-modal="1">删除</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-action="close-modal">取消</button>' +
      '<button class="btn btn-primary btn-sm" data-action="submit-book" data-id="' + (isEdit ? b.id : '') + '">' +
      (isEdit ? '保存修改' : '保存') + '</button></div></div>';

    openModal(html, function (root) {
      var form = $('#book-form', root);

      var coverInput = root.querySelector('#cover-input');
      if (coverInput) coverInput.addEventListener('change', function () {
        var file = coverInput.files && coverInput.files[0];
        if (!file) return;
        compressCover(file, function (dataUrl) {
          var preview = root.querySelector('#cover-preview');
          if (preview) preview.innerHTML = coverImg({ title: b.title, cover: dataUrl }, 'form-cover');
          b.cover = dataUrl;
          if ($('#book-form')) $('#book-form').dataset.coverRemoved = '0';
        });
      });

      // datalists
      var dl = document.createElement('div');
      dl.innerHTML =
        '<datalist id="dl-authors">' + Store.data.dict.authors.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
        '<datalist id="dl-publishers">' + Store.data.dict.publishers.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
        '<datalist id="dl-channels">' + Store.data.dict.channels.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
        '<datalist id="dl-tags"></datalist>';
      form.appendChild(dl);

      function refreshTags() {
        var cat = form.category.value;
        var tags = Store.tagsOf(cat);
        var list = root.querySelector('#dl-tags');
        list.innerHTML = tags.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
      }
      form.category.addEventListener('change', function () {
        refreshTags();
        form.tag.value = '';
      });
      refreshTags();

      // 重名提示
      form.title.addEventListener('input', function () {
        var dups = Store.duplicates({ title: form.title.value }, id);
        var warn = root.querySelector('#dup-warn');
        if (dups.length) {
          warn.classList.add('show');
          warn.innerHTML = '已有同名书 ' + dups.length + ' 种：' +
            dups.slice(0, 3).map(function (x) { return esc(x.title) + '（' + esc(x.author || '佚名') + '）'; }).join('、') +
            '，可继续保存。';
        } else {
          warn.classList.remove('show');
        }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitBook(root, id);
      });
    });
  }

  function submitBook(root, id) {
    var form = $('#book-form', root);
    var fields = {};
    ['title', 'author', 'publisher', 'pubdate', 'category', 'tag', 'language',
      'translator', 'channel', 'acquired', 'note', 'cover'].forEach(function (k) {
        fields[k] = form[k] ? form[k].value : '';
      });
    fields.copies = form.copies ? form.copies.value : 1;
    if (form.dataset.coverRemoved === '1') fields.cover = '';

    var errors = Store.validate(fields);
    var box = root.querySelector('#form-error');
    if (errors.length) {
      box.textContent = errors.join('；');
      box.classList.add('show');
      return;
    }
    box.classList.remove('show');

    // 自动补词典
    if (fields.category && fields.tag) Store.addTag(fields.category, fields.tag);
    if (fields.publisher) Store.addListValue('publishers', fields.publisher);
    if (fields.author) Store.addListValue('authors', fields.author);
    if (fields.channel) Store.addListValue('channels', fields.channel);

    var saved;
    if (id) {
      saved = Store.update(id, fields);
      toast('已保存《' + saved.title + '》');
      closeModal();
    } else {
      saved = Store.add(fields);
      toast('已录入《' + saved.title + '》');
      closeModal();
    }
    render();
  }

  /* =========================================================
   * 导入导出
   * ======================================================= */
  function exportXLSX() {
    var rows = Store.toRows();
    var bytes = XLSX.write(rows, '藏书', { widths: [6, 28, 16, 24, 11, 10, 14, 7, 12, 6, 12, 11, 24] });
    download('藏书书目-' + stamp() + '.xlsx', new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    toast('已导出 Excel（' + (rows.length - 1) + ' 条）');
  }

  function exportCSV() {
    var rows = Store.toRows();
    var csv = rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v === null || v === undefined ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    download('藏书书目-' + stamp() + '.csv', new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    toast('已导出 CSV');
  }

  function exportJSON() {
    var obj = Store.exportObject();
    download('藏书备份-' + stamp() + '.json', new Blob([JSON.stringify(obj, null, 2)], {
      type: 'application/json'
    }));
    toast('已导出 JSON 备份');
  }

  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    text = text.replace(/^\ufeff/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += c;
      } else if (c === '"') {
        q = true;
      } else if (c === ',') {
        row.push(cur); cur = '';
      } else if (c === '\n') {
        row.push(cur); rows.push(row); row = []; cur = '';
      } else if (c === '\r') {
        // skip
      } else cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function handleFile(file) {
    if (!file) return;
    var mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value || 'replace';
    var name = file.name.toLowerCase();

    function done(books, opts) {
      opts = opts || {};
      if (!books.length) { toast('文件里没有可导入的书目', { error: true }); return; }
      try {
        Store.importObject({ books: books, dict: opts.dict }, mode);
        toast('已导入 ' + books.length + ' 条' + (opts.label ? '（' + opts.label + '）' : ''));
        go('books');
      } catch (e) {
        toast('导入失败：' + e.message, { error: true });
      }
    }

    if (name.endsWith('.json')) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var obj = JSON.parse(fr.result);
          var books = Array.isArray(obj) ? obj : obj.books;
          done(books || [], { label: 'JSON', dict: obj.dict });
        } catch (e) {
          toast('JSON 解析失败：' + e.message, { error: true });
        }
      };
      fr.readAsText(file);
      return;
    }

    if (name.endsWith('.csv')) {
      var fr2 = new FileReader();
      fr2.onload = function () {
        done(Store.fromRows(parseCSV(fr2.result)), { label: 'CSV' });
      };
      fr2.readAsText(file, 'utf-8');
      return;
    }

    if (name.endsWith('.xlsx')) {
      var fr3 = new FileReader();
      fr3.onload = function () {
        XLSX.read(fr3.result).then(function (rows) {
          done(Store.fromRows(rows), { label: 'Excel' });
        }).catch(function (e) {
          toast('读取 Excel 失败：' + e.message, { error: true });
        });
      };
      fr3.readAsArrayBuffer(file);
      return;
    }

    toast('不支持的文件类型', { error: true });
  }

  /* =========================================================
   * 事件
   * ======================================================= */
  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('nav-open') &&
      !e.target.closest('.sidebar') && !e.target.closest('[data-action="toggle-nav"]')) {
      document.body.classList.remove('nav-open');
    }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');

    // 表格行内的按钮不应触发行点击
    if (action === 'book-edit' || action === 'book-delete' || action === 'select-book' || action === 'select-all-books' || action === 'bulk-delete-books') {
      e.stopPropagation();
    }

    switch (action) {
      case 'new-book':
        openBookModal(null);
        break;
      case 'toggle-nav':
        document.body.classList.toggle('nav-open');
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'book-open': {
        var id = el.getAttribute('data-id');
        openBookModal(id);
        break;
      }
      case 'book-edit':
        openBookModal(el.getAttribute('data-id'));
        break;
      case 'select-book': {
        var sid = el.getAttribute('data-id');
        if (el.checked) state.selectedIds[sid] = true;
        else delete state.selectedIds[sid];
        render();
        break;
      }
      case 'select-all-books': {
        var currentList = Store.query({ q: state.q, category: state.filters.category, tag: state.filters.tag, language: state.filters.language, channel: state.filters.channel, decade: state.filters.decade, sortBy: state.sortBy, sortDir: state.sortDir });
        var shouldSelect = !currentList.length || !currentList.every(function (b) { return !!state.selectedIds[b.id]; });
        currentList.forEach(function (b) {
          if (shouldSelect) state.selectedIds[b.id] = true;
          else delete state.selectedIds[b.id];
        });
        render();
        break;
      }
      case 'bulk-delete-books': {
        var ids = Object.keys(state.selectedIds).filter(function (id) { return state.selectedIds[id] && Store.get(id); });
        if (!ids.length) break;
        if (!confirm('确定删除选中的 ' + ids.length + ' 本书吗？删除后可以使用“撤销”恢复。')) break;
        Store.removeMany(ids);
        state.selectedIds = {};
        render();
        toast('已删除 ' + ids.length + ' 本书', {
          action: { label: '撤销', run: function () { Store.undo(); render(); toast('已恢复'); } }
        });
        break;
      }
      case 'book-delete': {
        var bid = el.getAttribute('data-id');
        var book = Store.get(bid);
        if (!book) break;
        if (!confirm('确定删除《' + book.title + '》吗？可以在提示条里撤销。')) break;
        Store.remove(bid);
        closeModal();
        render();
        toast('已删除《' + book.title + '》', {
          action: { label: '撤销', run: function () { Store.undo(); render(); toast('已恢复'); } }
        });
        break;
      }
      case 'remove-cover': {
        var cp = $('#cover-preview'); if (cp) cp.innerHTML = coverImg({ title: '封面', cover: '' }, 'form-cover');
        var ci = $('#cover-input'); if (ci) ci.value = '';
        if ($('#book-form')) $('#book-form').dataset.coverRemoved = '1';
        break;
      }
      case 'submit-book': {
        var modal = $('#modal-root .modal');
        if (modal) submitBook(modal, activeBookId);
        break;
      }
      case 'filter': {
        var key = el.getAttribute('data-key');
        var val = el.getAttribute('data-value');
        state.filters[key] = val;
        state.page = 1;
        render();
        break;
      }
      case 'goto-cat':
        state.filters.category = el.getAttribute('data-value');
        state.filters.tag = '';
        state.page = 1;
        go('books');
        break;
      case 'clear-filters':
        state.filters = { category: '', tag: '', language: '', channel: '', decade: '' };
        state.q = '';
        $('#search').value = '';
        state.page = 1;
        render();
        break;
      case 'sort': {
        var k = el.getAttribute('data-key');
        if (state.sortBy === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortBy = k; state.sortDir = 'asc'; }
        render();
        break;
      }
      case 'toggle-dir':
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        render();
        break;
      case 'sort-select':
        // handled by change
        break;
      case 'page':
        state.page = Math.max(1, parseInt(el.getAttribute('data-page'), 10) || 1);
        render();
        $('.view').scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'export-xlsx': exportXLSX(); break;
      case 'export-csv': exportCSV(); break;
      case 'export-json': exportJSON(); break;
      case 'reset-data':
        if (confirm('确定恢复内置示例书目吗？当前书目会被替换。')) {
          Store.reset(); render(); toast('已恢复初始数据');
        }
        break;
      case 'clear-data':
        if (confirm('确定清空全部书目吗？此操作可撤销一次。')) {
          Store.clear(); render(); toast('已清空');
        }
        break;
      case 'undo':
        if (Store.undo()) { render(); toast('已撤销'); } else toast('没有可撤销的操作', { error: true });
        break;
      case 'pick-file': {
        var input = $('#file-input');
        if (input) input.click();
        break;
      }
      case 'dict-del-tag': {
        var cat = el.getAttribute('data-cat'), tag = el.getAttribute('data-tag');
        var used = Store.usage('tag', tag);
        if (used && !confirm('该标签已被 ' + used + ' 种书使用，删除后这些书的标签会保留但不在下拉中。继续？')) break;
        Store.removeTag(cat, tag);
        render();
        break;
      }
      case 'dict-del-list': {
        var key2 = el.getAttribute('data-key');
        var val2 = el.getAttribute('data-value');
        Store.removeListValue(key2, val2);
        render();
        break;
      }
      case 'dict-rename-cat': {
        var oldCat = el.getAttribute('data-cat');
        var nextCat = prompt('将类别「' + oldCat + '」重命名为：', oldCat);
        if (nextCat && nextCat.trim() && nextCat.trim() !== oldCat) {
          if (Store.renameCategory(oldCat, nextCat.trim())) {
            render();
            toast('已重命名为「' + nextCat.trim() + '」');
          } else {
            toast('重命名失败：名称已存在', { error: true });
          }
        }
        break;
      }
      default:
        break;
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches('[data-action="filter-select"]')) {
      state.filters[el.getAttribute('data-key')] = el.value;
      state.page = 1;
      render();
      return;
    }
    if (el.matches('[data-action="sort-select"]')) {
      state.sortBy = el.value;
      render();
      return;
    }
    if (el.id === 'file-input') {
      handleFile(el.files[0]);
      el.value = '';
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches('form[data-form]')) return;
    e.preventDefault();
    var type = form.getAttribute('data-form');
    var input = form.querySelector('input');
    var value = input.value.trim();
    if (!value) return;
    if (type === 'add-tag') {
      var cat = form.getAttribute('data-cat');
      if (Store.addTag(cat, value)) { input.value = ''; render(); toast('已添加标签'); }
      else toast('标签已存在', { error: true });
    } else if (type === 'add-cat') {
      if (Store.addCategory(value)) { render(); toast('已添加类别'); }
      else toast('类别已存在', { error: true });
    } else if (type === 'add-list') {
      var key = form.getAttribute('data-key');
      if (Store.addListValue(key, value)) { render(); toast('已添加'); }
      else toast('已存在', { error: true });
    }
  });

  // 搜索
  var searchTimer = null;
  var searchInput = $('#search');
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var v = searchInput.value;
    searchTimer = setTimeout(function () {
      state.q = v;
      state.page = 1;
      if (state.route !== 'books') {
        state.route = 'books';
        if (location.hash !== '#/books') {
          history.replaceState(null, '', '#/books');
        }
      }
      render();
    }, 160);
  });

  // 键盘
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#modal-root').classList.contains('open')) {
      closeModal();
    }
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      var modal = $('#modal-root .modal');
      if (modal && $('#book-form')) submitBook(modal, activeBookId);
    }
  });

  // 拖拽导入
  document.addEventListener('dragover', function (e) {
    var dz = e.target.closest && e.target.closest('#dropzone');
    if (dz) { e.preventDefault(); dz.classList.add('over'); }
  });
  document.addEventListener('dragleave', function (e) {
    var dz = e.target.closest && e.target.closest('#dropzone');
    if (dz) dz.classList.remove('over');
  });
  document.addEventListener('drop', function (e) {
    var dz = e.target.closest && e.target.closest('#dropzone');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  /* =========================================================
   * 启动
   * ======================================================= */
  function routeFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var route = h.split('/')[0] || 'overview';
    if (['overview', 'books', 'shelf', 'categories', 'dict', 'data'].indexOf(route) < 0) route = 'overview';
    return route;
  }

  window.addEventListener('hashchange', function () {
    state.route = routeFromHash();
    state.page = 1;
    render();
    window.scrollTo({ top: 0 });
  });

  Store.init();
  state.route = routeFromHash();
  Store.subscribe(function () { updateChrome(); });
  render();

  if (Store.storageAvailable === false) {
    setTimeout(function () {
      toast('当前环境无法写入浏览器存储：数据只保存在内存里，刷新会丢失。请及时导出 JSON 备份，或改用本地服务器打开。', {
        error: true, duration: 15000
      });
    }, 600);
  }

  // 暴露给调试与自动化测试
  window.App = {
    state: state,
    render: render,
    go: go,
    openBookModal: openBookModal,
    views: {
      overview: viewOverview,
      books: viewBooks,
      shelf: viewShelf,
      categories: viewCategories,
      dict: viewDict,
      data: viewData
    }
  };
})();
