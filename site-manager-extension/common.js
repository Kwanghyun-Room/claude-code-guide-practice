// PC 확장 프로그램과 모바일 웹앱이 함께 쓰는 코드: URL 처리 + GitHub 동기화.
// 모바일 웹앱은 GitHub Pages 배포 때 이 파일을 복사해서 쓴다 (.github/workflows/pages.yml).
(function (global) {
  'use strict';

  // ---------- URL 처리 ----------
  // 메인 URL은 프로토콜+도메인(+포트)만 남기고 뒷부분은 버린다
  function normalizeBase(v) {
    v = (v || '').trim();
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
  function toPath(v, base) {
    v = (v || '').trim();
    if (!v) return '';
    // abc.com 이 abc.com.other.net 같은 다른 도메인과 겹치지 않게, 메인 URL 바로 뒤가 / ? # 이거나 끝일 때만 자른다
    if (base && v.toLowerCase().startsWith(base.toLowerCase()) && /^([\/?#]|$)/.test(v.slice(base.length))) {
      v = v.slice(base.length);
    } else if (/^https?:\/\//i.test(v)) {
      try { const u = new URL(v); v = u.pathname + u.search + u.hash; } catch (e) {}
    }
    if (v && !/^[\/?#]/.test(v)) v = '/' + v;
    return v === '/' ? '' : v;
  }

  function fullUrl(base, path) {
    return base ? base + (path || '') : '';
  }

  // 제목을 못 가져왔을 때 경로로 이름을 만든다 (/board/notice → board notice)
  function nameFromPath(path, rawInput, base) {
    let pathname = (path || '').split(/[?#]/)[0];
    try { pathname = decodeURIComponent(pathname); } catch (e) {}
    const words = pathname.split('/')
      .map(w => w.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim())
      .filter(Boolean);
    if (words.length) return words.join(' ');
    try { return new URL(/^https?:\/\//i.test(rawInput || '') ? rawInput : base).hostname; } catch (e) { return ''; }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- GitHub 동기화 ----------
  // 비공개 저장소의 JSON 파일 하나에 { baseUrl, sites } 를 저장한다.
  // 토큰은 사용자가 직접 만들어 각 기기에서 입력하며, 그 기기의 브라우저 저장소에만 보관된다.
  const CONFIG_KEY = 'siteManager.sync.v1';

  function utf8ToB64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    const bin = atob((b64 || '').replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function readConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; } catch (e) { return null; }
  }
  function writeConfig(cfg) {
    try {
      if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CONFIG_KEY);
    } catch (e) {}
  }

  // 같은 내용인지 비교 (순서 포함)
  function sameData(a, b) {
    const pick = d => JSON.stringify({ baseUrl: d.baseUrl || '', sites: (d.sites || []).map(s => [s.id, s.name, s.path]) });
    return pick(a) === pick(b);
  }

  function cleanData(d) {
    return {
      baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : '',
      sites: Array.isArray(d.sites)
        ? d.sites.map(s => ({ id: String(s.id || uid()), name: String(s.name || ''), path: String(s.path || '') }))
        : [],
    };
  }

  class GitHubStore {
    constructor(cfg) {
      this.cfg = cfg;
      // apiBase 는 시험용 가짜 서버를 가리킬 때만 쓴다 (평소에는 GitHub API)
      let override = null;
      try { override = localStorage.getItem('siteManager.sync.apiBase'); } catch (e) {}
      const api = (cfg.apiBase || override || 'https://api.github.com').replace(/\/+$/, '');
      const path = (cfg.path || 'sites.json').split('/').map(encodeURIComponent).join('/');
      this.url = `${api}/repos/${cfg.repo}/contents/${path}`;
    }
    headers() {
      return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };
    }
    // { data, sha } 를 반환한다. 파일이 아직 없으면 { data: null, sha: null }
    async get() {
      const res = await fetch(this.url + `?t=${Date.now()}`, { headers: this.headers(), cache: 'no-store' });
      if (res.status === 404) {
        // 저장소 자체가 없거나 접근 권한이 없는 경우도 404라서 구분한다
        const repoRes = await fetch(this.url.split('/contents/')[0], { headers: this.headers(), cache: 'no-store' });
        if (!repoRes.ok) throw syncError(repoRes.status, '저장소를 찾을 수 없거나 토큰에 접근 권한이 없습니다.');
        return { data: null, sha: null };
      }
      if (!res.ok) throw syncError(res.status);
      const body = await res.json();
      return { data: cleanData(JSON.parse(b64ToUtf8(body.content))), sha: body.sha };
    }
    // 저장 후 새 sha 를 반환한다. 그 사이 다른 기기가 바꿨으면 conflict 오류.
    async put(data, sha) {
      const payload = {
        message: 'Update site list',
        content: utf8ToB64(JSON.stringify({ version: 1, ...cleanData(data), updatedAt: new Date().toISOString() }, null, 2) + '\n'),
      };
      if (sha) payload.sha = sha;
      const res = await fetch(this.url, {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409 || res.status === 422) throw Object.assign(syncError(res.status), { conflict: true });
      if (!res.ok) throw syncError(res.status);
      return (await res.json()).content.sha;
    }
  }

  function syncError(status, msg) {
    const known = {
      401: '토큰이 올바르지 않거나 만료되었습니다.',
      403: '토큰 권한이 부족합니다. Contents 읽기/쓰기 권한이 필요합니다.',
      404: '저장소를 찾을 수 없거나 토큰에 접근 권한이 없습니다.',
    };
    return Object.assign(new Error(msg || known[status] || `GitHub 응답 오류 (${status})`), { status });
  }

  // 앱과 동기화를 잇는 컨트롤러.
  //   getData()        : 지금 로컬 { baseUrl, sites }
  //   applyData(data)  : 원격 내용을 로컬에 반영 (이때 changed()를 다시 부르지 않아야 함)
  //   onStatus(state, message) : 'off' | 'syncing' | 'ok' | 'error' | 'conflict'
  function createSync({ getData, applyData, onStatus }) {
    let cfg = readConfig();
    let store = cfg ? new GitHubStore(cfg) : null;
    let sha = cfg ? cfg.sha || null : null;
    let dirty = false, busy = false, timer = null;

    const status = (s, m) => { try { onStatus(s, m || ''); } catch (e) {} };
    const remember = () => { if (cfg) { cfg.sha = sha; writeConfig(cfg); } };

    async function pull() {
      if (!store || busy) return;
      busy = true; status('syncing', '불러오는 중…');
      try {
        const remote = await store.get();
        if (!remote.data) {
          sha = await store.put(getData(), null);          // 원격 파일이 없으면 지금 목록으로 만든다
        } else if (dirty) {
          // 불러오는 사이에 이 기기에서 바뀐 내용이 있으면 덮어쓰지 않고, 곧 이어질 저장에 맡긴다
          sha = remote.sha;
        } else {
          sha = remote.sha;
          if (!sameData(remote.data, getData())) applyData(remote.data);
        }
        remember();
        if (!dirty) status('ok', '동기화됨');
      } catch (e) {
        status('error', e.message);
      } finally {
        busy = false;
      }
    }

    async function push() {
      if (!store) return;
      if (busy) { timer = setTimeout(push, 500); return; }
      busy = true; status('syncing', '저장 중…');
      try {
        sha = await store.put(getData(), sha);
        remember(); dirty = false;
        status('ok', '동기화됨');
      } catch (e) {
        if (e.conflict) {
          // 다른 기기에서 먼저 바꿨다: 원격 내용을 기준으로 한다
          try {
            const remote = await store.get();
            sha = remote.sha; remember(); dirty = false;
            if (remote.data) applyData(remote.data);
            status('conflict', '다른 기기에서 먼저 변경되어 최신 목록을 불러왔습니다. 방금 한 변경은 다시 해 주세요.');
          } catch (e2) {
            status('error', e2.message);
          }
        } else {
          status('error', e.message + ' (변경 내용은 이 기기에 남아 있고 다음에 다시 저장합니다)');
        }
      } finally {
        busy = false;
      }
    }

    function changed() {
      if (!store) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(push, 800);
    }

    // 다시 앱으로 돌아오면 다른 기기의 변경을 받아온다 (밀린 저장이 있으면 먼저 저장)
    function refresh() {
      if (!store) return;
      if (dirty) { clearTimeout(timer); push(); } else pull();
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    global.addEventListener('online', refresh);

    // 연결 설정. 원격에 이미 목록이 있고 이 기기 목록과 다르면 어느 쪽을 쓸지 묻는다.
    //   newCfg.token 이 비어 있으면 이미 저장된 토큰을 그대로 쓴다.
    //   choose(remote, local) → 'remote' | 'local' | null(연결 취소)
    async function connect(newCfg, choose) {
      newCfg = { ...newCfg, token: newCfg.token || (cfg && cfg.token) || '' };
      if (!newCfg.token) throw new Error('토큰을 입력하세요.');
      const testStore = new GitHubStore(newCfg);
      const prev = cfg;
      status('syncing', '연결 확인 중…');
      let remote;
      try { remote = await testStore.get(); } catch (e) { status('error', e.message); throw e; }
      const local = getData();
      let useRemote = !!remote.data;
      if (remote.data && local.sites.length && !sameData(remote.data, local)) {
        const pick = await choose(remote.data, local);
        if (!pick) { status(prev ? 'ok' : 'off', prev ? '동기화됨' : '연결을 취소했습니다.'); return false; }
        useRemote = pick === 'remote';
      }
      cfg = { ...newCfg, sha: remote.sha };
      store = testStore; sha = remote.sha;
      writeConfig(cfg);
      if (useRemote) {
        applyData(remote.data);
        status('ok', '동기화됨');
      } else {
        await push();
      }
      return true;
    }

    function disconnect() {
      cfg = null; store = null; sha = null; dirty = false;
      writeConfig(null);
      status('off', '동기화 꺼짐 (이 기기에만 저장)');
    }

    return {
      // 처음 불러오기가 끝나면 풀리는 Promise 를 돌려준다
      start() {
        if (store) return pull();
        status('off', '동기화 꺼짐 (이 기기에만 저장)');
        return Promise.resolve();
      },
      changed, refresh, connect, disconnect,
      config: () => (cfg ? { repo: cfg.repo, path: cfg.path || 'sites.json', hasToken: !!cfg.token } : null),
    };
  }

  // 버튼 여러 개 중 하나를 고르는 간단한 대화상자. 고른 버튼의 value, 닫으면 null.
  //   buttons: [{ label, value, primary? }]
  function askChoice(message, buttons) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'choice-dialog';
      const p = document.createElement('p');
      p.style.whiteSpace = 'pre-line';
      p.style.margin = '0 0 14px';
      p.textContent = message;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        if (b.primary) btn.className = 'primary';
        btn.onclick = () => { dlg.close(); resolve(b.value); };
        row.appendChild(btn);
      });
      dlg.append(p, row);
      dlg.addEventListener('cancel', () => resolve(null));
      dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  // 원격과 이 기기 목록이 다를 때 어느 쪽을 쓸지 묻는다 (두 앱 공통 문구)
  function chooseSource(remote, local) {
    return askChoice(
      `GitHub에 이미 목록이 있습니다.\n` +
      `· GitHub: 사이트 ${remote.sites.length}개, 메인 URL ${remote.baseUrl || '없음'}\n` +
      `· 이 기기: 사이트 ${local.sites.length}개, 메인 URL ${local.baseUrl || '없음'}\n\n어느 목록을 쓸까요?`,
      [
        { label: 'GitHub 목록을 이 기기로 가져오기', value: 'remote', primary: true },
        { label: '이 기기 목록으로 GitHub 덮어쓰기', value: 'local' },
        { label: '연결 취소', value: null },
      ]);
  }

  global.SiteCommon = { normalizeBase, toPath, fullUrl, nameFromPath, uid, createSync, askChoice, chooseSource };
})(typeof window !== 'undefined' ? window : globalThis);
