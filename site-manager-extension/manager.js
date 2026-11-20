(() => {
  const STORE_KEY = 'siteManager.v1';
  const $ = (id) => document.getElementById(id);

  // ---------- 상태 ----------
  let state = { baseUrl: '', sites: [], activeId: null, sideWidth: 340, sideCollapsed: false, settingsOpen: false };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) state = Object.assign(state, JSON.parse(raw));
    } catch (e) { /* 저장소 사용 불가 시 빈 상태로 시작 */ }
    if (!Array.isArray(state.sites)) state.sites = [];
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  load();

  // ---------- URL 처리 ----------
  // 메인 URL은 프로토콜+도메인(+포트)만 남기고 뒷부분은 버린다
  function normalizeBase(v) {
    v = v.trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
      const u = new URL(v);
      return u.hostname ? u.origin : '';
    } catch (e) {
      return '';
    }
  }
  // 전체 URL이 들어오면 메인 URL(또는 도메인) 부분을 떼고 뒷경로만 남긴다
  function toPath(v) {
    v = v.trim();
    if (!v) return '';
    const base = state.baseUrl;
    // abc.com 이 abc.com.other.net 같은 다른 도메인과 겹치지 않게, 메인 URL 바로 뒤가 / ? # 이거나 끝일 때만 자른다
    if (base && v.toLowerCase().startsWith(base.toLowerCase()) && /^([\/?#]|$)/.test(v.slice(base.length))) {
      v = v.slice(base.length);
    } else if (/^https?:\/\//i.test(v)) {
      try { const u = new URL(v); v = u.pathname + u.search + u.hash; } catch (e) {}
    }
    if (v && !/^[\/?#]/.test(v)) v = '/' + v;
    return v === '/' ? '' : v;
  }
  function fullUrl(path) {
    return state.baseUrl ? state.baseUrl + (path || '') : '';
  }

  // ---------- 메인 URL 영역 ----------
  function renderBase() {
    $('baseInput').value = state.baseUrl;
    $('baseShort').textContent = state.baseUrl.replace(/^https?:\/\//i, '') || '(미설정)';
    $('baseHint').className = 'hint';
    $('baseHint').textContent = state.baseUrl
      ? `사이트 ${state.sites.length}개가 이 주소를 사용합니다.`
      : '메인 URL을 먼저 입력하세요.';
  }
  function saveBase() {
    const raw = $('baseInput').value;
    const v = normalizeBase(raw);
    if (raw.trim() && !v) { alert('올바른 URL이 아닙니다.'); return; }
    const changed = v !== state.baseUrl;
    state.baseUrl = v;
    save();
    renderBase();
    renderList();
    if (changed) {
      $('baseHint').className = 'hint ok';
      $('baseHint').textContent = `변경 완료: 사이트 ${state.sites.length}개의 주소가 일괄 변경되었습니다.`;
      if (state.activeId) openSite(state.activeId);
    }
  }
  $('baseSave').onclick = saveBase;
  $('baseInput').onkeydown = (e) => { if (e.key === 'Enter') saveBase(); };

  // ---------- 사이트 추가 ----------
  // 이름 칸이 비어 있거나 자동으로 채운 값일 때만 자동 입력으로 덮어쓴다
  let nameAuto = true;
  let titleTimer = null, titleSeq = 0;

  // 제목을 못 가져왔을 때 경로로 이름을 만든다 (/board/notice → board notice)
  function nameFromPath(path, rawInput) {
    let pathname = (path || '').split(/[?#]/)[0];
    try { pathname = decodeURIComponent(pathname); } catch (e) {}
    const words = pathname.split('/').map(w => w.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim()).filter(Boolean);
    if (words.length) return words.join(' ');
    try { return new URL(/^https?:\/\//i.test(rawInput) ? rawInput : state.baseUrl).hostname; } catch (e) { return ''; }
  }

  // 페이지 <title>을 읽는다. 확장 프로그램은 사이트 접근 권한이 있어 CORS 제약 없이 읽을 수 있다.
  async function fetchTitle(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      // EUC-KR 등 한글 인코딩 사이트 대응: 헤더 또는 <meta charset>에서 인코딩을 찾는다
      let charset = (/charset=([\w-]+)/i.exec(res.headers.get('content-type') || '') || [])[1];
      if (!charset) {
        const head = new TextDecoder('ascii').decode(buf.slice(0, 4096));
        charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
      }
      let text;
      try { text = new TextDecoder(charset || 'utf-8').decode(buf); }
      catch (e) { text = new TextDecoder('utf-8').decode(buf); }
      const title = new DOMParser().parseFromString(text, 'text/html').title.trim();
      return title || null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function autoFillName() {
    const raw = $('addPath').value.trim();
    if (!nameAuto) return;
    if (!raw) { $('addName').value = ''; return; }
    const path = toPath(raw);
    $('addName').value = nameFromPath(path, raw);
    const url = /^https?:\/\//i.test(raw) ? raw : fullUrl(path);
    if (!url) return;
    const seq = ++titleSeq;
    $('addName').placeholder = '제목 가져오는 중…';
    fetchTitle(url).then(title => {
      if (seq !== titleSeq) return;            // 그 사이 입력이 바뀌었으면 무시
      $('addName').placeholder = '이름 (예: 공지사항)';
      if (title && nameAuto) $('addName').value = title;
    });
  }

  $('addName').addEventListener('input', () => {
    nameAuto = $('addName').value.trim() === '';
  });
  $('addPath').addEventListener('input', () => {
    const p = toPath($('addPath').value);
    $('addHint').textContent = $('addPath').value.trim()
      ? `저장될 경로: ${p || '(메인 URL 그대로)'}` : '';
    clearTimeout(titleTimer);
    titleTimer = setTimeout(autoFillName, 500);
  });
  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(titleTimer); titleSeq++;
    const rawPath = $('addPath').value;
    const path = toPath(rawPath);
    const name = $('addName').value.trim() || nameFromPath(path, rawPath.trim());
    if (!name && !rawPath.trim()) { $('addPath').focus(); return; }
    state.sites.push({ id: uid(), name: name || '(이름 없음)', path });
    save();
    $('addName').value = ''; $('addPath').value = ''; $('addHint').textContent = '';
    $('addName').placeholder = '이름 (예: 공지사항)';
    nameAuto = true;
    renderList(); renderBase();
    $('listWrap').scrollTop = $('listWrap').scrollHeight;
    $('addPath').focus();
  };

  // ---------- 목록 ----------
  let editingId = null;

  function renderList() {
    const ul = $('list');
    ul.innerHTML = '';
    $('count').textContent = state.sites.length ? `${state.sites.length}개` : '';
    if (!state.sites.length) {
      ul.innerHTML = '<li class="empty" style="cursor:default">등록된 사이트가 없습니다.</li>';
      return;
    }
    state.sites.forEach((s, i) => {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      if (s.id === state.activeId) li.classList.add('active');

      if (s.id === editingId) {
        li.style.cursor = 'default';
        li.innerHTML = `
          <div class="edit-box">
            <input class="e-name" placeholder="이름">
            <input class="e-path" placeholder="뒷경로" spellcheck="false">
            <div class="row" style="justify-content:flex-end">
              <button class="e-cancel" type="button">취소</button>
              <button class="e-save primary" type="button">저장</button>
            </div>
          </div>`;
        const n = li.querySelector('.e-name'), p = li.querySelector('.e-path');
        n.value = s.name; p.value = s.path;
        const commit = () => {
          s.name = n.value.trim() || s.name;
          s.path = toPath(p.value);
          editingId = null; save(); renderList();
          if (s.id === state.activeId) openSite(s.id);
        };
        li.querySelector('.e-save').onclick = commit;
        li.querySelector('.e-cancel').onclick = () => { editingId = null; renderList(); };
        [n, p].forEach(el => el.onkeydown = (e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { editingId = null; renderList(); }
        });
        ul.appendChild(li);
        setTimeout(() => n.focus(), 0);
        return;
      }

      li.draggable = true;
      li.title = fullUrl(s.path) || '메인 URL이 설정되지 않았습니다';
      li.innerHTML = `
        <span class="handle" title="끌어서 순서 변경">⋮⋮</span>
        <span class="num">${i + 1}</span>
        <div class="info">
          <div class="name"></div>
          <div class="path"></div>
        </div>
        <div class="actions">
          <button class="icon up" title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon down" title="아래로" ${i === state.sites.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon edit" title="수정">✎</button>
          <button class="icon del" title="삭제">✕</button>
        </div>`;
      li.querySelector('.name').textContent = s.name;
      li.querySelector('.path').textContent = s.path || '/';

      li.onclick = (e) => {
        if (e.target.closest('button')) return;
        openSite(s.id);
      };
      li.querySelector('.up').onclick = () => move(i, i - 1);
      li.querySelector('.down').onclick = () => move(i, i + 1);
      li.querySelector('.edit').onclick = () => { editingId = s.id; renderList(); };
      li.querySelector('.del').onclick = () => {
        if (!confirm(`'${s.name}' 사이트를 목록에서 삭제할까요?`)) return;
        state.sites.splice(i, 1);
        if (state.activeId === s.id) { state.activeId = null; showPlaceholder(); }
        save(); renderList(); renderBase();
      };
      bindDrag(li);
      ul.appendChild(li);
    });
    fitListHeight();
  }

  // 목록 영역 높이를 사이트 5개 분량으로 고정하고, 넘치면 스크롤한다
  const VISIBLE_ROWS = 5;
  function fitListHeight() {
    const wrap = $('listWrap');
    const rows = [...wrap.querySelectorAll('#list li')].slice(0, VISIBLE_ROWS);
    const rowsHeight = rows.reduce((h, li) => h + li.offsetHeight, 0);
    if (!rowsHeight) return;                  // 메뉴가 접혀 있어 잴 수 없을 때
    const cs = getComputedStyle(wrap);
    wrap.style.maxHeight = (rowsHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) + 'px';
  }

  function move(from, to) {
    if (to < 0 || to >= state.sites.length || from === to) return;
    const [item] = state.sites.splice(from, 1);
    state.sites.splice(to, 0, item);
    save(); renderList();
  }

  // ---------- 드래그 앤 드롭 ----------
  let dragId = null;
  function clearDropMarks() {
    document.querySelectorAll('#list li').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  }
  function bindDrag(li) {
    li.addEventListener('dragstart', (e) => {
      dragId = li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    });
    li.addEventListener('dragend', () => {
      dragId = null; li.classList.remove('dragging'); clearDropMarks();
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === li.dataset.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      clearDropMarks();
      li.classList.add(before ? 'drop-before' : 'drop-after');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === li.dataset.id) return;
      const before = li.classList.contains('drop-before');
      const from = state.sites.findIndex(s => s.id === dragId);
      const [item] = state.sites.splice(from, 1);
      let to = state.sites.findIndex(s => s.id === li.dataset.id);
      if (!before) to += 1;
      state.sites.splice(to, 0, item);
      dragId = null; save(); renderList();
    });
  }

  // ---------- 뷰 영역 ----------
  // 확장 프로그램의 webNavigation API로 뷰(iframe)의 실제 주소를 추적한다.
  const ext = (typeof chrome !== 'undefined' && chrome.webNavigation) ? chrome : null;
  let myTabId = null;
  let viewUrl = '';                            // 뷰에 지금 떠 있는 실제 주소

  const activeSite = () => state.sites.find(s => s.id === state.activeId);
  const sameUrl = (a, b) => {
    try { return new URL(a).href === new URL(b).href; } catch (e) { return a === b; }
  };

  function setViewUrl(url) {
    viewUrl = url || '';
    const s = activeSite();
    const moved = !!(s && viewUrl && !sameUrl(viewUrl, fullUrl(s.path)));
    $('viewUrl').textContent = viewUrl;
    $('viewUrl').title = viewUrl;
    $('viewBar').classList.toggle('moved', moved);
    const ok = !!(s && /^https?:/i.test(viewUrl));
    $('updateFromView').disabled = !ok || !moved;   // 주소가 그대로면 갱신할 것이 없다
    $('addFromView').disabled = !ok;
  }

  let msgTimer = null;
  function flash(text) {
    $('viewMsg').textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { $('viewMsg').textContent = ''; }, 2500);
  }

  function showPlaceholder(msg) {
    $('frame').removeAttribute('src');
    $('placeholder').style.display = 'flex';
    $('placeholder').textContent = msg || '왼쪽 목록에서 사이트를 클릭하면 여기에 열립니다.';
    $('viewTitle').textContent = '사이트 뷰';
    setViewUrl('');
  }
  function openSite(id) {
    const s = state.sites.find(x => x.id === id);
    if (!s) return;
    state.activeId = id; save();
    document.querySelectorAll('#list li').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    if (!state.baseUrl) {
      showPlaceholder('메인 URL이 설정되지 않았습니다. 왼쪽 위에서 먼저 입력하세요.');
      $('viewTitle').textContent = s.name;
      return;
    }
    $('viewTitle').textContent = s.name;
    const url = fullUrl(s.path);
    $('placeholder').style.display = 'none';
    $('frame').src = url;
    setViewUrl(url);
  }
  $('reloadBtn').onclick = () => { if (state.activeId) openSite(state.activeId); };

  if (ext) {
    // 이 탭 안에서 최상위 페이지의 직속 iframe(=뷰)이 이동할 때마다 주소를 받는다
    const onNav = (d) => {
      if (d.tabId !== myTabId || d.frameId === 0 || d.parentFrameId !== 0) return;
      if (!/^https?:/i.test(d.url)) return;
      setViewUrl(d.url);
    };
    ext.webNavigation.onCommitted.addListener(onNav);
    ext.webNavigation.onHistoryStateUpdated.addListener(onNav);       // 화면 전환 없이 주소만 바뀌는 사이트
    ext.webNavigation.onReferenceFragmentUpdated.addListener(onNav);  // #앵커 이동
  }

  // 뷰 주소를 저장할 경로로 바꾼다. 도메인이 다르면 메인 URL 변경을 제안하고, 거절하면 null.
  function viewPath() {
    let u;
    try { u = new URL(viewUrl); } catch (e) { return null; }
    if (u.origin !== state.baseUrl) {
      const ok = confirm(
        `지금 뷰의 도메인(${u.host})이 메인 URL(${state.baseUrl.replace(/^https?:\/\//i, '') || '미설정'})과 다릅니다.\n\n` +
        `메인 URL을 ${u.origin} 으로 바꿀까요?\n(모든 사이트 주소에 함께 적용됩니다)`);
      if (!ok) { flash('취소했습니다. 메인 URL이 달라 저장하지 않았습니다.'); return null; }
      state.baseUrl = u.origin;
      renderBase();
    }
    return toPath(u.pathname + u.search + u.hash);
  }

  // [현재 사이트 갱신] 선택한 사이트의 경로를 뷰의 지금 주소로 바꾼다
  $('updateFromView').onclick = () => {
    const s = activeSite();
    if (!s || !viewUrl) return;
    const path = viewPath();
    if (path === null) return;
    s.path = path;
    save(); renderList(); renderBase();
    setViewUrl(viewUrl);
    flash(`'${s.name}' 주소를 갱신했습니다.`);
  };

  // [새 사이트로 추가] 뷰의 지금 주소를 선택한 사이트 바로 아래에 새 항목으로 넣는다
  $('addFromView').onclick = () => {
    const idx = state.sites.findIndex(s => s.id === state.activeId);
    if (idx < 0 || !viewUrl) return;
    const url = viewUrl;
    const path = viewPath();
    if (path === null) return;
    const fallback = nameFromPath(path, '') || state.sites[idx].name;
    const item = { id: uid(), name: fallback, path };
    state.sites.splice(idx + 1, 0, item);
    state.activeId = item.id;                // 뷰에 떠 있는 것이 이 항목이 된다
    editingId = item.id;                     // 바로 이름을 고칠 수 있게 수정 상태로 연다
    if (state.sideCollapsed) { state.sideCollapsed = false; applyLayout(); }
    save(); renderList(); renderBase();
    $('viewTitle').textContent = item.name;
    setViewUrl(url);
    const li = document.querySelector(`#list li[data-id="${item.id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest' });

    // 페이지 제목으로 이름을 바꾼다 (사용자가 이미 고쳤으면 그대로 둔다)
    fetchTitle(url).then(title => {
      if (!title || item.name !== fallback) return;
      const input = editingId === item.id && document.querySelector(`#list li[data-id="${item.id}"] .e-name`);
      if (input && input.value !== fallback) return;
      item.name = title; save();
      if (input) input.value = title; else renderList();
      if (state.activeId === item.id) $('viewTitle').textContent = title;
    });
  };

  // 임베딩 차단 헤더(X-Frame-Options, CSP)를 이 탭의 iframe 응답에서만 제거한다
  async function enableFraming() {
    if (!ext || !ext.declarativeNetRequest) return;
    await ext.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [myTabId],
      addRules: [{
        id: myTabId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
          ],
        },
        condition: { tabIds: [myTabId], resourceTypes: ['sub_frame'] },
      }],
    });
  }

  // ---------- 백업 ----------
  $('exportBtn').onclick = () => {
    const data = JSON.stringify({ baseUrl: state.baseUrl, sites: state.sites }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `site-list-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.sites)) throw new Error('sites 항목이 없습니다');
      if (!confirm(`사이트 ${d.sites.length}개를 불러옵니다. 현재 목록(${state.sites.length}개)은 교체됩니다. 계속할까요?`)) return;
      state.baseUrl = typeof d.baseUrl === 'string' ? d.baseUrl : state.baseUrl;
      state.sites = d.sites.map(s => ({ id: s.id || uid(), name: String(s.name || ''), path: String(s.path || '') }));
      state.activeId = null;
      save(); renderBase(); renderList(); showPlaceholder();
    } catch (err) {
      alert('불러오기 실패: ' + err.message);
    }
  };

  // ---------- 패널 폭 조절 ----------
  (() => {
    const side = $('side'), rz = $('resizer');
    side.style.width = state.sideWidth + 'px';
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rz.classList.add('active');
      $('frame').style.pointerEvents = 'none';
      const onMove = (ev) => { side.style.width = Math.max(240, ev.clientX) + 'px'; };
      const onUp = () => {
        rz.classList.remove('active');
        $('frame').style.pointerEvents = '';
        state.sideWidth = side.getBoundingClientRect().width; save();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // ---------- 접기/펼치기 ----------
  function applyLayout() {
    document.body.classList.toggle('side-collapsed', !!state.sideCollapsed);
    document.body.classList.toggle('settings-open', !!state.settingsOpen);
    $('sideToggle').title = state.sideCollapsed ? '메뉴 펼치기' : '메뉴 접기';
    fitListHeight();
  }
  function toggleSide() { state.sideCollapsed = !state.sideCollapsed; save(); applyLayout(); }
  $('sideToggle').onclick = toggleSide;
  $('sideClose').onclick = toggleSide;
  $('settingsToggle').onclick = () => {
    state.settingsOpen = !state.settingsOpen; save(); applyLayout();
    if (state.settingsOpen) $(state.baseUrl ? 'addPath' : 'baseInput').focus();
  };

  // ---------- 시작 ----------
  if (!state.baseUrl) { state.settingsOpen = true; state.sideCollapsed = false; }  // 처음 쓸 때는 입력 영역을 열어둔다
  applyLayout();
  renderBase();
  renderList();
  setViewUrl('');

  (async () => {
    if (ext) {
      const tab = await ext.tabs.getCurrent();
      myTabId = tab ? tab.id : null;
      if (myTabId !== null) {
        try { await enableFraming(); } catch (e) { console.warn('임베딩 차단 해제 실패', e); }
      }
    } else {
      $('extNotice').hidden = false;           // 확장 프로그램이 아닌 일반 파일로 열었을 때
    }
    if (state.activeId) openSite(state.activeId);
  })();
})();
