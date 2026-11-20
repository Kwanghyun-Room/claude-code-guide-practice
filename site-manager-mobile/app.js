// 모바일 웹앱: 목록을 누르면 브라우저로 열고, 다른 앱의 '공유'로 주소를 받아 추가·갱신한다.
(() => {
  const STORE_KEY = 'siteManager.mobile.v1';
  const C = window.SiteCommon;
  const $ = (id) => document.getElementById(id);

  // ---------- 상태 ----------
  let state = { baseUrl: '', sites: [] };
  let sync = null;
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) {}
  if (!Array.isArray(state.sites)) state.sites = [];

  function save(local) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    if (!local && sync) sync.changed();
  }
  const toPath = (v) => C.toPath(v, state.baseUrl);
  const fullUrl = (p) => C.fullUrl(state.baseUrl, p);

  // ---------- 화면 ----------
  function render() {
    $('baseText').textContent = state.baseUrl.replace(/^https?:\/\//i, '') || '(미설정)';
    const ul = $('list');
    ul.innerHTML = '';
    if (!state.sites.length) {
      ul.innerHTML = '<li class="empty" style="border:0;background:none;display:block">등록된 사이트가 없습니다.<br>＋ 버튼이나 브라우저의 \'공유\'로 추가하세요.</li>';
      return;
    }
    state.sites.forEach((s, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const url = fullUrl(s.path);
      if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
      else a.onclick = (e) => { e.preventDefault(); alert('메인 URL을 먼저 설정하세요.'); };
      a.innerHTML = '<div class="name"></div><div class="path"></div>';
      a.querySelector('.name').textContent = s.name;
      a.querySelector('.path').textContent = s.path || '/';
      const ctrl = document.createElement('div');
      ctrl.className = 'ctrl';
      ctrl.innerHTML = `
        <button type="button" class="up" aria-label="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="down" aria-label="아래로" ${i === state.sites.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="edit" aria-label="수정">✎</button>
        <button type="button" class="del" aria-label="삭제">✕</button>`;
      ctrl.querySelector('.up').onclick = () => move(i, i - 1);
      ctrl.querySelector('.down').onclick = () => move(i, i + 1);
      ctrl.querySelector('.edit').onclick = () => openSiteDialog(s);
      ctrl.querySelector('.del').onclick = () => {
        if (!confirm(`'${s.name}' 사이트를 목록에서 삭제할까요?`)) return;
        state.sites.splice(i, 1); save(); render();
      };
      li.append(a, ctrl);
      ul.appendChild(li);
    });
  }

  function move(from, to) {
    if (to < 0 || to >= state.sites.length) return;
    const [item] = state.sites.splice(from, 1);
    state.sites.splice(to, 0, item);
    save(); render();
  }

  $('editToggle').onclick = () => {
    const on = document.body.classList.toggle('editing');
    $('editToggle').classList.toggle('on', on);
    $('editToggle').textContent = on ? '완료' : '편집';
  };

  // ---------- 메인 URL ----------
  $('baseBtn').onclick = () => { $('baseInput').value = state.baseUrl; $('baseDialog').showModal(); };
  $('baseDialog').addEventListener('close', () => {
    if ($('baseDialog').returnValue !== 'ok') return;
    const raw = $('baseInput').value;
    const v = C.normalizeBase(raw);
    if (raw.trim() && !v) { alert('올바른 URL이 아닙니다.'); return; }
    if (v === state.baseUrl) return;
    state.baseUrl = v; save(); render();
  });

  // ---------- 추가 / 수정 ----------
  let editing = null;   // 수정 중인 사이트 (추가일 때 null)
  function openSiteDialog(site) {
    editing = site || null;
    $('siteDialogTitle').textContent = site ? '사이트 수정' : '사이트 추가';
    $('sitePath').value = site ? site.path : '';
    $('siteName').value = site ? site.name : '';
    $('sitePathHint').textContent = '';
    $('siteDialog').showModal();
    if (!site) $('sitePath').focus();
  }
  $('fab').onclick = () => openSiteDialog(null);
  $('sitePath').addEventListener('input', () => {
    const v = $('sitePath').value.trim();
    $('sitePathHint').textContent = v ? `저장될 경로: ${toPath(v) || '(메인 URL 그대로)'}` : '';
  });
  $('siteDialog').addEventListener('close', () => {
    if ($('siteDialog').returnValue !== 'ok') return;
    const raw = $('sitePath').value.trim();
    const path = toPath(raw);
    const name = $('siteName').value.trim() || C.nameFromPath(path, raw, state.baseUrl) || '(이름 없음)';
    if (editing) { editing.name = name; editing.path = path; }
    else {
      if (!raw && !$('siteName').value.trim()) return;
      state.sites.push({ id: C.uid(), name, path });
    }
    save(); render();
  });

  // ---------- 공유로 들어온 주소 ----------
  // 도메인이 메인 URL과 다르면 메인 URL 변경을 제안한다. 거절하면 null.
  async function pathFor(url) {
    const u = new URL(url);
    if (u.origin !== state.baseUrl) {
      const pick = await C.askChoice(
        `이 주소의 도메인(${u.host})이 메인 URL(${state.baseUrl.replace(/^https?:\/\//i, '') || '미설정'})과 다릅니다.\n\n` +
        `메인 URL을 ${u.origin} 으로 바꿀까요? 모든 사이트 주소에 함께 적용됩니다.`,
        [{ label: '메인 URL 바꾸고 저장', value: 'yes', primary: true }, { label: '취소', value: null }]);
      if (!pick) return null;
      state.baseUrl = u.origin;
    }
    return toPath(u.pathname + u.search + u.hash);
  }

  // 공유된 주소와 경로가 가장 많이 겹치는 사이트를 기본 선택으로
  function bestMatch(path) {
    const segs = (p) => (p || '').split(/[?#]/)[0].split('/').filter(Boolean);
    const target = segs(path);
    let best = 0, bestScore = -1;
    state.sites.forEach((s, i) => {
      const a = segs(s.path);
      let n = 0;
      while (n < a.length && n < target.length && a[n] === target[n]) n++;
      if (n > bestScore) { best = i; bestScore = n; }
    });
    return best;
  }

  let shared = null;
  function handleShare() {
    const q = new URLSearchParams(location.search);
    if (!q.has('url') && !q.has('text') && !q.has('title')) return;
    history.replaceState(null, '', location.pathname);   // 새로고침해도 다시 뜨지 않게
    const pick = (q.get('url') || '') + ' ' + (q.get('text') || '');
    const m = pick.match(/https?:\/\/[^\s<>"']+/i);
    if (!m) { alert('공유받은 내용에서 주소를 찾지 못했습니다.'); return; }
    shared = m[0];
    const path = C.toPath(shared, '');
    $('shareUrl').textContent = shared;
    $('shareName').value = (q.get('title') || '').trim() || C.nameFromPath(path, shared, '');
    const sel = $('shareTarget');
    sel.innerHTML = '';
    state.sites.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = `${s.name}  (${s.path || '/'})`;
      sel.appendChild(o);
    });
    if (state.sites.length) sel.selectedIndex = bestMatch(path);
    sel.disabled = $('shareUpdate').disabled = !state.sites.length;
    $('shareDialog').showModal();
  }

  $('shareAdd').onclick = async () => {
    const path = await pathFor(shared);
    if (path === null) return;
    state.sites.push({ id: C.uid(), name: $('shareName').value.trim() || C.nameFromPath(path, shared, state.baseUrl), path });
    save(); render();
    $('shareDialog').close();
  };
  $('shareUpdate').onclick = async () => {
    const site = state.sites.find(s => s.id === $('shareTarget').value);
    if (!site) return;
    const path = await pathFor(shared);
    if (path === null) return;
    site.path = path;
    save(); render();
    $('shareDialog').close();
  };
  $('shareClose').onclick = () => $('shareDialog').close();

  // ---------- 동기화 ----------
  sync = C.createSync({
    getData: () => ({ baseUrl: state.baseUrl, sites: state.sites }),
    applyData: (d) => { state.baseUrl = d.baseUrl; state.sites = d.sites; save(true); render(); },
    onStatus: (st, msg) => {
      $('syncDot').className = 'sync-dot ' + st;
      $('syncDot').title = msg;
      $('syncStatus').className = 'muted ' + st;
      $('syncStatus').textContent = msg;
      const banner = $('syncBanner');
      banner.textContent = (st === 'error' || st === 'conflict') ? msg : '';
      banner.classList.toggle('show', st === 'error' || st === 'conflict');
    },
  });
  function fillSyncForm() {
    const c = sync.config();
    $('syncRepo').value = c ? c.repo : '';
    $('syncPath').value = c ? c.path : '';
    $('syncToken').value = '';
    $('syncToken').placeholder = c && c.hasToken ? '토큰 저장됨 (바꿀 때만 입력)' : 'GitHub 토큰';
    $('syncOff').disabled = !c;
  }
  $('settingsBtn').onclick = () => { fillSyncForm(); $('settingsDialog').showModal(); };
  $('settingsClose').onclick = () => $('settingsDialog').close();
  $('syncOn').onclick = async () => {
    const repo = $('syncRepo').value.trim()
      .replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { alert('저장소는 "소유자/저장소" 형식으로 입력하세요. 예: myname/site-links'); return; }
    const path = $('syncPath').value.trim().replace(/^\/+/, '') || 'sites.json';
    $('syncOn').disabled = true;
    try {
      await sync.connect({ repo, path, token: $('syncToken').value.trim() }, C.chooseSource);
      fillSyncForm();
    } catch (e) {
      alert('연결 실패: ' + e.message);
    } finally {
      $('syncOn').disabled = false;
    }
  };
  $('syncOff').onclick = () => {
    if (!confirm('이 기기의 동기화를 끕니다. 저장된 토큰은 이 기기에서 지워지고, 목록은 이 기기에 그대로 남습니다.')) return;
    sync.disconnect(); fillSyncForm();
  };

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
      state.sites = d.sites.map(s => ({ id: s.id || C.uid(), name: String(s.name || ''), path: String(s.path || '') }));
      save(); render();
    } catch (err) {
      alert('불러오기 실패: ' + err.message);
    }
  };

  // ---------- 시작 ----------
  render();
  // 공유 화면은 최신 목록을 받아온 뒤에 띄운다 (오래된 목록 위에 추가했다가 덮어써지지 않게)
  sync.start().finally(handleShare);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
