// 툴바 아이콘을 누르면 관리 화면을 연다. 이미 열려 있으면 그 탭으로 이동한다.
const MANAGER_URL = chrome.runtime.getURL('manager.html');

chrome.action.onClicked.addListener(async () => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['TAB'],
    documentUrls: [MANAGER_URL],
  });
  const existing = contexts.find((c) => c.tabId >= 0);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: MANAGER_URL });
  }
});

// 관리 화면 탭이 닫히면 그 탭에 걸어둔 임베딩 차단 해제 규칙도 지운다
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.getSessionRules().then((rules) => {
    if (rules.some((r) => r.id === tabId)) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
    }
  });
});
