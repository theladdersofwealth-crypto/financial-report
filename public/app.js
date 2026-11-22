import { chartSeries, chartPeriod, chartPeriodChange, chartFrequency, candleSeries } from './chart-data.js';

const app = document.querySelector('#app');
const state = {
  user: null, demo: false, status: null, view: 'overview', horizon: 'day',
  market: null, marketFilter: '전체', marketSearch: '', users: [], activity: null,
  instrumentMarket: 'KR', instrumentQuery: '', instrumentResult: null, instrumentLoading: false,
  online: [], onlineCount: 0, threshold: 2, messages: [], chatDraft: '',
  ws: null, connected: false, reconnect: null, lastActivity: Date.now(),
  chatOpen: false, menuOpen: false, loading: false, sessionGeneration: 0,
};

const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  chart: 'M3 3v18h18 M6 15l4-5 4 3 7-8',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  layers: 'm12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2 M7 14h3 M14 14h3 M7 17h3',
  source: 'M12 3 3 8l9 5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  activity: 'M2 12h4l3-9 6 18 3-9h4',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6.5 6a7 7 0 0 1 11.5 0l2 3 M4 15l2 3a7 7 0 0 0 11.5 0',
  chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  menu: 'M3 6h18 M3 12h18 M3 18h18', close: 'm6 6 12 12 M6 18 18 6',
  chat: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0 M7 10h10 M7 14h6',
  send: 'm22 2-7 20-4-9-9-4z M22 2 11 13',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  lock: 'M6 10h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2 M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01',
  plus: 'M12 5v14 M5 12h14', external: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
  logout: 'M9 3H3v18h6 M10 12h12 M17 7l5 5-5 5',
  check: 'm5 12 4 4L19 6', brief: 'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',
};

function E(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function icon(name, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attrs = {viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `icon ${extraClass}`};
  Object.entries(attrs).forEach(([key, value]) => svg.setAttribute(key, value));
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.info);
  svg.append(path);
  return svg;
}
function B(label, action, style = '', iconName = null, attrs = {}) {
  return E('button', {type: 'button', class: `button ${style}`, onClick: action, ...attrs}, iconName ? icon(iconName) : null, label);
}
function iconButton(name, title, action, attrs = {}) {
  return E('button', {type: 'button', class: 'icon-button', title, 'aria-label': title, onClick: action, ...attrs}, icon(name));
}
function badge(text, type = '') { return E('span', {class: `badge ${type}`}, text); }
function brand() {
  return E('div', {class: 'brand'}, E('div', {class: 'brand-mark', 'aria-hidden': 'true'}, 'M'), E('div', {}, E('div', {class: 'brand-name'}, '마켓데스크'), E('div', {class: 'brand-caption'}, 'THE MARKET DESK')));
}
function empty(title, description, name = 'source') {
  return E('div', {class: 'empty-state'}, icon(name), E('strong', {}, title), E('p', {}, description));
}
function panelHead(title, subtitle = '', action = null, iconName = null) {
  return E('div', {class: 'panel-head'}, E('div', {}, E('h2', {class: 'panel-title'}, iconName ? icon(iconName) : null, title), subtitle ? E('p', {class: 'panel-subtitle'}, subtitle) : null), action);
}
function toast(message, error = false) {
  const node = E('div', {class: `toast ${error ? 'error' : ''}`}, message);
  document.querySelector('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 5500);
}
function errorText(error) { return error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
async function api(path, options = {}) {
  const response = await fetch(path, {credentials: 'same-origin', ...options, headers: {'Content-Type': 'application/json', ...options.headers}, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('서버 응답을 확인할 수 없습니다. 연결 상태를 확인해 주세요.'); }
  if (!response.ok || data.error) {
    const error = new Error(typeof data.error === 'string' ? data.error : '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return data;
}
async function busy(button, callback) {
  if (button.disabled) return;
  button.disabled = true;
  try { await callback(); } catch (error) { toast(errorText(error), true); }
  finally { if (button.isConnected) button.disabled = false; }
}
function field(label, name, options = {}) {
  const id = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const input = E('input', {id, name, required: true, ...options});
  return {input, node: E('div', {class: 'field'}, E('label', {for: id}, label), input)};
}
const pinFields = {inputmode: 'numeric', pattern: '[0-9]{4}', minlength: 4, maxlength: 4};
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function link(text, url) {
  const href = safeUrl(url);
  return href ? E('a', {href, target: '_blank', rel: 'noopener noreferrer', class: 'source-link'}, text, icon('external')) : E('span', {}, text);
}
function dateText(value, options = {}) {
  if (!value) return '관측시각 미제공';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value} · 일별`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, ...options}).format(date);
}
function shortTime(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '시각 미정';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false}).format(date) : '';
}
function sourceName(source) {
  if (typeof source === 'string') return source;
  return source?.name || source?.provider || '출처 미제공';
}
function hasValue(quote) { return quote?.value !== null && quote?.value !== undefined && quote?.value !== '' && Number.isFinite(Number(quote.value)); }
function changeClass(change) { return Number(change) > 0 ? 'gain' : Number(change) < 0 ? 'loss' : 'neutral'; }
function formatValue(quote) {
  if (!hasValue(quote)) return '—';
  const value = Number(quote.value);
  let decimals = quote.decimals;
  if (!Number.isInteger(decimals)) decimals = /^kr_(foreign|pension)_/.test(quote.id) ? 2 : ['금리', 'rates', 'yields'].includes(quote.group) || quote.unit === '%' ? 2 : Math.abs(value) >= 10000 ? 0 : 2;
  return value.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
}
function formatChange(quote) {
  if (quote.change === null || quote.change === undefined || !Number.isFinite(Number(quote.change))) return '변동 데이터 없음';
  const change = Number(quote.change);
  const unit = quote.changeUnit || '%';
  return `${change > 0 ? '+' : ''}${change.toFixed(unit.toLowerCase().includes('bp') ? 1 : 2)}${unit}`;
}
function normalizedQuotes() { return state.market?.quotes?.length ? state.market.quotes : coreQuotes(); }
function coreQuotes() {
  return [
    ['sp500', 'S&P 500', '주식', 'pt'], ['nasdaq', '나스닥 100', '주식', 'pt'], ['sox', '필라델피아 반도체', '주식', 'pt'],
    ['us10y', '미 국채 10년', '금리', '%'], ['us2y', '미 국채 2년', '금리', '%'], ['usdkrw', '달러 / 원', '외환', 'KRW'],
    ['dxy', '달러 인덱스', '외환', 'pt'], ['wti', 'WTI 원유', '원자재', 'USD/bbl'], ['gold', '금', '원자재', 'USD/oz'],
    ['copper', '구리', '원자재', 'USD/lb'], ['vix', 'VIX', '변동성', 'pt'], ['btc', '비트코인', '디지털자산', 'USD'],
  ].map(([id, name, group, unit]) => ({id, name, group, unit, value: null, change: null, status: 'unconfigured', source: null}));
}
function defaultMarket() {
  return {asOf: null, mode: 'unconfigured', quotes: coreQuotes(), sectors: [], leaders: [], events: [], outlooks: [], summary: {headline: '시장의 연결고리, 데이터에서 시작합니다.', points: ['시세 공급사가 연결되면 미국 증시·금리·환율·원자재를 한 화면에서 확인할 수 있습니다.', '확인된 지표와 출처를 바탕으로 한국시장 영향과 기간별 전망을 제공합니다.', '현재 연결되지 않은 항목은 수치와 전망을 생성하지 않습니다.']}, sources: []};
}

function demoMarket() {
  const numbers = [6012.84, 19234.72, 4891.35, 4.32, 4.15, 1421.50, 106.24, 72.85, 2681.40, 4.23, 17.62, 97320];
  const changes = [0.82, 1.24, 2.16, -4.2, -2.8, -0.34, -0.28, 1.06, 0.67, 1.32, -4.08, 2.45];
  const wave = [0.1, 0.21, 0.16, 0.35, 0.3, 0.42, 0.34, 0.49, 0.67, 0.61, 0.76, 0.85];
  const quotes = coreQuotes().map((q, i) => ({...q, value: numbers[i], change: changes[i], changeUnit: q.group === '금리' ? 'bp' : '%', status: 'demo', source: '체험용 예시', observedAt: null, history: wave.map((x, j) => numbers[i] * (1 + (changes[i] > 0 ? x - 1 : 1 - x) * .015) + (j % 3) * numbers[i] * .0008)}));
  const extras = [['kospi', '코스피', '주식', 'pt', 2540.72, .47], ['kosdaq', '코스닥', '주식', 'pt', 738.42, .93], ['eth', '이더리움', '디지털자산', 'USD', 3265.84, 1.87], ['silver', '은', '원자재', 'USD/oz', 30.21, 1.24], ['nickel', '니켈', '원자재', 'USD/t', 15780, -.62], ['brent', '브렌트 원유', '원자재', 'USD/bbl', 76.82, .94], ['kr3y', '한국 국고채 3년', '금리', '%', 2.68, -1.2], ['kr10y', '한국 국고채 10년', '금리', '%', 2.94, -1.6], ['usdjpy', '달러 / 엔', '외환', 'JPY', 154.32, -.18], ['usdcnh', '달러 / 위안', '외환', 'CNH', 7.28, -.12]];
  extras.forEach(([id, name, group, unit, value, change]) => quotes.push({id, name, group, unit, value, change, changeUnit: group === '금리' ? 'bp' : '%', status: 'demo', source: '체험용 예시'}));
  const outlooks = [
    {horizon: 'day', title: '반도체 강세와 금리 하락, 국내 성장주에 우호적인 출발 여건', kospi: '반도체 대형주 중심의 상대적 강세를 가정합니다. 원화 강세와 외국인 선물 매수의 동행을 확인합니다.', kosdaq: '금리 부담 완화는 성장주에 긍정적입니다. 거래대금이 동반되는 업종 중심으로 상승 확산 여부를 봅니다.', evidence: ['미국 반도체 지수가 시장 대비 강세를 보이는 가상 상황', '미 국채 금리와 달러가 함께 하락하는 가상 상황'], counter: ['유가 상승이 장기화되면 물가 부담으로 해석될 수 있음', '국내 수급이 해외 흐름에 동행하지 않을 수 있음'], invalidation: ['달러·원 상승 전환과 외국인 선물 순매도가 함께 나타날 경우 재평가'], confidence: '예시 · 평가 없음'},
    {horizon: 'short', title: '첫날의 반응보다 수급과 주도 업종의 지속성을 확인할 구간', kospi: '해외 반도체 강세가 국내 실적 기대와 수급으로 이어지는지 관찰하는 예시입니다.', kosdaq: '주도주의 상승이 다른 성장 업종으로 확산되는지를 확인합니다.', evidence: ['미국 기술주의 연속 강세를 가정', '원화 안정이 유지되는 조건'], counter: ['단기 급등 이후 차익실현 가능성'], invalidation: ['반도체 상대강도 약화 또는 장중 원화 변동성 확대'], confidence: '예시 · 평가 없음'},
    {horizon: 'week', title: '경제지표 발표 이후 금리 기대가 유지되는지가 주간 방향의 핵심', kospi: '기업 실적과 글로벌 금리 방향을 함께 확인하는 주간 시나리오 예시입니다.', kosdaq: '이벤트 전후 변동성 확대와 거래대금 변화를 확인합니다.', evidence: ['물가 둔화가 확인된다는 가정', '미국 실적 발표의 시장 기대 충족을 가정'], counter: ['예상보다 강한 물가 지표가 금리 기대를 바꿀 수 있음'], invalidation: ['미 국채 금리 급등과 신용스프레드 확대가 동반될 때'], confidence: '예시 · 평가 없음'},
    {horizon: 'month', title: '금리와 이익 전망이 같은 방향으로 움직이는지 점검할 한 달', kospi: '기업 이익 추정치 상향과 수출 회복이 확인되는 업종의 상대적 우위를 가정합니다.', kosdaq: '금리 안정에 더해 실적 확인이 필요한 시나리오입니다.', evidence: ['실질금리 안정이 유지되는 가정', '이익 추정치의 개선을 가정'], counter: ['달러 강세 재개와 에너지 비용 상승 가능성'], invalidation: ['이익 전망 하향이 광범위하게 이어질 경우'], confidence: '예시 · 평가 없음'},
    {horizon: 'quarter', title: '3~6개월은 경기·정책·기업 이익의 조합으로 판단합니다', kospi: '수출 경기와 이익 사이클이 동반 개선되는 조건에서의 중기 시나리오 예시입니다.', kosdaq: '유동성 확대만으로 방향을 단정하지 않고 자금조달 환경과 실적을 함께 봅니다.', evidence: ['통화정책 경로의 불확실성이 줄어든다는 가정', '글로벌 수요 회복과 실적 개선의 동행을 가정'], counter: ['지정학적 공급 충격과 정책 전환 위험'], invalidation: ['경기 지표와 이익 전망이 함께 악화될 때'], confidence: '예시 · 평가 없음'},
  ];
  return {mode: 'demo', asOf: null, quotes, outlooks,
    summary: {headline: '금리는 내려가고, 기술주는 앞서갑니다.\n시장의 시선은 다시 성장으로.', points: ['[예시] 미국 기술주·반도체의 상대적 강세가 국내 반도체 업종에 우호적인 조건을 만듭니다.', '[예시] 달러와 국채금리의 동반 하락은 성장주 부담을 덜지만, 유가 상승은 확인할 변수입니다.', '[예시] 국내장에서는 원화 안정과 외국인 선물 수급이 이 흐름을 확인하는지 살펴봅니다.']},
    sectors: [['정보기술', 1.68], ['커뮤니케이션', 1.24], ['경기소비재', .92], ['금융', .38], ['산업재', .21], ['에너지', -.72], ['헬스케어', -.18], ['필수소비재', -.34]].map(([name, change]) => ({name, change, changeUnit: '%'})),
    leaders: [['NVDA', '엔비디아', 138.24, 3.12], ['AAPL', '애플', 228.42, 1.18], ['MSFT', '마이크로소프트', 421.84, .86], ['TSLA', '테슬라', 342.16, -1.42]].map(([symbol, name, value, change]) => ({symbol, name, value, change, changeUnit: '%', unit: 'USD'})),
    events: [{name: '미국 소비자물가지수', time: '22:30', country: 'US', importance: 3, description: '예시 일정 · 실제 발표일과 무관합니다. 금리 기대 변화를 확인합니다.'}, {name: '한국은행 기준금리 결정', time: '10:00', country: 'KR', importance: 3, description: '예시 일정 · 실제 발표일과 무관합니다. 국내 금리와 원화 반응을 확인합니다.'}, {name: '미국 신규 실업수당 청구건수', time: '22:30', country: 'US', importance: 2, description: '예시 일정 · 실제 발표일과 무관합니다. 고용의 둔화 속도를 점검합니다.'}],
    sources: [{name: '화면 체험용 생성 데이터', status: 'demo', note: '시세·전망·일정은 모두 화면 구성을 설명하기 위한 가상 예시입니다. 실제 시장 데이터 공급사에 연결되지 않았습니다.'}],
  };
}

function renderWelcome(mode = 'pin') {
  state.user = null;
  state.calendar = null;
  const story = E('section', {class: 'welcome-story'}, brand(), E('div', {class: 'story-copy'}, E('p', {class: 'eyebrow'}, 'A WIDER VIEW. A CLEARER DECISION.'), E('h1', {}, '세계의 움직임을,', E('br'), E('span', {}, '투자의 시선으로.')), E('p', {class: 'story-description'}, '밤사이의 미국 증시부터 오늘의 한국시장까지.', E('br'), '흩어진 숫자와 흐름을 연결하는 당신의 금융 데스크.'), E('div', {class: 'story-visual'}, E('div', {class: 'story-line'}, E('span', {}, 'GLOBAL → KOREA'), E('span', {}, 'CONTEXT MATTERS')), storyIllustration(), E('div', {class: 'story-tags'}, ['글로벌 시장', '한국시장 영향', '기간별 시나리오'].map(x => E('span', {}, x))))), E('div', {class: 'story-foot'}, E('span', {}, 'A DESK FOR THE THOUGHTFUL INVESTOR'), E('span', {}, 'SEOUL · GLOBAL')), E('div', {class: 'story-decoration', 'aria-hidden': 'true'}));
  const setup = mode === 'setup';
  const registerMode = mode === 'register';
  const pinMode = mode === 'pin' || registerMode;
  const subtitle = setup ? '최초 관리자 계정을 안전하게 설정합니다.\n발급받은 초기 설정 토큰을 입력해 주세요.'
    : registerMode ? '닉네임, 생년월일 6자리, 성별, 숫자 PIN 4자리로 회원가입합니다. 생년월일과 성별은 다른 회원에게 표시되지 않습니다.'
    : pinMode ? '가입한 닉네임과 숫자 PIN 4자리로 로그인하세요. 신규 회원은 회원가입에서 정보를 등록할 수 있어요.'
    : '기존 아이디와 비밀번호로 로그인하세요.';
  const modeTabs = !setup ? E('div', {class: 'welcome-mode-tabs', role: 'tablist', 'aria-label': '입장 방식 선택'},
    [['pin', 'PIN 로그인'], ['register', '회원가입'], ['login', '아이디 로그인']].map(([id, label]) =>
      E('button', {type: 'button', role: 'tab', 'aria-selected': String(mode === id), class: `welcome-mode-tab ${mode === id ? 'active' : ''}`, onClick: () => renderWelcome(id)}, label))) : null;
  const content = E('div', {class: 'welcome-form'}, E('p', {class: 'eyebrow'}, setup ? 'FIRST THINGS FIRST' : 'WELCOME TO YOUR DESK'), E('h2', {}, setup ? '첫 번째 관리자 만들기' : '오늘의 흐름을 읽어보세요'), E('p', {class: 'welcome-subtitle'}, subtitle), modeTabs);
  if (state.status?.error) content.append(E('p', {class: 'connection-note'}, '서버 연결을 확인하지 못했습니다. 로그인은 연결 복구 후 가능하며 화면 체험은 지금 이용할 수 있습니다.'));
  if (!setup && state.status && !state.status.initialized) content.append(E('div', {class: 'setup-notice'}, state.status.setupAvailable ? '아직 관리자가 설정되지 않았습니다. 초기 설정 토큰이 있다면 첫 관리자 계정을 만들어 주세요.' : '관리자 초기 설정이 필요합니다. 운영자가 서버의 초기 설정을 완료한 후 로그인할 수 있습니다.'));
  const form = E('form', {onSubmit: async event => {
    event.preventDefault();
    errorNode.textContent = '';
    if (setup && password.input.value !== confirm.input.value) { errorNode.textContent = '비밀번호가 서로 다릅니다.'; return; }
    await busy(submit, async () => {
      try {
        const payload = pinMode ? {nickname: username.input.value.trim(), pin: password.input.value}
          : {username: username.input.value.trim(), password: password.input.value};
        if (registerMode) Object.assign(payload, {birth6: birth.input.value.trim(), gender: gender.value});
        if (setup) Object.assign(payload, {token: token.input.value.trim(), name: name.input.value.trim()});
        const result = await api(setup ? '/api/setup' : registerMode ? '/api/pin-register' : pinMode ? '/api/pin-login' : '/api/login', {method: 'POST', body: payload});
        password.input.value = '';
        if (setup) { token.input.value = ''; confirm.input.value = ''; }
        if (!result.user) throw new Error('로그인 응답에 계정 정보가 없습니다.');
        state.demo = false;
        state.user = result.user;
        state.sessionGeneration++;
        state.market = defaultMarket();
        state.view = 'overview';
        renderDesk();
        await loadDashboard();
        if (state.user?.mustChangePassword) passwordModal(true);
      } catch (error) { errorNode.textContent = errorText(error); }
    });
  }});
  const token = setup ? field('초기 설정 토큰', 'token', {type: 'password', autocomplete: 'off', placeholder: '발급받은 토큰 입력'}) : null;
  const name = setup ? field('표시 이름', 'name', {autocomplete: 'name', placeholder: '대화방과 계정에 표시할 이름', maxlength: 40}) : null;
  const username = field(pinMode ? '닉네임' : '아이디', pinMode ? 'nickname' : 'username', {autocomplete: 'username', placeholder: pinMode ? '닉네임을 입력하세요' : '아이디를 입력하세요', maxlength: pinMode ? 24 : 40, minlength: setup ? 3 : 1, pattern: setup ? '[a-zA-Z0-9._-]{3,40}' : undefined, autocapitalize: 'none', spellcheck: 'false'});
  const password = field(pinMode ? '4자리 PIN' : '비밀번호', pinMode ? 'pin' : 'password', {type: 'password', autocomplete: setup ? 'new-password' : 'current-password', placeholder: pinMode ? '숫자 4자리' : setup ? '12~128자의 비밀번호' : '비밀번호를 입력하세요', minlength: setup ? 12 : 1, maxlength: 128, ...(pinMode ? pinFields : {})});
  const confirm = setup ? field('비밀번호 확인', 'confirmPassword', {type: 'password', autocomplete: 'new-password', placeholder: '비밀번호를 다시 입력하세요', minlength: 12, maxlength: 128}) : null;
  const birth = registerMode ? field('생년월일 6자리', 'birth6', {type: 'text', inputmode: 'numeric', pattern: '[0-9]{6}', minlength: 6, maxlength: 6, placeholder: '예: 950705', autocomplete: 'off', required: true}) : null;
  const gender = registerMode ? E('select', {id: 'registerGender', name: 'gender', required: true}, E('option', {value: '', disabled: true, selected: true}, '성별을 선택해 주세요'), E('option', {value: '남'}, '남'), E('option', {value: '여'}, '여')) : null;
  const genderNode = registerMode ? E('div', {class: 'field'}, E('label', {for: 'registerGender'}, '성별'), gender) : null;
  const errorNode = E('p', {class: 'form-error', role: 'alert'});
  const submit = E('button', {type: 'submit', class: 'button primary full'}, setup ? '관리자 계정 만들기' : registerMode ? '회원가입하고 입장' : '내 데스크로 입장', icon('arrow'));
  if (setup) form.append(token.node, name.node);
  form.append(username.node);
  if (registerMode) form.append(birth.node, genderNode);
  form.append(password.node);
  if (registerMode) form.append(E('p', {class: 'field-help'}, '생년월일은 YYMMDD 형식(950705)으로 입력합니다. PIN은 서버에 단방향 해시로 저장되며, 로그인 때에는 닉네임과 PIN만 사용합니다.'));
  if (setup) form.append(confirm.node, E('p', {class: 'field-help'}, '설정 토큰은 최초 계정 생성에만 사용되며 브라우저에 저장하지 않습니다.'));
  form.append(errorNode, submit);
  content.append(form);
  if (registerMode) content.append(E('div', {class: 'welcome-switch'}, E('button', {type: 'button', class: 'text-button', onClick: () => renderWelcome('pin')}, '이미 회원이에요 · 닉네임 + PIN 로그인')));
  if (mode === 'pin') content.append(E('div', {class: 'welcome-switch'}, E('button', {type: 'button', class: 'button primary small', onClick: () => renderWelcome('register')}, '처음이세요? 회원가입')));
  if (pinMode) content.append(E('div', {class: 'welcome-switch'}, E('button', {type: 'button', class: 'text-button', onClick: () => renderWelcome('login')}, '기존 아이디·비밀번호로 로그인')));
  if (!setup && state.status?.setupAvailable && !state.status.initialized) content.append(E('div', {class: 'welcome-switch'}, E('button', {type: 'button', class: 'text-button', onClick: () => renderWelcome('setup')}, icon('lock'), '최초 관리자 설정')));
  if (!pinMode) content.append(E('div', {class: 'welcome-switch'}, E('button', {type: 'button', class: 'text-button', onClick: () => renderWelcome()}, '닉네임과 PIN으로 입장')));
  content.append(E('div', {class: 'welcome-or'}, '먼저 둘러보고 싶다면'), E('button', {type: 'button', class: 'demo-entry', onClick: enterDemo}, icon('grid'), E('span', {}, E('strong', {}, '화면 체험하기'), E('small', {}, '가상 데이터로 데스크의 모든 화면을 살펴보세요')), icon('arrow', 'arrow')), E('p', {class: 'welcome-form-footer'}, '데이터의 출처와 시점을 함께, 전망의 근거와 한계도 함께.', E('br'), '시장의 방향을 단정하지 않고 판단의 맥락을 제공합니다.'));
  app.replaceChildren(E('div', {class: 'welcome'}, story, E('main', {class: 'welcome-form-area', id: 'main-content'}, content, E('div', {class: 'welcome-version'}, 'THE MARKET DESK'))));
}
function storyIllustration() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 410 95');
  svg.setAttribute('aria-label', '세계를 연결하는 흐름의 장식 일러스트. 시세 차트가 아닙니다.');
  const specs = [{d: 'M0 75H410 M0 42H410 M0 10H410', stroke: '#ffffff0d'}, {d: 'M1 75 25 65 51 69 77 50 103 56 129 36 155 47 181 29 207 37 233 18 259 26 285 12 311 22 337 8 363 17 388 2 409 10', stroke: '#d5b781'}, {d: 'M1 87 25 77 51 80 77 68 103 71 129 56 155 65 181 47 207 52 233 40 259 46 285 32 311 39 337 25 363 34 388 20 409 25', stroke: '#65829e'}];
  specs.forEach(attrs => { const path = document.createElementNS(svg.namespaceURI, 'path'); Object.entries({...attrs, fill: 'none', 'stroke-width': '1.5'}).forEach(([k,v]) => path.setAttribute(k, v)); svg.append(path); });
  return svg;
}
function enterDemo() {
  disconnect();
  state.demo = true;
  state.sessionGeneration++;
  state.user = {id: 'demo-self', username: 'demo', name: '체험 사용자', role: 'admin', mustChangePassword: false};
  state.market = demoMarket();
  state.view = 'overview'; state.horizon = 'day'; state.threshold = 2;
  state.online = [{id: 'demo-self', name: '체험 사용자', active: true}, {id: 'demo-a', name: '예시 회원 A', active: true}, {id: 'demo-b', name: '예시 회원 B', active: true}];
  state.onlineCount = 3;
  state.messages = [{id: 'demo-m1', name: '예시 회원 A', text: '화면 체험에 오신 것을 환영합니다. 이 대화와 접속자는 모두 가상 예시입니다.', createdAt: null}, {id: 'demo-m2', name: '예시 회원 B', text: '메시지를 남겨보세요. 전송 내용은 현재 브라우저 안에서만 보이고 서버에 저장되지 않습니다.', createdAt: null}];
  state.users = [{...state.user, createdAt: null, disabled: false}, {id: 'demo-a', username: 'sample_a', name: '예시 회원 A', role: 'member', disabled: false, mustChangePassword: true}, {id: 'demo-b', username: 'sample_b', name: '예시 회원 B', role: 'member', disabled: false, mustChangePassword: false}];
  state.activity = {sessions: state.users.map((user, i) => ({id: `demo-session-${i}`, name: user.name, username: user.username, active: true, loginAt: null, lastSeen: null, connectedSeconds: 1080, activeSeconds: 680})), totals: state.users.map(user => ({userId: user.id, name: user.name, username: user.username, loginCount: 1, connectedSeconds: 1080, activeSeconds: 680, lastSeen: null}))};
  renderDesk();
}

const navigation = [
  {id: 'overview', title: '시황 데스크', english: 'MARKET OVERVIEW', icon: 'grid', subtitle: '세계의 움직임과 한국시장의 연결고리를 한눈에.'},
  {id: 'markets', title: '자산별 시장', english: 'GLOBAL MARKETS', icon: 'globe', subtitle: '주식·금리·외환·원자재·가상자산의 같은 날, 다른 움직임.'},
  {id: 'instrument', title: '개별 종목 검색', english: 'INSTRUMENT SEARCH', icon: 'search', subtitle: '국내 종목코드·미국 주식 티커·바이낸스 USDT 현물 시세를 직접 확인합니다.'},
  {id: 'outlooks', title: '기간별 전망', english: 'MARKET PERSPECTIVE', icon: 'chart', subtitle: '오늘부터 3~6개월까지, 근거와 조건을 함께 읽는 시나리오.'},
  {id: 'calendar', title: '경제 일정', english: 'WHAT TO WATCH', icon: 'calendar', subtitle: '시장의 다음 움직임을 바꿀 주요 이벤트를 확인하세요.'},
  {id: 'sources', title: '데이터 출처', english: 'DATA & TRANSPARENCY', icon: 'source', subtitle: '어디에서 왔는지, 언제 관측됐는지. 숫자의 맥락을 확인하세요.'},
  {id: 'users', title: '회원 관리', english: 'MEMBER MANAGEMENT', icon: 'users', admin: true, subtitle: '계정 생성과 접근 권한을 관리합니다.'},
  {id: 'activity', title: '접속 현황', english: 'ACCESS & ACTIVITY', icon: 'activity', admin: true, subtitle: '로그인 세션과 대화방 운영 상태를 확인합니다.'},
];
function renderDesk() {
  document.querySelector('#modal-root').replaceChildren();
  const sidebar = E('aside', {class: 'sidebar', id: 'sidebar', 'aria-label': '주 메뉴'}, brand(), E('p', {class: 'nav-section-title'}, 'YOUR MARKET DESK'));
  const publicNav = E('nav', {class: 'nav-list', 'aria-label': '시장 메뉴'});
  const groups=[
    ['시장 확인',['overview','markets','instrument']],
    ['분석 · 일정',['outlooks','calendar']],
    ['데이터 검증',['sources']],
  ];
  for (const [name,views] of groups) {
    publicNav.append(E('p',{class:'nav-group-label'},name));
    views.forEach(id=>{
      const item=navigation.find(x=>x.id===id);
      if(item)publicNav.append(navButton(item));
    });
  }
  sidebar.append(publicNav);
  if (state.user.role === 'admin') {
    sidebar.append(E('p', {class: 'nav-section-title'}, 'WORKSPACE'), E('nav', {class: 'nav-list', 'aria-label': '관리 메뉴'}, navigation.filter(x => x.admin).map(navButton)));
  }
  sidebar.append(E('div', {class: 'sidebar-bottom'}, E('div', {class: 'sidebar-note'}, E('strong', {}, '숫자 너머의 맥락'), '등락의 이유와 시장 간의 연결을 함께 살펴보세요.'), E('div', {class: 'sidebar-legal'}, 'THE MARKET DESK', E('br'), 'GLOBAL CONTEXT. LOCAL PERSPECTIVE.')));
  const topbar = E('header', {class: 'topbar'}, E('div', {class: 'topbar-left'}, iconButton('menu', '메뉴 열기', toggleMenu, {class: 'icon-button menu-button'}), E('div', {class: 'breadcrumb'}, E('span', {}, 'Workspace'), E('span', {}, '/'), E('strong', {id: 'breadcrumb-current'}, '시황 데스크'))), E('div', {class: 'topbar-right'}, E('div', {class: 'kst-clock'}, icon('clock'), E('span', {id: 'kst-clock'})), E('div', {class: 'topbar-separator'}), E('button', {type: 'button', class: 'profile-button', onClick: profileModal, 'aria-label': '내 계정 관리'}, E('span', {class: 'avatar'}, String(state.user.name || state.user.username).slice(0, 1)), E('span', {class: 'profile-label'}, state.user.name || state.user.username, E('small', {}, state.demo ? 'DEMO WORKSPACE' : state.user.role === 'admin' ? 'ADMINISTRATOR' : 'MEMBER')), icon('down'))));
  const chatEnabled = !state.user.pinLogin;
  const rail = E('aside', {class: 'desk-rail', id: 'desk-rail', 'aria-label': chatEnabled ? '데스크 대화방' : '데스크 정보'}, railDate(), chatEnabled ? E('div', {class: 'panel chat-panel', id: 'chat-panel'}) : null, railNote());
  const main = E('main', {class: 'workspace', id: 'main-content', tabindex: '-1'}, E('div', {id: 'page-header'}), E('div', {class: 'content-layout'}, E('div', {class: 'main-column', id: 'main-column'}), rail), E('footer', {class: 'page-footer'}, E('span', {}, '본 서비스의 정보와 시나리오는 투자 판단의 참고 자료입니다. 투자 결정과 책임은 투자자 본인에게 있습니다.'), E('span', {}, '© THE MARKET DESK')));
  const body = E('div', {class: 'shell-body'}, topbar);
  if (state.demo) body.append(E('div', {class: 'demo-banner', role: 'note'}, E('span', {}, E('strong', {}, '체험 모드 · 예시 데이터 · 가상 계정/접속현황'), '시세·전망·일정은 실제 정보가 아닙니다. 채팅과 관리 기능은 이 브라우저에서만 작동합니다.'), E('button', {type: 'button', class: 'text-button', onClick: exitDemo}, '체험 종료', icon('logout'))));
  body.append(main);
  app.replaceChildren(E('div', {class: 'app-shell'}, sidebar, body));
  if (chatEnabled) app.append(E('button', {class: 'rail-close-overlay', id: 'chat-overlay', type: 'button', 'aria-label': '대화방 닫기', onClick: () => toggleChat(false)}), E('button', {class: 'chat-toggle', type: 'button', onClick: () => toggleChat(true)}, icon('chat'), '데스크 라운지', E('span', {id: 'chat-toggle-count'}, state.onlineCount)));
  state.menuOpen = false;
  updateClock(); renderView(); renderChat();
}
function navButton(item) {
  return E('button', {type: 'button', class: `nav-button ${state.view === item.id ? 'active' : ''}`, 'data-view': item.id, onClick: () => navigate(item.id)}, icon(item.icon), item.title);
}
function toggleMenu() {
  state.menuOpen = !state.menuOpen;
  document.querySelector('#sidebar')?.classList.toggle('mobile-open', state.menuOpen);
  document.querySelector('.nav-backdrop')?.remove();
  if (state.menuOpen) app.append(E('button', {type: 'button', class: 'nav-backdrop', 'aria-label': '메뉴 닫기', onClick: toggleMenu}));
}
function toggleChat(open) {
  state.chatOpen = open;
  document.querySelector('#desk-rail')?.classList.toggle('chat-open', open);
  document.querySelector('#chat-overlay')?.classList.toggle('visible', open);
  if (open) document.querySelector('#chat-input')?.focus();
}
function updateClock() {
  const clock = document.querySelector('#kst-clock');
  if (clock) clock.textContent = `${new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date())} KST`;
}
function railDate() {
  return E('div', {class: 'rail-date'}, E('div', {}, E('p', {class: 'rail-date-title'}, 'YOUR DAILY PERSPECTIVE'), E('p', {class: 'rail-date-value'}, new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long'}).format(new Date()))), icon('calendar'));
}
function railNote() {
  return E('div', {class: 'rail-note'}, E('p', {class: 'eyebrow'}, 'A NOTE FROM THE DESK'), E('p', {}, E('strong', {}, '같은 상승, 다른 의미.'), E('br'), '금리 하락도 물가 안정과 경기 불안에 따라 해석이 달라집니다. 방향과 함께 이유를 확인하세요.'));
}
async function navigate(view) {
  const item = navigation.find(x => x.id === view);
  if (!item || (item.admin && state.user.role !== 'admin')) return;
  state.view = view;
  if (state.menuOpen) toggleMenu();
  document.querySelectorAll('.nav-button').forEach(node => { node.classList.toggle('active', node.dataset.view === view); node.setAttribute('aria-current', node.dataset.view === view ? 'page' : 'false'); });
  renderView();
  if (view === 'users' || view === 'activity') await loadAdmin(view);
}
function overviewSectionIntro(title,subtitle,iconName) {
  return E('div',{class:'overview-section-intro'},
    E('div',{class:'overview-section-mark'},icon(iconName)),
    E('div',{},E('h2',{},title),E('p',{},subtitle)));
}
function renderView() {
  if (!state.user) return;
  const item = navigation.find(x => x.id === state.view) || navigation[0];
  document.querySelector('#breadcrumb-current').textContent = item.title;
  const refresh = B(E('span', {class: 'button-label'}, '새로고침'), event => busy(event.currentTarget, refreshCurrent), 'small', 'refresh', {'aria-label': '현재 화면 새로고침'});
  document.querySelector('#page-header').replaceChildren(E('div', {class: 'page-header'}, E('div', {}, E('p', {class: 'eyebrow'}, item.english), E('h1', {}, item.title), E('p', {class: 'page-subtitle'}, item.subtitle)), E('div', {class: 'header-actions'}, dataState(), refresh)));
  const main = document.querySelector('#main-column');
  if (state.view === 'overview') main.replaceChildren(
    renderQuotes(),
    overviewSectionIntro('시장 해석','글로벌 숫자가 국내 주식시장에 어떤 의미인지 살펴봅니다.','brief'),
    renderBrief(), renderImpact(),
    overviewSectionIntro('업종과 주도 기업','미국 업종별 흐름과 주요 기술주가 같은 방향으로 움직이는지 확인합니다.','layers'),
    E('div', {class: 'section-pair'}, renderSectors(), renderLeaders()),
    overviewSectionIntro('앞으로 볼 변수','기간별 조건과 예정된 경제 이벤트를 분리해서 확인합니다.','calendar'),
    renderOutlook(), renderEvents(true));
  if (state.view === 'markets') main.replaceChildren(renderMarketTable(), renderEquityTable('미국 섹터 · ETF 대용지표', state.market?.sectors || []), renderEquityTable('미국 대표 종목', state.market?.leaders || []));
  if (state.view === 'instrument') main.replaceChildren(renderInstrumentSearch());
  if (state.view === 'outlooks') main.replaceChildren(renderImpact(), renderOutlook(), methodologyPanel());
  if (state.view === 'calendar') main.replaceChildren(renderEvents(false));
  if (state.view === 'sources') main.replaceChildren(renderSources());
  if (state.view === 'users') main.replaceChildren(renderUsers());
  if (state.view === 'activity') main.replaceChildren(...renderActivity());
}
const searchSamples={
  KR:[['삼성전자','005930'],['SK하이닉스','000660'],['현대차','005380'],['네이버','035420']],
  US:[['엔비디아','NVDA'],['애플','AAPL'],['마이크로소프트','MSFT'],['테슬라','TSLA']],
  CRYPTO:[['비트코인','BTC'],['이더리움','ETH'],['솔라나','SOL'],['도지코인','DOGE']],
};
async function submitInstrumentSearch() {
  if(state.instrumentLoading)return;
  const generation=state.sessionGeneration,market=state.instrumentMarket;
  const query=state.instrumentQuery.trim();
  if(!query){state.instrumentResult={status:'invalid',message:'종목명 또는 코드를 입력해 주세요.'};renderView();return;}
  if(state.demo){state.instrumentResult={status:'invalid',message:'체험 모드에서는 실시간 조회를 하지 않습니다. 로그인 후 검색해 주세요.'};renderView();return;}
  state.instrumentLoading=true;
  state.instrumentResult=null;
  renderView();
  try{
    const params=new URLSearchParams({market,symbol:query});
    const result=await api('/api/instrument?'+params.toString());
    if(generation===state.sessionGeneration&&state.user&&market===state.instrumentMarket)
      state.instrumentResult=result;
  }catch(error){
    if(generation===state.sessionGeneration&&state.user)
      state.instrumentResult={status:'error',message:errorText(error)};
  }finally{
    if(generation===state.sessionGeneration && state.user) {
      state.instrumentLoading=false;
      if(state.view==='instrument')renderView();
    }
  }
}
function renderInstrumentSearch() {
  const active=state.instrumentMarket;
  const form=E('form',{class:'instrument-form',onSubmit:event=>{
    event.preventDefault();
    submitInstrumentSearch();
  }});
  const tabs=E('div',{class:'instrument-tabs',role:'group','aria-label':'조회 시장'},
    [['KR','국내 주식'],['US','미국 주식·ETF'],['CRYPTO','바이낸스 코인']].map(([id,label])=>
      E('button',{type:'button',class:`tab ${active===id?'active':''}`,
        'aria-pressed':String(active===id),
        onClick:()=>{
          if(state.instrumentLoading)return;
          state.instrumentMarket=id;state.instrumentQuery='';state.instrumentResult=null;renderView();
          document.querySelector('#instrument-symbol')?.focus();
        }},label)));
  const label=E('label',{for:'instrument-symbol'},
    active==='KR'?'종목명 또는 6자리 종목코드':active==='US'?'종목명 또는 티커':'코인명 또는 USDT 거래쌍');
  const input=E('input',{id:'instrument-symbol',type:'search',autocomplete:'off',
    maxlength:42,required:true,value:state.instrumentQuery,
    placeholder:active==='KR'?'삼성전자 또는 005930':active==='US'?'엔비디아 또는 NVDA':'비트코인 또는 BTCUSDT',
    'aria-describedby':'instrument-hint',
    onInput:event=>{state.instrumentQuery=event.target.value;}});
  const action=E('button',{type:'submit',class:'button primary',disabled:state.instrumentLoading},
    icon('search'),state.instrumentLoading?'조회 중...':'시세 조회');
  form.append(tabs,E('div',{class:'instrument-search-row'},E('div',{},label,input),
    action),E('p',{id:'instrument-hint',class:'tiny muted'},active==='KR'
    ?'코스피·코스닥 개별 주식·ETF는 6자리 코드로 검색할 수 있습니다. 종목명 자동완성은 아래 추천 항목에 한정됩니다.'
    :active==='US'?'미국 상장 종목은 티커로 조회합니다. NASDAQ → NYSE → AMEX 순서로 KIS에서 확인합니다.'
    :'바이낸스 현물 USDT 거래쌍으로 조회합니다. USD 가격과 혼동하지 마세요.'));
  const samples=E('div',{class:'instrument-samples'},E('span',{class:'tiny muted'},'빠른 조회'),
    searchSamples[active].map(([name,code])=>
      E('button',{type:'button',class:'instrument-sample',disabled:state.instrumentLoading,
        onClick:()=>{
          state.instrumentQuery=code;
          submitInstrumentSearch();
        }},name,E('span',{class:'muted'},code))));
  const result=state.instrumentResult;
  let resultNode;
  if(state.instrumentLoading)resultNode=E('div',{class:'instrument-search-feedback','aria-live':'polite'},'해당 거래소 시세를 확인하는 중입니다.');
  else if(result?.status==='ok'&&result.quote){
    const q=result.quote;
    const valid=hasValue(q);
    resultNode=E('div',{class:'instrument-result','aria-live':'polite'},
      E('div',{class:'instrument-result-heading'},
        E('div',{},E('p',{class:'eyebrow'},q.market==='CRYPTO'?'BINANCE SPOT':q.market==='KR'?'KOREA STOCK':'US EQUITY'),
          E('h3',{},q.name||q.symbol),
          E('p',{class:'instrument-code'},q.symbol, q.exchange?` · ${q.exchange}`:'')),
        badge(q.status==='live'?'공개 현물 조회':'거래소 지연 가능',q.status==='live'?'green':'amber')),
      E('div',{class:'instrument-result-quote'},E('strong',{},valid?`${formatValue(q)} ${q.unit}`:'—'),
        E('span',{class:changeClass(q.change)},q.change===null?'등락률 미제공':formatChange(q))),
      E('p',{class:'tiny muted'},`출처: ${sourceName(q.source)} · ${q.observedAt?dateText(q.observedAt):'관측시각 미제공'}`),
      E('p',{class:'tiny muted'},q.delay||'공급자별 이용권한·시차를 확인해 주세요.'),
      q.sourceUrl?link('공급자 API 안내',q.sourceUrl):null);
  }else resultNode=E('div',{class:'instrument-search-feedback','aria-live':'polite'},
    result?.message||'종목을 선택하거나 검색어를 입력해 시세를 확인해 보세요.');
  return E('section',{class:'panel instrument-search-panel'},
    panelHead('개별 종목 검색','시세 조회 전용 · 주문/계좌 연결 없음',badge('KIS · Binance','blue'),'search'),
    form,samples,resultNode,E('p',{class:'panel-foot'},
      '국내·미국 주식은 KIS 이용권한에 따라 지연될 수 있습니다. 국내·미국 종목명 예시는 일부만 제공하며, 전체 종목은 코드/티커로 검색합니다.'));
}
function dataState() {
  if (state.demo) return E('span', {class: 'data-state partial'}, E('i', {class: 'dot'}), 'EXAMPLE');
  const quotes = state.market?.quotes || [];
  const good = quotes.filter(q => Number.isFinite(q.value)
    && ['daily', 'delayed', 'live', 'monthly'].includes(q.status) && !q.deploymentBackup);
  const delayed = quotes.filter(q => q.status === 'stale' || q.deploymentBackup);
  const missing = quotes.filter(q => !Number.isFinite(q.value));
  const complete = quotes.length > 0 && good.length === quotes.length;
  const summary = quotes.length ? `지표 ${good.length}/${quotes.length} 정상 수신` : '데이터 연결 필요';
  const issues = [...missing, ...delayed].map(q => q.name).filter(Boolean);
  const explanation = issues.length
    ? `수신 확인 필요: ${issues.slice(0, 4).join(', ')}${issues.length > 4 ? ` 외 ${issues.length - 4}개` : ''}`
    : '모든 지표의 최신 유효 관측값을 수신했습니다.';
  return E('button', {type: 'button', class: `data-state data-state-action ${complete ? 'live' : good.length ? 'partial' : ''}`,
    title: `${summary} · ${explanation} · 클릭하면 공급원별 수신 현황으로 이동합니다.`,
    'aria-label': `${summary}. 데이터 연결 현황 보기`,
    onClick: () => navigate('sources')}, E('i', {class: 'dot'}), summary);
}
async function refreshCurrent() {
  if (state.demo) { renderView(); toast('체험용 예시 화면을 다시 표시했습니다. 실제 시세를 조회하지 않았습니다.'); return; }
  if (['users', 'activity'].includes(state.view)) { await loadAdmin(state.view); return; }
  if (state.view === 'calendar') await loadCalendar();
  else if (state.view === 'overview') await Promise.all([loadMarket(), loadCalendar()]);
  else await loadMarket();
  renderView();
}
function renderBrief() {
  const summary = state.market?.summary || defaultMarket().summary;
  const analysis = state.market?.analysis;
  const analysisLabel = analysis?.kind === 'ai' ? 'AI 분석' : '지표 기반 자동 해석';
  const analysisNote = analysis?.status === 'unavailable' ? `분석 미생성 · ${analysis.reason || '근거 또는 연결 상태를 확인해 주세요.'}` : analysis?.generatedAt ? `분석 생성 ${dateText(analysis.generatedAt)} KST${analysis.dataAsOf ? ` · 분석 기준 ${dateText(analysis.dataAsOf)} KST` : ''}` : '관측 사실과 전망을 구분합니다. 자세한 근거는 기간별 전망에서 확인하세요.';
  return E('section', {class: 'panel brief-panel'}, E('div', {class: 'panel-head'}, E('p', {class: 'brief-label'}, icon('brief'), state.demo ? 'TODAY’S BRIEF · EXAMPLE' : 'TODAY’S BRIEF'), badge(state.demo ? '예시 시나리오' : state.market?.mode === 'unconfigured' ? '데이터 대기' : analysisLabel, state.demo ? 'amber' : 'blue')), E('div', {class: 'brief-content'}, E('h2', {}, summary.headline || '확인된 데이터를 기다리고 있습니다.'), E('div', {class: 'brief-points'}, (summary.points || []).slice(0, 3).map((point, i) => E('div', {class: 'brief-point'}, E('span', {class: 'point-number'}, `0${i + 1}`), E('span', {}, typeof point === 'string' ? point : point.text || point.title || ''))))), E('div', {class: 'brief-footer'}, E('span', {class: 'brief-foot-note'}, icon('info'), state.demo ? '화면 설명을 위한 가상 해석입니다. 투자 판단에 사용하지 마세요.' : analysisNote), E('span', {}, state.demo ? '예시 데이터' : state.market?.asOf ? `데스크 갱신 ${dateText(state.market.asOf)} KST` : '분석 데이터 미연결')));
}
function renderBacktest(review) {
  const outer = E('div', {class:'source-cards'});
  for (const [name,item] of [['KOSPI',review.kospi],['KOSDAQ',review.kosdaq]]) {
    const body = E('div',{class:'source-body'});
    body.append(E('h3',{class:'source-name'}, name+' · '+(item.status==='exploratory'?'표본 확보':'표본 부족')));
    body.append(E('p',{class:'source-description'},item.agreementRate===null?('판정 가능한 '+item.classifiedDays+'거래일 · 최소 '+review.minimumClassifiedDays+'일 필요'):('과거 종가 방향 일치 '+item.agreementRate+'% · '+item.classifiedDays+'거래일')));
    body.append(E('p',{class:'tiny muted'},(item.from||'—')+' ~ '+(item.until||'—')+' · 미래 적중률을 뜻하지 않습니다.'));
    outer.append(E('div',{class:'source-card'},body));
  }
  return outer;
}
function renderImpact() {
  const impact = state.demo ? null : state.market?.impact;
  const section = E('section', {class: 'panel', id: 'korea-impact'},
    panelHead('글로벌 → 한국 증시 영향', '해외 지표로 국내 시장의 외부 여건을 점검합니다. 실제 지수 등락 예측은 아닙니다.', badge('OBSERVED FACTORS', 'blue'), 'globe'));
  if (!impact) {
    section.append(empty('글로벌 영향 분석 대기', state.demo ? '체험용 예시는 실제 분석을 표시하지 않습니다.' : '연결된 지표를 확인하는 중입니다.', 'chart'));
    return section;
  }
  const stateTone = text => /우호|긍정|완화/.test(String(text || '')) ? 'green' : /주의|부담|비우호|위험|약세/.test(String(text || '')) ? 'amber' : 'blue';
  const cards = [['KOSPI', impact.kospi], ['KOSDAQ', impact.kosdaq]].map(([name, item]) => {
    return E('div', {class: 'source-card'},
      E('div', {class: 'source-body'},
        E('h3', {class: 'source-name'}, name, badge(item.state, stateTone(item.state))),
        E('p', {class: 'source-description'}, item.summary),
        E('p', {class: 'tiny muted'}, `반영 근거 ${item.available}/${item.total}개 · 가중치 커버리지 ${Math.round(item.coverage * 100)}% (예측 확률 아님)`),
        E('ul', {class: 'reason-list'}, item.drivers.slice(0, 4).map(driver =>
          E('li', {}, `${driver.text} · ${driver.stance} · ${sourceName(driver.source)}`)))));
  });
  section.append(E('div', {class: 'impact-index-grid'}, cards));
  const domestic = impact.domestic || {};
  const domesticItems = [
    ['코스피 일별 종가', domestic.kospi],
    ['코스닥 일별 종가', domestic.kosdaq],
    ['코스피 외국인 순매수', domestic.foreignKospi],
    ['코스닥 외국인 순매수', domestic.foreignKosdaq],
    ['코스피 연기금 등 순매수', domestic.pensionKospi],
    ['코스닥 연기금 등 순매수', domestic.pensionKosdaq],
  ];
  section.append(E('div', {class: 'panel-foot'}, E('strong', {}, '국내 시장 관측 · 실제 종가와 수급'),
    E('span', {}, ' · 일별 확정 자료이며 위 해외 환경 판단의 적중률이 아닙니다.')));
  section.append(E('div', {class: 'impact-domestic-grid'}, domesticItems.map(([name, quote]) =>
    E('div', {class: 'source-card'}, E('div', {class: 'source-body'},
      E('h3', {class: 'source-name'}, name),
      quote ? E('p', {class: 'source-description'},
        `${Number(quote.value).toLocaleString('ko-KR', {maximumFractionDigits: 2})} ${quote.unit || ''} · ${String(quote.observedAt).slice(0, 10)} 기준`) :
        E('p', {class: 'source-description'}, '데이터 미연결 또는 최신 관측값 부족'),
      quote?.change !== null && quote?.change !== undefined
        ? E('p', {class: 'tiny muted'}, `직전 관측 대비 ${quote.change > 0 ? '+' : ''}${quote.change}${quote.changeUnit || ''} · ${quote.changeBasis || '전일 대비'}`) : null,
      quote?.source ? E('p', {class: 'tiny muted'}, sourceName(quote.source)) : null)))));

  if (impact.validation) {
    section.append(E('div', {class:'panel-foot'}, '과거 방향 일치 점검 · 탐색적 통계'), renderBacktest(impact.validation),
      E('div', {class:'source-disclaimer'}, (impact.validation.limitations || []).join(' ')));
  }
  const themes = (impact.themes || []).map(theme =>
    E('div', {class: 'source-card'},
      E('div', {class: 'source-body'},
        E('h3', {class: 'source-name'}, theme.title, badge(theme.state, stateTone(theme.state))),
        E('p', {class: 'source-description'}, theme.reason),
        theme.evidence ? E('p', {class: 'tiny muted'}, theme.evidence) : null)));
  section.append(E('div', {class: 'impact-themes-grid'}, themes));
  section.append(E('div', {class: 'source-disclaimer'},
    `${impact.mixedDates ? '관측 날짜가 다른 지표가 섞여 있습니다. ' : ''}${(impact.cautions || []).join(' ')}`));
  return section;
}
function metricSection(number, id, title, subtitle, theme, quotes) {
  if (!quotes.length) return null;
  const observed=quotes.filter(quote=>hasValue(quote)).length;
  const koreaGroups=[
    ['국내 지수',quotes.filter(q=>['kospi','kosdaq'].includes(q.id))],
    ['외국인 수급',quotes.filter(q=>q.id?.startsWith('kr_foreign_'))],
    ['연기금 수급',quotes.filter(q=>q.id?.startsWith('kr_pension_'))],
    ['기타 국내 지표',quotes.filter(q=>!['kospi','kosdaq'].includes(q.id) && !/^kr_(foreign|pension)_/.test(q.id))],
  ].filter(([,items])=>items.length);
  return E('section',{class:`metric-section metric-${theme}`,id,'aria-label':title},
    E('div',{class:'metric-section-heading'},
      E('span',{class:'metric-section-number','aria-hidden':'true'},number),
      E('div',{class:'metric-section-copy'},
        E('h3',{class:'metric-section-title'},title),
        E('p',{class:'metric-section-description'},subtitle)),
      E('span',{class:'metric-section-coverage'},
        state.demo?`예시 ${quotes.length}개`:`수신 ${observed}/${quotes.length}`)),
    theme==='korea'
      ? E('div',{class:'korea-metric-groups'},koreaGroups.map(([name,items])=>
          E('div',{class:'korea-metric-block'},
            E('h4',{class:'korea-metric-label'},name),
            E('div',{class:'market-grid korea-quote-grid'},items.map(quoteCard)))))
      : E('div',{class:'market-grid'},quotes.map(quoteCard)));
}

function renderQuotes() {
  const allQuotes=normalizedQuotes();
  const seen=new Set();
  // Present real KIS Korean indexes/net buying before overseas factors.
  // If KIS is unavailable, keep the genuine missing-data placeholders.
  const domestic=[
    ['kospi','코스피','pt'],['kosdaq','코스닥','pt'],
    ['kr_foreign_kospi','코스피 외국인 순매수','억원'],
    ['kr_foreign_kosdaq','코스닥 외국인 순매수','억원'],
    ['kr_pension_kospi','코스피 연기금 등 순매수','억원'],
    ['kr_pension_kosdaq','코스닥 연기금 등 순매수','억원'],
  ].map(([id,name,unit])=>{
    seen.add(id);
    return allQuotes.find(q=>q.id===id)||
      {id,name,unit,group:'korea',value:null,change:null,status:'unconfigured'};
  });
  const take=predicate=>allQuotes.filter(q=>{
    if(seen.has(q.id)||!predicate(q))return false;
    seen.add(q.id);return true;
  });
  const domesticPlus=take(q=>groupName(q.group)==='한국시장' && !['kr3y','kr10y'].includes(q.id));
  const equities=take(q=>['sp500','nasdaq','nasdaqcom','sox','vix'].includes(q.id)
    ||groupName(q.group)==='주식'||groupName(q.group)==='변동성');
  const ratesFx=take(q=>['금리','외환'].includes(groupName(q.group))
    ||['us2y','us10y','kr3y','kr10y','usdkrw','dxy','broadusd'].includes(q.id));
  const commodities=take(q=>groupName(q.group)==='원자재');
  const crypto=take(q=>groupName(q.group)==='디지털자산');
  const other=take(()=>true);
  const groups=[
    ['01','metrics-korea','한국 증시 · 외국인·연기금 수급','코스피·코스닥 지수와 외국인·연기금 순매수금액을 구분해 확인합니다.','korea',[...domestic,...domesticPlus]],
    ['02','metrics-global','미국 증시 · 위험 심리','미국 대표 지수와 변동성 지표로 밤사이 시장 분위기를 확인합니다.','global',equities],
    ['03','metrics-macro','금리 · 환율','미국·한국 채권금리와 달러 움직임을 살펴봅니다.','macro',ratesFx],
    ['04','metrics-commodities','원자재','금·에너지·산업금속 가격을 주식시장과 구분해 비교합니다.','commodities',commodities],
    ['05','metrics-crypto','디지털자산','BTC·ETH·SOL 등 코인 현물 가격을 확인합니다. USD와 USDT를 구분해 표시합니다.','crypto',crypto],
    ['06','metrics-other','그 밖의 지표','앞선 범주에 포함되지 않은 관측 지표입니다.','other',other],
  ].filter(group=>group[5].length);
  const jump=E('nav',{class:'metric-jump','aria-label':'핵심 지표 주제 바로가기'},
    E('span',{class:'metric-jump-label'},'주제별 이동'),
    groups.map(([number,id,title])=>E('button',{type:'button',class:'metric-jump-button',
      onClick:()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})},
      number,E('span',{},title.split(' · ')[0]))));
  return E('section', {class:'panel quote-overview-panel'},
    panelHead('시장 핵심 지표 · 주제별 현황',
      '먼저 국내 증시를 보고, 미국 증시 → 금리·환율 → 원자재 → 코인 순으로 읽으세요.',
      E('button',{type:'button',class:'text-button',onClick:()=>navigate('markets')},'전체 시장',icon('chevron'))),
    jump,
    E('div',{class:'metric-sections'},
      groups.map(([number,id,title,subtitle,theme,quotes])=>
        metricSection(number,id,title,subtitle,theme,quotes))),
    E('div',{class:'panel-foot'},
      E('span',{class:'gain'},'● 상승·순매수'),'　',
      E('span',{class:'loss'},'● 하락·순매도'),
      '　수급은 등락률이 아닌 당일 순매수금액입니다. 연기금 등은 국민연금 단독 거래가 아닙니다.'));
}
const CHART_INDEX_IDS = new Set(['kospi','kosdaq','sp500','nasdaq','nasdaqcom','sox','dxy','broadusd','vix']);
function hasIndexChart(quote) { return CHART_INDEX_IDS.has(quote?.id) && !state.demo; }
function quoteCard(quote) {
  const available=hasValue(quote);
  const chartable=hasIndexChart(quote);
  const foreign=quote.id?.startsWith('kr_foreign_');
  const pension=quote.id?.startsWith('kr_pension_');
  const flow=foreign||pension;
  const investor=pension?'연기금':'외국인';
  const observed=quote.timestampPrecision==='month'&&quote.observedAt
    ? `${String(quote.observedAt).slice(0,7)} 월간`
    : quote.timestampPrecision==='day'&&quote.observedAt
      ? String(quote.observedAt).slice(0,10) : dateText(quote.observedAt);
  const label=flow?(quote.id.endsWith('_kospi')?'코스피':'코스닥'):quote.name;
  const changeText=flow
    ? Number(quote.value)<0?`${investor} 순매도`
      :Number(quote.value)>0?`${investor} 순매수`:'매수·매도 균형'
    :formatChange(quote);
  const tone=flow?changeClass(quote.value):changeClass(quote.change);
  const observation=!available?'데이터 미수신'
    :quote.status==='stale'?`⚠ 오래된 값 · ${observed}`:`${observed} 기준`;
  return E('article', {class:`quote-card${chartable?' quote-card-clickable':''}${flow?' quote-card-flow':''}`,
    role: chartable ? 'button' : null,
    tabindex: chartable ? 0 : null,
    'aria-label':chartable?`${quote.name} 과거 지수 차트 열기`:null,
    onClick: chartable ? () => openIndexChart(quote) : null,
    onKeydown:chartable?event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();openIndexChart(quote);}
    }:null,
    title:`${quote.name} · ${state.demo?'체험용 예시 데이터':observation}`},
    E('div',{class:'quote-top'},E('h3',{class:'quote-name'},label),
      chartable?E('span',{class:'quote-drilldown','aria-hidden':'true'},icon('chevron'))
        :flow?E('span',{class:'quote-group quote-investor'},investor+' 수급')
        :E('span',{class:'quote-group'},groupName(quote.group))),
    E('div',{class:'quote-value-row'},
      E('span',{class:`quote-value${flow&&available?' '+tone:''}`},formatValue(quote)),
      E('span',{class:'quote-unit'},quote.unit||'')),
    E('div',{class:'quote-bottom'},
      available?E('span',{class:`quote-change ${tone}`},changeText)
        :E('span',{class:'quote-missing'},'데이터 연결 필요'),
      E('span',{class:'quote-observed'},state.demo?'예시':observation)));
}

// Observed index history only: daily closes are not intraday or candlestick data.
function openIndexChart(quote) {
  const observations = chartSeries(quote.history);
  const hasOfficialCandles = ['kospi','kosdaq'].includes(quote.id)
    && quote.provider === 'kis' && !!quote.chartPeriods;
  const isIndexStale = quote.status === 'stale' || quote.deploymentBackup;
  showModal(`${quote.name} · 지수 차트`,
    hasOfficialCandles ? '한투 KIS 실제 시가·고가·저가·종가 · 주기별 원자료' :
      '관측된 종가로 표시하는 추이 차트 · 실제 봉 시고저종 데이터 없음',
    body => {
      const frequencies = [['D','일봉'],['W','주봉'],['M','월봉']];
      const ranges = [['1m','1개월'],['3m','3개월'],['1y','1년'],['all','전체']];
      const frequencyMenu = E('div',{class:'market-chart-ranges',role:'group','aria-label':'차트 봉 주기'});
      const periodMenu = E('div',{class:'market-chart-ranges market-chart-extent',role:'group','aria-label':'차트 조회 범위'});
      const headline = E('div', {class:'market-chart-summary'});
      const plot = E('div', {class:'market-chart-container'});
      const foot = E('div', {class:'market-chart-footnote'});
      let activeTimeframe = 'D';
      let activePeriod = 'all';
      const frequenciesButtons = frequencies.map(([value,label]) => E('button',{
        type:'button',class:'market-chart-range',onClick:()=>{activeTimeframe=value;redraw();}
      },label));
      const periodButtons = ranges.map(([value,label]) => E('button',{
        type:'button',class:'market-chart-range',onClick:()=>{activePeriod=value;redraw();}
      },label));
      frequencyMenu.append(...frequenciesButtons);
      periodMenu.append(...periodButtons);
      body.append(frequencyMenu,periodMenu,headline,plot,foot);
      function redraw() {
        frequenciesButtons.forEach((button,i)=>{
          const selected=frequencies[i][0]===activeTimeframe;
          button.classList.toggle('active',selected);
          button.setAttribute('aria-pressed',String(selected));
        });
        periodButtons.forEach((button,i)=>{
          const selected=ranges[i][0]===activePeriod;
          button.classList.toggle('active',selected);
          button.setAttribute('aria-pressed',String(selected));
        });
        const all = hasOfficialCandles ? candleSeries(quote.chartPeriods?.[activeTimeframe]) :
          chartFrequency(observations,activeTimeframe);
        const series=chartPeriod(all,activePeriod);
        const candleMode=hasOfficialCandles;
        const label=frequencies.find(x=>x[0]===activeTimeframe)?.[1]||'일봉';
        plot.replaceChildren();
        const change=chartPeriodChange(series);
        const last=series.at(-1);
        const changeText=change===null ? '기간 변동률 산출 불가' :
          `${change>0?'+':''}${change.toFixed(2)}% (표시된 첫 종가 대비)`;
        headline.replaceChildren(
          E('div',{},
            E('strong',{class:'market-chart-current'},last ?
              `${last.value.toLocaleString('ko-KR',{maximumFractionDigits:2})} ${quote.unit||'pt'}`:'—'),
            E('p',{class:'market-chart-date'},last ? `${last.date} · ${label} 종가`:'해당 주기의 관측값 없음')),
          E('span',{class:`market-chart-change ${changeClass(change)}`},changeText));
        if (!series.length || (!candleMode && series.length<2)) {
          plot.append(E('div',{class:'market-chart-empty'}, candleMode ?
            `연결된 ${label} 시가·고가·저가·종가가 없습니다. 실제 응답이 확인될 때까지 봉을 생성하지 않습니다.` :
            `해당 ${label} 구간에 종가 관측값이 2개 미만입니다.`));
        } else {
          const dims={w:760,h:310,left:76,right:24,top:20,bottom:45};
          const width=dims.w-dims.left-dims.right,height=dims.h-dims.top-dims.bottom;
          const lows=series.map(p=>candleMode?p.low:p.value);
          const highs=series.map(p=>candleMode?p.high:p.value);
          const min=Math.min(...lows),max=Math.max(...highs);
          const padding=Math.max((max-min)*0.09,Math.abs(max)*0.002,0.01);
          const low=min-padding,high=max+padding;
          const xx=i=>dims.left+(series.length===1?width/2:i/(series.length-1)*width);
          const yy=value=>dims.top+(high-value)/(high-low)*height;
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('viewBox',`0 0 ${dims.w} ${dims.h}`);
          svg.setAttribute('role','img');
          svg.setAttribute('aria-label',`${quote.name} ${label}: ${series[0].date}부터 ${series.at(-1).date}까지 ${candleMode?'KIS 실제 OHLC 봉':'확인된 종가 추이'}`);
          svg.setAttribute('class',`market-chart-svg ${changeClass(change)}`);
          const draw=(tag,attributes={},content=null)=>{
            const node=document.createElementNS(svg.namespaceURI,tag);
            for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
            if(content!==null)node.textContent=String(content);
            svg.append(node);
            return node;
          };
          for(let tick=0;tick<=4;tick++) {
            const value=low+(high-low)*tick/4,y=yy(value);
            draw('line',{x1:dims.left,x2:dims.w-dims.right,y1:y,y2:y,class:'market-chart-gridline'});
            draw('text',{x:dims.left-10,y:y+4,'text-anchor':'end',class:'market-chart-axis'},
              value.toLocaleString('ko-KR',{maximumFractionDigits:2}));
          }
          if (candleMode) {
            const bodyWidth=Math.max(2,Math.min(18,width/Math.max(series.length,1)*0.64));
            series.forEach((bar,i)=>{
              const x=xx(i),isUp=bar.close>=bar.open;
              const color=isUp?'market-candle-up':'market-candle-down';
              const yOpen=yy(bar.open),yClose=yy(bar.close);
              draw('line',{x1:x,x2:x,y1:yy(bar.high),y2:yy(bar.low),class:`market-chart-wick ${color}`});
              draw('rect',{x:x-bodyWidth/2,y:Math.min(yOpen,yClose),
                width:bodyWidth,height:Math.max(1.8,Math.abs(yOpen-yClose)),
                rx:0.6,class:`market-chart-body ${color}`});
            });
          } else {
            const path=series.map((bar,i)=>`${i?'L':'M'}${xx(i).toFixed(1)},${yy(bar.value).toFixed(1)}`).join(' ');
            draw('path',{d:path,class:'market-chart-path',fill:'none',
              'stroke-linecap':'round','stroke-linejoin':'round'});
          }
          const labelIndices=[0,Math.floor((series.length-1)/2),series.length-1];
          [...new Set(labelIndices)].forEach(i=>{
            draw('text',{x:xx(i),y:dims.h-13,
              'text-anchor':i===0?'start':i===series.length-1?'end':'middle',
              class:'market-chart-axis'},series[i].date.slice(5));
          });
          const vertical=draw('line',{class:'market-chart-crosshair'});
          const dot=draw('circle',{r:4,class:'market-chart-marker'});
          const reading=E('div',{class:'market-chart-reading','aria-live':'polite'});
          const selector=E('input',{type:'range',class:'market-chart-scrubber',
            min:0,max:series.length-1,value:series.length-1,step:1,
            'aria-label':`${label} 날짜별 시세 확인`,
            onInput:event=>highlight(Number(event.target.value))});
          function formatPrice(value){return value.toLocaleString('ko-KR',{maximumFractionDigits:2});}
          function highlight(index){
            const i=Math.max(0,Math.min(series.length-1,index));
            const bar=series[i],x=xx(i),y=yy(bar.value);
            for(const [key,value] of Object.entries({x1:x,x2:x,y1:dims.top,y2:dims.h-dims.bottom}))vertical.setAttribute(key,String(value));
            dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));
            reading.textContent=candleMode ?
              `${bar.date} · 시 ${formatPrice(bar.open)} / 고 ${formatPrice(bar.high)} / 저 ${formatPrice(bar.low)} / 종 ${formatPrice(bar.close)} ${quote.unit||'pt'}` :
              `${bar.date} · 종가 ${formatPrice(bar.value)} ${quote.unit||'pt'}`;
            selector.value=String(i);
            selector.setAttribute('aria-valuetext',reading.textContent);
          }
          svg.addEventListener('pointermove',event=>{
            const rect=svg.getBoundingClientRect();
            if(!rect.width)return;
            const x=(event.clientX-rect.left)/rect.width*dims.w;
            let best=0,distance=Infinity;
            series.forEach((bar,i)=>{const diff=Math.abs(xx(i)-x);if(diff<distance){best=i;distance=diff;}});
            highlight(best);
          });
          plot.append(svg,selector,reading);
          highlight(series.length-1);
        }
        foot.replaceChildren(
          E('p',{},candleMode ?
            `출처: ${sourceName(quote.source)} · ${label} 실측 시가·고가·저가·종가 · 해당 기간 ${all.length}개 관측 봉 · 장중 실시간 아님` :
            `출처: ${sourceName(quote.source)} · 종가만 제공되어 선 차트로 표시합니다. 주간·월간은 그 기간 마지막 실제 관측 종가이며 OHLC 캔들이 아닙니다.`),
          isIndexStale?E('p',{class:'market-chart-stale'},'⚠ 오래된 관측값 또는 배포 시 저장된 데이터입니다. 현재 시세로 해석하지 마세요.'):null,
          quote.sourceUrl?link('원자료 확인',quote.sourceUrl):null);
      }
      redraw();
    },{className:'market-history-modal'});
}

function sparkline(quote) {
  const values = (Array.isArray(quote.history) ? quote.history : []).map(x => typeof x === 'number' ? x : Number(x.value ?? x.close)).filter(Number.isFinite);
  if (values.length < 2) return null;
  const low = Math.min(...values), high = Math.max(...values), spread = high - low || 1;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 80 26'); svg.setAttribute('class', `quote-spark ${changeClass(quote.change)}`); svg.setAttribute('aria-label', state.demo ? '예시 추이' : '관측 추이');
  const line = document.createElementNS(svg.namespaceURI, 'polyline');
  line.setAttribute('points', values.map((value, index) => `${(index / (values.length - 1) * 78 + 1).toFixed(2)},${(23 - (value - low) / spread * 19).toFixed(2)}`).join(' '));
  line.setAttribute('stroke', 'currentColor'); line.setAttribute('fill', 'none'); line.setAttribute('stroke-width', '1.5'); svg.append(line);
  return svg;
}
function groupName(group) {
  return ({equities: '주식', equity: '주식', stocks: '주식', indices: '주식', rates: '금리', yields: '금리', bonds: '금리', fx: '외환', currencies: '외환', commodities: '원자재', commodity: '원자재', energy: '원자재', metals: '원자재', korea: '한국시장', crypto: '디지털자산', volatility: '변동성', risk: '변동성'})[group] || group || '기타';
}
function renderSectors() {
  const sectors = (state.market?.sectors || []).filter(q => hasValue(q) && q.status !== 'stale' && !q.deploymentBackup);
  return E('section', {class: 'panel'}, panelHead('섹터의 온도', '미국 주요 업종의 등락', null, 'layers'), sectors.length ? E('div', {class: 'sector-list'}, sectors.slice(0, 8).map(sector => E('div', {class: `sector-tile ${Number(sector.change) > 0 ? 'gain-bg' : Number(sector.change) < 0 ? 'loss-bg' : ''}`}, E('span', {}, sector.name || sector.sector), E('strong', {class: changeClass(sector.change)}, formatChange(sector))))) : E('div', {class: 'compact-empty'}, '— 섹터 데이터 연결 필요', E('br'), '업종별 시세가 연결되면 상승의 확산 정도를 확인할 수 있습니다.'));
}
function renderLeaders() {
  const leaders = (state.market?.leaders || []).filter(q => hasValue(q) && q.status !== 'stale' && !q.deploymentBackup);
  return E('section', {class: 'panel'}, panelHead('주도 종목', '시장의 움직임을 설명하는 대표 기업', null, 'chart'), leaders.length ? E('div', {class: 'leaders-list'}, leaders.slice(0, 4).map(item => E('div', {class: 'leader-row'}, E('div', {class: 'leader-monogram'}, String(item.symbol || item.name || '').slice(0, 2)), E('div', {}, E('div', {class: 'leader-title'}, item.name), E('div', {class: 'leader-symbol'}, item.symbol || item.ticker || '')), E('div', {class: 'leader-change'}, E('div', {class: changeClass(item.change)}, formatChange(item)), E('div', {class: 'leader-value'}, hasValue(item) ? `$${formatValue(item)}` : '—'))))) : E('div', {class: 'compact-empty'}, '— 종목 데이터 연결 필요', E('br'), '대표 종목의 가격과 시장 대비 움직임을 함께 제공합니다.'));
}
const horizons = [{id: 'day', label: '오늘', aliases: ['day', 'today', 'daily']}, {id: 'short', label: '2~3일', aliases: ['short', '2-3d', '2-3days']}, {id: 'week', label: '이번 주', aliases: ['week', 'weekly']}, {id: 'month', label: '1개월', aliases: ['month', 'monthly']}, {id: 'quarter', label: '3~6개월', aliases: ['quarter', '3-6m', 'medium']}];
function renderOutlook() {
  const active = horizons.find(x => x.id === state.horizon) || horizons[0];
  const outlook = (state.market?.outlooks || []).find(item => active.aliases.includes(item.horizon));
  const section = E('section', {class: 'panel', id: 'outlook-panel'}, panelHead('한국시장, 어떻게 연결될까요?', '단정적인 예측 대신 확인 가능한 조건과 시나리오', badge(state.demo ? '예시 전망' : 'CONDITIONAL VIEW', state.demo ? 'amber' : 'blue')), E('div', {class: 'outlook-tabs', role: 'tablist', 'aria-label': '전망 기간'}, horizons.map(item => E('button', {type: 'button', class: `tab ${item.id === state.horizon ? 'active' : ''}`, role: 'tab', 'aria-selected': item.id === state.horizon, id: `tab-${item.id}`, 'aria-controls': 'outlook-content', onClick: () => { state.horizon = item.id; section.replaceWith(renderOutlook()); document.querySelector(`#tab-${item.id}`)?.focus(); }}, item.label))));
  if (!outlook) {
    section.append(E('div', {id: 'outlook-content', role: 'tabpanel', 'aria-labelledby': `tab-${active.id}`}, empty(`${active.label} 전망을 위한 근거가 아직 없습니다.`, '연결된 시황과 경제 일정이 확보되면 근거·반대 증거·판단 변경 조건을 함께 제공합니다.', 'chart')));
    return section;
  }
  section.append(E('div', {class: 'outlook-body', id: 'outlook-content', role: 'tabpanel', 'aria-labelledby': `tab-${active.id}`}, E('h3', {class: 'outlook-headline'}, outlook.title), E('div', {class: 'outlook-markets'}, E('div', {class: 'outlook-market'}, E('strong', {}, 'KOSPI'), E('p', {}, outlook.kospi || '분석 근거 부족')), E('div', {class: 'outlook-market'}, E('strong', {}, 'KOSDAQ'), E('p', {}, outlook.kosdaq || '분석 근거 부족'))), E('div', {class: 'outlook-reason-grid'}, E('div', {class: 'outlook-reason-box'}, E('h3', {class: 'reason-title'}, E('i', {class: 'dot'}), '이 판단을 지지하는 근거'), reasonList(outlook.evidence, '확인된 근거 없음')), E('div', {class: 'outlook-reason-box risk'}, E('h3', {class: 'reason-title risk'}, E('i', {class: 'dot'}), '함께 볼 반대 증거'), reasonList(outlook.counter, '반대 증거 미제공'))), E('div', {class: 'invalidation'}, E('strong', {}, '판단을 바꿀 조건'), E('span', {}, arrayText(outlook.invalidation) || '판단 변경 조건 미제공')), E('div', {class: 'outlook-confidence'}, icon('info'), `판단 확신도: ${outlook.confidence ?? '평가 없음'} · ${state.demo ? '체험용 예시이며 실제 시장 전망이 아닙니다.' : '검증되지 않은 숫자 확률은 표시하지 않습니다.'}`)));
  return section;
}
function arrayText(value) { return Array.isArray(value) ? value.map(x => typeof x === 'string' ? x : x.text || x.title || '').join(' · ') : typeof value === 'string' ? value : ''; }
function reasonList(values, fallback) { const rows = Array.isArray(values) ? values : values ? [values] : []; return E('ul', {class: 'reason-list'}, (rows.length ? rows : [fallback]).map(value => E('li', {}, typeof value === 'string' ? value : value.text || value.title || ''))); }
function methodologyPanel() {
  return E('section', {class: 'panel'}, panelHead('전망을 읽는 방법', '기간이 달라지면 확인해야 할 근거도 달라집니다.', null, 'info'), E('div', {class: 'source-cards'}, [['오늘 · 2~3일', '해외 장 마감, 원화, 외국인 수급과 주도 업종의 지속성을 확인합니다.'], ['주간 · 월간', '경제지표·통화정책·기업실적이 금리와 이익 기대를 어떻게 바꾸는지 봅니다.'], ['3~6개월', '경기와 정책, 기업 이익의 조합을 평가합니다. 단기 등락으로 중기 방향을 단정하지 않습니다.']].map(([title, text]) => E('div', {class: 'source-card'}, E('div', {class: 'source-body'}, E('h3', {class: 'source-name'}, title), E('p', {class: 'source-description'}, text))))), E('div', {class: 'source-disclaimer'}, '전망은 관측 시점의 조건부 시나리오입니다. 새 정보가 들어오거나 명시한 판단 변경 조건이 충족되면 해석이 달라질 수 있습니다.'));
}
function renderEvents(compact = false) {
  const calendar = state.calendar;
  const events = (state.demo ? state.market?.events : calendar?.events) || [];
  const section = E('section', {class: 'panel'}, panelHead(compact ? '다음으로 볼 이벤트' : '주요 경제 일정', state.demo ? '화면 체험용 예시' : compact ? '한국시간 · 가까운 발표 일정' : '앞으로 35일간 예정된 주요 미국 지표와 FOMC', compact ? E('button', {type: 'button', class: 'text-button', onClick: () => navigate('calendar')}, '전체 일정', icon('chevron')) : badge('한국 시간 KST')));
  if (!events.length) {
    const message = !calendar ? '공식 일정을 불러오는 중입니다.' : calendar.status === 'ready' ? '확인된 예정 일정이 없습니다.' : '공식 일정을 불러오지 못했습니다.';
    section.append(empty(message, '', 'calendar'));
  }
  else section.append(E('div', {class: 'event-list'}, (compact ? events.slice(0, 3) : events).map(item => {
    const rawTime = item.at || item.dateTime || item.datetime || item.startsAt || item.date;
    const actualTime = item.time || (rawTime ? shortTime(rawTime) : '미정');
    const importance = Number(item.importance) || (item.impact === 'high' ? 3 : 1);
    return E('div', {class: 'event-row'}, E('div', {class: 'event-time'}, actualTime, E('small', {}, state.demo ? '가상 일정' : rawTime ? dateText(rawTime, {hour: undefined, minute: undefined}) : 'KST')), E('div', {class: 'event-country'}, item.country || item.region || 'GL'), E('div', {class: 'event-info'}, E('div', {class: 'event-name'}, item.name || item.title), E('p', {class: 'event-description'}, item.description || item.note || ''), !state.demo && item.sourceUrl ? link(item.source, item.sourceUrl) : null), E('div', {class: 'event-importance', 'aria-label': `중요도 ${Math.min(3, importance)}/3`}, [1, 2, 3].map(x => E('i', {class: x <= importance ? '' : 'dim'}))));
  })));
  section.append(E('div', {class: 'panel-foot'}, state.demo ? '예시 일정은 실제 발표 예정일·시각·중요도를 나타내지 않습니다.' : calendar?.status === 'partial' ? '일부 공식 일정을 불러오지 못했습니다.' : '발표 일정은 변경될 수 있습니다.'));
  return section;
}

function renderMarketTable() {
  const search = E('input', {type: 'search', placeholder: '지표 이름으로 검색', value: state.marketSearch, 'aria-label': '자산 검색', onInput: event => { state.marketSearch = event.target.value; renderMarketRows(); }});
  const groups = ['전체', ...new Set(normalizedQuotes().map(q => groupName(q.group)))];
  const filters = E('div', {class: 'filter-list'});
  groups.forEach(group => filters.append(E('button', {type: 'button', class: `filter-chip ${state.marketFilter === group ? 'active' : ''}`, onClick: () => { state.marketFilter = group; filters.querySelectorAll('button').forEach(node => node.classList.toggle('active', node.textContent === group)); renderMarketRows(); }}, group)));
  const panel = E('section', {class: 'panel'}, panelHead('자산별 전체 시세', '지표별 출처·기준시각·현물/선물 구분을 확인하세요', E('button', {type: 'button', class: 'text-button', onClick: () => navigate('sources')}, '연동 안내', icon('chevron'))), E('div', {class: 'toolbar'}, filters, E('div', {class: 'search-field'}, icon('search'), search)), E('div', {class: 'table-wrap'}, E('table', {}, E('caption', {class: 'sr-only'}, '자산별 가격, 변동, 기준과 데이터 출처'), E('thead', {}, E('tr', {}, E('th', {}, '지표 / 기준'), E('th', {class: 'num'}, '최근 관측값'), E('th', {class: 'num'}, '변동'), E('th', {}, '관측 시점'), E('th', {}, '출처 / 상태'))), E('tbody', {id: 'market-table-body'}))), E('div', {class: 'panel-foot'}, '수익률 변화는 bp, 가격 변화는 표시된 단위를 따릅니다. 1bp = 0.01%p. 장중 시세와 일별 종가, 24시간 등락을 같은 기준으로 비교하지 마세요.'));
  queueMicrotask(renderMarketRows);
  return panel;
}
function renderMarketRows() {
  const tbody = document.querySelector('#market-table-body');
  if (!tbody) return;
  const rows = normalizedQuotes().filter(q => (state.marketFilter === '전체' || groupName(q.group) === state.marketFilter) && String(q.name || '').toLowerCase().includes(state.marketSearch.toLowerCase()));
  tbody.replaceChildren(...rows.map(q => E('tr', {}, E('td', {}, E('strong', {class: 'data-table-name'},
  hasIndexChart(q) ? E('button', {type:'button',class:'market-table-chart-link',
    'aria-label':`${q.name} 과거 지수 차트 열기`,onClick:()=>openIndexChart(q)},q.name, icon('chart')) : q.name,
  E('small', {}, q.basis || groupName(q.group)))), E('td', {class: 'num mono'}, E('strong', {}, formatValue(q)), E('div', {class: 'tiny muted'}, q.unit || '')), E('td', {class: `num mono ${changeClass(q.change)}`}, hasValue(q) ? formatChange(q) : '—'), E('td', {}, E('div', {}, state.demo ? '예시 · 실제 시각 아님' : q.timestampPrecision === 'day' && q.observedAt ? String(q.observedAt).slice(0, 10) : q.observedAt ? `${dateText(q.observedAt)} KST` : '—'), E('div', {class: 'tiny muted'}, q.delay || (state.demo ? '가상 데이터' : ''))), E('td', {}, q.sourceUrl ? link(sourceName(q.source), q.sourceUrl) : E('span', {}, state.demo ? '체험용 예시' : sourceName(q.source)), E('div', {class: 'tiny muted', title: q.reason || ''}, state.demo ? '예시 데이터' : q.status === 'stale' ? '관측 지연 · 최신성 주의' : hasValue(q) ? q.status === 'live' ? '공급자 스냅샷' : '최근 유효 관측' : q.reason || '— 데이터 연결 필요')))));
  if (rows.length) {
    // Retain every existing row/quote link, but add strong category dividers.
    const byCategory=new Map();
    [...tbody.children].forEach((row,index)=>{
      const category=groupName(rows[index].group);
      if(!byCategory.has(category))byCategory.set(category,[]);
      byCategory.get(category).push(row);
    });
    const order=['한국시장','주식','변동성','금리','외환','원자재','디지털자산','기타'];
    const descriptions={
      '한국시장':'국내 주가지수와 외국인 순매수액',
      '주식':'미국 등 해외 대표 주가지수',
      '변동성':'시장 위험 및 불안 심리',
      '금리':'국채금리와 채권시장 지표',
      '외환':'달러·원 환율과 달러 지수',
      '원자재':'원유·금속 등 실물자산 가격',
      '디지털자산':'가상자산 현물 가격',
    };
    const ordered=[...byCategory.keys()].sort((a,b)=>
      (order.indexOf(a)<0?99:order.indexOf(a))-(order.indexOf(b)<0?99:order.indexOf(b)));
    const content=ordered.flatMap(name=>[
      E('tr',{class:'market-table-section'},
        E('td',{colspan:5},
          E('div',{class:'market-table-section-inner'},
            E('strong',{},name),E('span',{},descriptions[name]||'시장 관측 지표'),
            E('small',{},`${byCategory.get(name).length}개 지표`)))),
      ...byCategory.get(name),
    ]);
    tbody.replaceChildren(...content);
  }
  if (!rows.length) tbody.append(E('tr', {}, E('td', {colspan: 5}, E('div', {class: 'empty-state'}, '검색 조건에 맞는 지표가 없습니다.'))));
}
function renderEquityTable(title, rows) {
  const section = E('section', {class: 'panel'}, panelHead(title, state.demo ? '체험용 예시 · 실제 종목·업종 등락이 아닙니다.' : '공급사 시세가 없는 항목은 수치를 표시하지 않습니다.'));
  if (!rows.length) { section.append(E('div', {class: 'compact-empty'}, '— 데이터 연결 필요')); return section; }
  section.append(E('div', {class: 'table-wrap'}, E('table', {}, E('thead', {}, E('tr', {}, ['종목 / 지표', '가격 / 단위', '변동', '관측 시점', '출처'].map(x => E('th', {}, x)))), E('tbody', {}, rows.map(row => E('tr', {}, E('td', {}, E('strong', {}, row.name), E('div', {class: 'tiny muted'}, row.symbol || row.id || '')), E('td', {class: 'mono'}, hasValue(row) ? `${formatValue(row)} ${row.unit || ''}` : '—'), E('td', {class: changeClass(row.change)}, row.change === null || row.change === undefined ? '—' : formatChange(row)), E('td', {class: 'tiny muted'}, state.demo ? '가상 예시' : row.observedAt ? dateText(row.observedAt) : '—'), E('td', {class: 'tiny muted'}, state.demo ? '체험용 예시' : hasValue(row) ? sourceName(row.source) : row.reason || '데이터 연결 필요')))))));
  return section;
}
function failureLabel(code) {
  if (/^HTTP_429$/.test(code)) return '호출 제한(429)';
  if (/^HTTP_40[13]$/.test(code)) return '인증·접근 거부';
  if (/^HTTP_5\d\d$/.test(code)) return '공급자 서버 오류';
  if (/^HTTP_\d+$/.test(code)) return '공급자 응답 ' + code.slice(5);
  return ({
    timeout: '응답 시간 초과', dns_error: 'DNS 연결 오류',
    tls_error: '보안 연결 오류', outbound_denied: '외부 연결 거부',
    request_context: '요청 컨텍스트 오류', fetch_error: '요청 실패',
    invalid_json: '응답 형식 불일치', response_too_large: '응답 크기 초과',
    connection_lost: '연결 끊김',
  })[code] || '수신 오류';
}
function renderSources() {
  const sources = state.market?.sources || [];
  const quotes = normalizedQuotes();
  const good = quotes.filter(q => hasValue(q) && ['daily', 'delayed', 'live', 'monthly'].includes(q.status) && !q.deploymentBackup);
  const missing = quotes.filter(q => !hasValue(q));
  const outdated = quotes.filter(q => q.status === 'stale' || q.deploymentBackup);
  const panel = E('section', {class: 'panel'},
    panelHead('데이터 연결 현황', '설정 여부와 실제 수신, 오래된 값, API 장애를 구분합니다.',
      badge(state.demo ? '체험용 데이터' : `${good.length} / ${quotes.length} 지표 정상 수신`, state.demo ? 'amber' : 'blue')));
  if (sources.length) {
    panel.append(E('div', {class: 'source-cards'}, sources.map(source => {
      const details = [];
      if (source.expected != null) details.push(`정상 수신 ${source.received || 0}/${source.expected}`);
      if (source.stale) details.push(`오래된 값 ${source.stale}개`);
      if (source.monthly) details.push(`월간 평균 ${source.monthly}개 · 실시간 가격 아님`);
      if (source.backup) details.push(`백업 값 ${source.backup}개`);
      if (source.missing) details.push(`미수신 ${source.missing}개`);
      const errors = (source.failures || []).filter(x => x.count > 0)
        .map(x => `${failureLabel(x.code)} ${x.count}건`);
      return E('article', {class: 'source-card'},
        E('div', {class: 'source-icon'}, icon('source')),
        E('div', {class: 'source-body'},
          E('h3', {class: 'source-name'}, source.name || '데이터 공급자', badge(sourceStatus(source.status).label, sourceStatus(source.status).type)),
          E('p', {class: 'source-description'}, source.note || source.description || source.delay || '관측 기준을 확인하세요.'),
          details.length ? E('p', {class: 'source-description'}, details.join(' · ')) : null,
          errors.length ? E('p', {class: 'source-description'}, '요청 진단: ' + errors.join(' · ')) : null,
          source.url ? E('div', {class: 'source-description'}, link('공식 출처 확인', source.url)) : null));
    })));
  } else {
    panel.append(empty('시세 공급사 연결 상태를 확인할 수 없습니다.',
      '실제 수신 상태는 인증 후 시장 데이터를 조회해야 확인할 수 있습니다.'));
  }
  if (outdated.length && !state.demo) panel.append(E('div', {class: 'source-disclaimer'},
    E('strong', {}, '오래된 데이터 또는 배포 백업값'),
    E('p', {}, outdated.map(q => q.name).join(' · ')),
    E('p', {}, '과거 관측값은 최근 시장 방향 분석에 사용하지 않습니다.')));
  if (missing.length && !state.demo) panel.append(E('div', {class: 'source-disclaimer'},
    E('strong', {}, '연결 또는 수신 확인이 필요한 항목'),
    E('p', {}, missing.map(q => q.name).join(' · ')),
    E('p', {}, '자산별 시장 표에서 각 항목의 실패 원인과 공급원을 확인해 주세요.')));
  panel.append(E('div', {class: 'source-disclaimer'}, E('strong', {}, '관측 시각과 데이터 기준'),
    E('p', {}, '수신 시각과 관측 시각은 다릅니다. ECB 기준환율은 서울 현물환이 아니며, 배포 백업값은 실시간 가격이 아닙니다.'),
    E('p', {}, state.market?.asOf ? `최근 데스크 갱신: ${dateText(state.market.asOf)} KST` : '현재 실제 데이터 갱신 시각이 없습니다.')));
  return panel;
}
function sourceStatus(status) {
  if (status === 'backup') return {label: '백업값만 존재', type: 'amber'};
  return ({
    connected: {label: '정상 수신', type: 'green'},
    partial: {label: '일부만 수신', type: 'amber'},
    stale: {label: '관측값 오래됨', type: 'amber'},
    live: {label: '정상 수신', type: 'green'},
    standby: {label: '대체 공급원 대기', type: ''},
    no_data: {label: '수신 실패 · 확인 필요', type: 'amber'},
    unconfigured: {label: '인증·설정 필요', type: ''},
    demo: {label: '예시 · 미연결', type: 'amber'},
  })[status] || {label: status || '상태 미제공', type: ''};
}

function renderUsers() {
  const section = E('section', {class: 'panel'}, panelHead(state.demo ? '가상 회원 관리' : '회원 계정', state.demo ? '추가·수정 내용은 이 브라우저의 체험 상태에만 반영됩니다.' : 'PIN 계정과 초대 계정을 관리합니다.', B('회원 추가', () => userModal(), 'primary small', 'plus')));
  if (!state.users.length) { section.append(E('div', {class: 'admin-empty'}, state.loading ? '회원 목록을 불러오는 중입니다.' : '회원 목록을 새로고침해 주세요.')); return section; }
  section.append(E('div', {class: 'table-wrap'}, E('table', {}, E('caption', {class: 'sr-only'}, '회원 계정 관리'), E('thead', {}, E('tr', {}, ['이름 / 아이디', '권한', '계정 상태', '최근 접속', '관리'].map(x => E('th', {}, x)))), E('tbody', {}, state.users.map(user => E('tr', {}, E('td', {}, E('strong', {}, user.name), E('div', {class: 'tiny muted'}, user.username)), E('td', {}, badge(user.role === 'admin' ? '관리자' : user.pinLogin ? 'PIN 열람' : '회원', user.role === 'admin' ? 'blue' : '')), E('td', {}, E('span', {class: `status-dot ${user.disabled ? 'disabled' : ''}`}, E('i', {class: 'dot'}), user.disabled ? '이용 정지' : '이용 가능'), user.mustChangePassword ? E('div', {class: 'tiny muted'}, '비밀번호 변경 필요') : null), E('td', {class: 'tiny muted'}, state.demo ? '가상 접속' : user.lastSeen ? dateText(user.lastSeen) : '접속 기록 없음'), E('td', {}, E('div', {class: 'row-actions'}, B('수정', () => userModal(user), 'small'), B(user.disabled ? '이용 허용' : '이용 정지', () => userStatusModal(user), 'small', null, {disabled: user.id === state.user.id, title: user.id === state.user.id ? '내 계정은 이 화면에서 정지할 수 없습니다.' : ''})))))))));
  section.append(E('div', {class: 'panel-foot'}, state.demo ? '가상 계정에는 실제 비밀번호가 저장되지 않습니다.' : '계정을 정지하거나 비밀번호를 재설정하면 해당 계정의 기존 로그인 세션이 종료됩니다.'));
  return section;
}
function duration(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const seconds = Math.max(0, Number(value));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분` : seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${Math.floor(seconds % 60)}초` : `${Math.floor(seconds)}초`;
}
function renderActivity() {
  const activity = state.activity;
  const sessions = activity?.sessions || [];
  const totals = Array.isArray(activity?.totals) ? activity.totals : [];
  const prefix = state.demo ? '가상 ' : '';
  const onlineCount = activity?.online?.length ?? state.onlineCount;
  const summary = E('div', {class: 'summary-grid'}, statBox(`${prefix}현재 접속`, String(onlineCount), '회원 기준 · 여러 탭은 한 명'), statBox(`${prefix}기록된 세션`, activity ? String(sessions.length) : '—', '최근 로그인 기록 최대 500개'), statBox(`${prefix}활동 추정 시간`, totals.length ? duration(totals.reduce((sum, item) => sum + Number(item.activeSeconds || 0), 0)) : state.demo ? '34분' : '—', '회원별 중복 접속 시간 제외'));
  const note = E('div', {class: 'admin-note'}, state.demo ? '체험 모드 · 아래 계정, 접속 수, 이용 시간은 가상 예시입니다. 실제 사용자 기록을 조회하지 않습니다.' : activity?.measurement || '접속 현황은 서버가 수신한 화면 표시·최근 활동 신호로 집계합니다. 이용 시간은 추정치입니다.');
  const settings = E('section', {class: 'panel'}, panelHead('데스크 라운지 운영', '동시에 접속한 회원이 기준 인원 이상이면 대화할 수 있습니다.', null, 'chat'));
  const threshold = field('대화 가능한 최소 접속 인원', 'chatThreshold', {type: 'number', min: 1, max: 100, step: 1, value: state.threshold});
  const save = E('button', {type: 'submit', class: 'button primary small'}, state.demo ? '가상 설정 적용' : '설정 저장');
  settings.append(E('form', {class: 'settings-form', onSubmit: async event => {
    event.preventDefault();
    const value = Number(threshold.input.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) { toast('접속 인원은 1~100명으로 입력해 주세요.', true); return; }
    await busy(save, async () => { if (!state.demo) await api('/api/admin/settings', {method: 'PATCH', body: {chatThreshold: value}}); state.threshold = value; renderChat(); toast(state.demo ? '가상 대화 기준이 이 브라우저에만 적용됐습니다.' : '대화 기준 인원을 저장했습니다.'); });
  }}, threshold.node, save));
  const sessionPanel = E('section', {class: 'panel'}, panelHead(`${prefix}로그인 세션`, '로그인·최근 확인·연결 시간과 활동 추정 시간을 구분합니다.', badge(state.demo ? '가상 기록' : '관리자 전용', state.demo ? 'amber' : 'blue')));
  if (!sessions.length) sessionPanel.append(E('div', {class: 'admin-empty'}, state.loading ? '접속 기록을 불러오는 중입니다.' : '표시할 접속 기록이 없습니다.'));
  else sessionPanel.append(E('div', {class: 'table-wrap'}, E('table', {}, E('caption', {class: 'sr-only'}, '최근 로그인 세션 기록'), E('thead', {}, E('tr', {}, ['회원', '로그인', '최근 확인', '연결 시간', '활동 추정', '상태'].map(x => E('th', {}, x)))), E('tbody', {}, sessions.map(session => E('tr', {}, E('td', {}, E('strong', {}, session.name || session.username), E('div', {class: 'tiny muted'}, session.username || '')), E('td', {class: 'tiny'}, state.demo ? '가상 로그인' : dateText(session.loginAt || session.createdAt)), E('td', {class: 'tiny'}, state.demo ? '가상 접속' : dateText(session.lastSeen || session.lastSeenAt)), E('td', {}, state.demo ? '18분' : duration(session.connectedSeconds)), E('td', {}, state.demo ? '11분 20초' : duration(session.activeSeconds)), E('td', {}, badge(state.demo ? '가상 접속 중' : session.logoutAt ? '종료' : '유효 세션', session.logoutAt ? '' : 'green'))))))));
  sessionPanel.append(E('div', {class: 'panel-foot'}, `접속 기록 보관: ${activity?.retentionDays?.activity ?? 90}일 · 대화 기록 보관: ${activity?.retentionDays?.chat ?? 30}일. 유효 세션은 현재 화면을 보고 있다는 의미와 다릅니다.`));
  const result = [summary, note, settings, sessionPanel];
  if (totals.length) result.push(E('section', {class: 'panel'}, panelHead('회원별 누적 이용', '여러 탭·기기에서 겹친 시간을 한 번만 계산합니다.'), E('div', {class: 'table-wrap'}, E('table', {}, E('thead', {}, E('tr', {}, ['회원', '로그인 횟수', '연결 시간', '활동 추정', '최근 확인'].map(x => E('th', {}, x)))), E('tbody', {}, totals.map(item => E('tr', {}, E('td', {}, E('strong', {}, item.name), E('div', {class: 'tiny muted'}, item.username)), E('td', {}, item.loginCount), E('td', {}, duration(item.connectedSeconds)), E('td', {}, duration(item.activeSeconds)), E('td', {class: 'tiny'}, item.lastSeen ? dateText(item.lastSeen) : '기록 없음'))))))));
  return result;
}
function statBox(label, value, caption) { return E('div', {class: 'stat-box'}, E('p', {class: 'stat-label'}, label), E('p', {class: 'stat-value'}, value), E('p', {class: 'stat-caption'}, caption)); }
async function loadAdmin(view) {
  if (state.demo) { renderView(); return; }
  const generation = state.sessionGeneration;
  state.loading = true; renderView();
  try {
    const data = await api(view === 'users' ? '/api/admin/users' : '/api/admin/activity');
    if (generation !== state.sessionGeneration) return;
    if (view === 'users') state.users = data.users || [];
    else state.activity = data;
  } catch (error) { toast(errorText(error), true); }
  finally { if (generation === state.sessionGeneration) { state.loading = false; if (state.view === view) renderView(); } }
}

let closeCurrentModal = null;
function showModal(title, description, build, options = {}) {
  closeCurrentModal?.();
  const root = document.querySelector('#modal-root');
  const previous = document.activeElement;
  const body = E('div', {class: 'modal-body'});
  const dialog = E('section', {class: `modal ${options.className || ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title'}, E('div', {class: 'modal-head'}, E('div', {}, E('h2', {id: 'modal-title'}, title), description ? E('p', {}, description) : null), options.required ? null : iconButton('close', '창 닫기', () => close())), body);
  const overlay = E('div', {class: 'modal-backdrop', onClick: event => { if (event.target === overlay && !options.required) close(); }, onKeydown: event => {
    if (event.key === 'Escape' && !options.required) close();
    if (event.key === 'Tab') { const focusable = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,a[href]')]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}, dialog);
  function close() { root.replaceChildren(); closeCurrentModal = null; document.body.style.overflow = ''; if (previous?.isConnected) previous.focus(); }
  closeCurrentModal = close;
  root.replaceChildren(overlay);
  document.body.style.overflow = 'hidden';
  build(body, close);
  queueMicrotask(() => dialog.querySelector('input,select,textarea,button')?.focus());
  return close;
}
function profileModal() {
  const credential = state.user.pinLogin ? 'PIN' : '비밀번호';
  showModal('내 계정', state.demo ? '가상 체험 계정입니다.' : state.user.pinLogin ? '가입 정보는 본인에게만 표시되며, PIN으로 변경을 확인합니다.' : '계정 정보를 확인하고 비밀번호를 변경할 수 있습니다.', (body, close) => {
    const info=E('div', {class: 'profile-info'},
      E('div', {}, E('span', {}, '닉네임 / 이름'), E('strong', {}, state.user.name)),
      E('div', {}, E('span', {}, '아이디'), E('strong', {}, state.user.username)),
      E('div', {}, E('span', {}, '권한'), E('strong', {}, state.user.role === 'admin' ? '관리자' : '회원')));
    if (state.user.pinLogin) info.append(
      E('div', {}, E('span', {}, '생년월일 6자리'), E('strong', {}, state.user.birth6 || '미등록')),
      E('div', {}, E('span', {}, '성별'), E('strong', {}, state.user.gender || '미등록')));
    body.append(info);
    if(state.user.pinLogin && !state.demo) body.append(B('생년월일·성별 수정',()=>{close();profileDetailsModal();},'full','info'));
    body.append(B(credential + ' 변경', () => { close(); passwordModal(); }, 'full', 'lock'),
      E('div', {class: 'modal-actions'}, B(state.demo ? '체험 종료' : '로그아웃', () => { close(); state.demo ? exitDemo() : logout(); }, 'danger', 'logout')));
  });
}
function profileDetailsModal() {
  if(!state.user?.pinLogin || state.demo)return;
  showModal('내 가입 정보', '생년월일과 성별을 수정하려면 현재 PIN을 확인해 주세요. 다른 회원에게 공개되지 않습니다.',(body,close)=>{
    const birth=field('생년월일 6자리','profileBirth6',{type:'text',inputmode:'numeric',pattern:'[0-9]{6}',minlength:6,maxlength:6,required:true,value:state.user.birth6||'',placeholder:'950705',autocomplete:'off'});
    const gender=E('select',{id:'profileGender',name:'profileGender',required:true},
      E('option',{value:'',disabled:true,selected:!state.user.gender},'성별 선택'),
      E('option',{value:'남',selected:state.user.gender==='남'},'남'),
      E('option',{value:'여',selected:state.user.gender==='여'},'여'));
    const pin=field('현재 PIN 4자리','profilePin',{type:'password',autocomplete:'current-password',required:true,...pinFields});
    const error=E('p',{class:'form-error',role:'alert'});
    const submit=E('button',{type:'submit',class:'button primary'},'정보 저장');
    body.append(E('form',{onSubmit:async event=>{
      event.preventDefault();error.textContent='';
      await busy(submit,async()=>{
        try{
          const data=await api('/api/profile',{method:'PATCH',body:{birth6:birth.input.value.trim(),gender:gender.value,pin:pin.input.value}});
          pin.input.value='';
          if(data.user)state.user={...state.user,...data.user};
          close();toast('가입 정보를 저장했습니다.');
        }catch(e){error.textContent=errorText(e);}
      });
    }},birth.node,E('div',{class:'field'},E('label',{for:'profileGender'},'성별'),gender),
      pin.node,error,E('div',{class:'modal-actions'},B('취소',close),submit)));
  });
}
function passwordModal(required = false) {
  const pinLogin = state.user.pinLogin;
  const credential = pinLogin ? 'PIN' : '비밀번호';
  const newFields = pinLogin ? pinFields : {minlength: 10, maxlength: 128};
  showModal(required ? '비밀번호 변경이 필요합니다' : credential + ' 변경', required ? '임시 비밀번호를 본인만 아는 새 비밀번호로 바꾼 후 이용할 수 있습니다.' : state.demo ? '실제 비밀번호를 변경하지 않는 체험 기능입니다.' : '변경 후 새 ' + credential + '로 로그인할 수 있습니다.', (body, close) => {
    const current = field('현재 ' + credential, 'currentPassword', {type: 'password', autocomplete: 'current-password', maxlength: 128, ...(pinLogin ? pinFields : {})});
    const next = field('새 ' + credential, 'newPassword', {type: 'password', autocomplete: 'new-password', ...newFields, placeholder: pinLogin ? '숫자 4자리' : '10~128자의 비밀번호'});
    const confirm = field('새 ' + credential + ' 확인', 'confirmNewPassword', {type: 'password', autocomplete: 'new-password', ...newFields});
    const errorNode = E('p', {class: 'form-error', role: 'alert'});
    const submit = E('button', {type: 'submit', class: 'button primary'}, state.demo ? '가상 변경 체험' : credential + ' 변경');
    body.append(E('form', {onSubmit: async event => {
      event.preventDefault(); errorNode.textContent = '';
      if (next.input.value !== confirm.input.value) { errorNode.textContent = '새 ' + credential + ' 입력이 서로 다릅니다.'; return; }
      await busy(submit, async () => {
        try {
          if (!state.demo) await api('/api/password', {method: 'POST', body: {currentPassword: current.input.value, newPassword: next.input.value}});
          state.user.mustChangePassword = false;
          current.input.value = ''; next.input.value = ''; confirm.input.value = '';
          close();
          toast(state.demo ? '비밀번호 변경 흐름을 체험했습니다. 실제 비밀번호는 저장되지 않았습니다.' : credential + ' 변경을 완료했습니다.');
          if (!state.demo) { disconnect(); await loadDashboard(); }
        } catch (error) { errorNode.textContent = errorText(error); }
      });
    }}, state.demo ? E('p', {class: 'modal-notice'}, '가상의 문자열을 입력해 주세요. 실제 사용 중인 비밀번호는 입력하지 마세요.') : null, current.node, next.node, confirm.node, errorNode, E('div', {class: 'modal-actions'}, required ? B('로그아웃', () => { close(); logout(); }) : B('취소', close), submit)));
  }, {required});
}
function userModal(user = null) {
  showModal(user ? '회원 정보 수정' : '새 회원 추가', state.demo ? '가상 계정만 변경합니다. 실제 비밀번호를 입력하지 마세요.' : user?.pinLogin ? '표시 이름을 수정하거나 숫자 4자리 PIN을 재설정합니다.' : user ? '표시 이름을 수정하거나 임시 비밀번호를 새로 발급합니다.' : '추가한 회원에게 아이디와 임시 비밀번호를 안전하게 전달해 주세요.', (body, close) => {
    const name = field('표시 이름', 'memberName', {value: user?.name || '', maxlength: 50, autocomplete: 'off'});
    const username = field('아이디', 'memberUsername', {value: user?.username || '', pattern: '[a-zA-Z0-9._-]{3,40}', minlength: 3, maxlength: 40, placeholder: '영문·숫자·점·밑줄·하이픈 3~40자', autocomplete: 'off'});
    const password = field(user?.pinLogin ? 'PIN 재설정 (선택)' : user ? '임시 비밀번호 재설정 (선택)' : '임시 비밀번호', 'memberPassword', {type: 'password', autocomplete: 'new-password', minlength: 10, maxlength: 128, required: !user, placeholder: user ? '기존 값 유지 시 비워두세요' : '10~128자의 임시 비밀번호', ...(user?.pinLogin ? pinFields : {})});
    const own = user?.id === state.user.id;
    const role = E('select', {name: 'role', id: 'member-role'}, E('option', {value: 'member'}, '일반 회원'), E('option', {value: 'admin'}, '관리자'));
    const errorNode = E('p', {class: 'form-error', role: 'alert'});
    const submit = E('button', {type: 'submit', class: 'button primary'}, state.demo ? '가상 계정에 적용' : user ? '변경 저장' : '회원 추가');
    const form = E('form', {onSubmit: async event => {
      event.preventDefault(); errorNode.textContent = '';
      await busy(submit, async () => {
        try {
          const payload = {name: name.input.value.trim()};
          if (password.input.value && !own) payload.password = password.input.value;
          if (!user) Object.assign(payload, {username: username.input.value.trim(), role: role.value});
          if (state.demo) {
            if (!user && state.users.some(item => item.username === payload.username)) throw new Error('이미 사용하는 가상 아이디입니다.');
            const safe = {name: payload.name, ...(user ? {} : {username: payload.username, role: payload.role})};
            if (user) state.users = state.users.map(item => item.id === user.id ? {...item, ...safe, mustChangePassword: payload.password ? true : item.mustChangePassword} : item);
            else state.users.push({...safe, id: `demo-${crypto.randomUUID()}`, disabled: false, mustChangePassword: true});
          } else await api(user ? `/api/admin/users/${encodeURIComponent(user.id)}` : '/api/admin/users', {method: user ? 'PATCH' : 'POST', body: payload});
          password.input.value = '';
          if (own) state.user.name = payload.name;
          close(); await loadAdmin('users'); toast(state.demo ? '가상 회원 정보를 이 브라우저에만 반영했습니다.' : user ? '회원 정보를 변경했습니다.' : '회원을 추가했습니다.');
        } catch (error) { errorNode.textContent = errorText(error); }
      });
    }});
    form.append(name.node);
    if (!user) form.append(username.node, E('div', {class: 'field'}, E('label', {for: 'member-role'}, '권한'), role));
    if (!own) form.append(password.node);
    else form.append(E('p', {class: 'modal-notice'}, '내 비밀번호는 우측 상단 계정 메뉴에서 변경할 수 있습니다.'));
    form.append(errorNode, E('div', {class: 'modal-actions'}, B('취소', close), submit)); body.append(form);
  });
}
function userStatusModal(user) {
  showModal(user.disabled ? '계정 이용을 허용할까요?' : '계정 이용을 정지할까요?', `${user.name} (${user.username})${state.demo ? ' · 가상 계정' : ''}`, (body, close) => {
    body.append(E('p', {class: 'modal-notice'}, user.disabled ? '이 계정으로 다시 로그인할 수 있게 됩니다.' : '기존 로그인 세션이 종료되고 새 로그인이 차단됩니다. 이후 이용 허용으로 되돌릴 수 있습니다.'), E('div', {class: 'modal-actions'}, B('취소', close), B(user.disabled ? '이용 허용' : '이용 정지', event => busy(event.currentTarget, async () => {
      if (state.demo) { state.users = state.users.map(item => item.id === user.id ? {...item, disabled: !item.disabled} : item); if (!user.disabled) { state.online = state.online.filter(item => item.id !== user.id); state.onlineCount = state.online.length; } }
      else await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {method: 'PATCH', body: {disabled: !user.disabled}});
      close(); await loadAdmin('users'); renderChat(); toast(state.demo ? '가상 계정 상태를 변경했습니다.' : '계정 상태를 변경했습니다.');
    }), user.disabled ? 'primary' : 'danger')));
  });
}

function renderChat() {
  const panel = document.querySelector('#chat-panel');
  if (!panel || !state.user) return;
  const activeInput = document.activeElement?.id === 'chat-input';
  const activeSelection = activeInput ? document.activeElement.selectionStart : null;
  const canChat = (state.demo || state.connected) && state.onlineCount >= state.threshold && !state.user.mustChangePassword;
  const status = state.demo ? `가상 접속 ${state.onlineCount}명` : state.connected ? `${state.onlineCount}명 접속 중` : '연결 대기';
  panel.replaceChildren(E('div', {class: 'panel-head'}, E('div', {}, E('h2', {class: 'panel-title'}, icon('chat'), '데스크 라운지'), E('div', {class: 'chat-status'}, E('i', {class: 'dot'}), status)), E('div', {class: 'chat-header-meta'}, badge(state.demo ? '가상 대화' : 'MEMBERS', state.demo ? 'amber' : ''), iconButton('close', '대화방 닫기', () => toggleChat(false), {class: 'icon-button chat-close'}))), E('div', {class: 'online-avatars'}, state.online.slice(0, 4).map(user => E('span', {class: 'online-avatar', title: `${user.name}${user.active ? ' · 최근 활동' : ' · 대기'}`}, String(user.name || '?').slice(0, 1))), E('span', {class: 'online-names'}, state.onlineCount ? state.online.slice(0, 2).map(x => x.name).join(', ') + (state.onlineCount > 2 ? ` 외 ${state.onlineCount - 2}명` : '') : '함께 시장을 읽는 공간')));
  if (!state.demo && !state.connected) panel.append(E('div', {class: 'disconnected-note'}, state.user.mustChangePassword ? '비밀번호 변경 후 대화방을 이용할 수 있습니다.' : '실시간 연결을 기다리고 있습니다. 연결 후 메시지를 보낼 수 있습니다.'));
  const messages = E('div', {class: 'chat-messages', id: 'chat-messages', role: 'log', 'aria-live': 'polite', 'aria-label': state.demo ? '가상 대화 기록' : '회원 대화 기록'});
  if (!state.messages.length) messages.append(E('div', {class: 'chat-empty'}, icon('chat'), E('p', {}, '오늘의 흐름, 함께 이야기해요.', E('br'), '첫 번째 메시지를 남겨보세요.')));
  else state.messages.slice(-100).forEach(message => messages.append(E('article', {class: `chat-message ${message.userId === state.user.id || message.id?.startsWith('demo-own-') ? 'own' : ''}`}, E('div', {class: 'avatar'}, String(message.name || '회원').slice(0, 1)), E('div', {class: 'chat-message-body'}, E('div', {class: 'chat-message-header'}, E('span', {}, message.name || '회원'), E('time', {datetime: message.createdAt || ''}, message.createdAt ? shortTime(message.createdAt) : '예시')), E('p', {class: 'chat-text'}, message.text || '')))));
  const textarea = E('textarea', {id: 'chat-input', 'aria-label': state.demo ? '가상 대화 입력' : '대화 메시지', placeholder: canChat ? state.demo ? '가상 메시지를 남겨보세요' : '오늘의 시장을 이야기해보세요' : `${state.threshold}명 이상 접속하면 대화할 수 있어요`, maxlength: 1000, rows: 1, disabled: !canChat, onInput: event => { state.chatDraft = event.target.value; }, onKeydown: event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendChat(); } }});
  textarea.value = state.chatDraft;
  const form = E('form', {class: 'chat-compose', onSubmit: event => { event.preventDefault(); sendChat(); }}, E('div', {class: 'chat-compose-row'}, textarea, E('button', {type: 'submit', class: 'icon-button', 'aria-label': state.demo ? '가상 메시지 보내기' : '메시지 보내기', disabled: !canChat}, icon('send'))), E('p', {class: 'chat-compose-help'}, state.demo ? `예시 회원 ${state.threshold}명 이상일 때 활성화 · 현재 브라우저 전용` : `접속 ${state.threshold}명 이상일 때 활성화 · Enter 전송 · 최대 1,000자`));
  panel.append(messages, form);
  if (state.demo) panel.append(E('div', {class: 'chat-mode-label'}, '가상 대화 · 다른 사용자에게 전달되거나 서버에 저장되지 않습니다.'));
  const count = document.querySelector('#chat-toggle-count'); if (count) count.textContent = state.onlineCount;
  messages.scrollTop = messages.scrollHeight;
  if (activeInput && canChat) { textarea.focus(); if (activeSelection !== null) textarea.setSelectionRange(activeSelection, activeSelection); }
}
function sendChat() {
  const text = state.chatDraft.trim();
  if (!text) return;
  if (state.onlineCount < state.threshold) { toast(`${state.threshold}명 이상 접속해야 대화할 수 있습니다.`, true); return; }
  if (state.demo) {
    state.messages.push({id: `demo-own-${crypto.randomUUID()}`, userId: state.user.id, name: state.user.name, text, createdAt: new Date().toISOString()});
    state.chatDraft = ''; renderChat(); return;
  }
  if (state.ws?.readyState !== WebSocket.OPEN) { toast('실시간 연결을 확인해 주세요.', true); return; }
  state.ws.send(JSON.stringify({type: 'chat', text}));
  state.chatDraft = ''; const input = document.querySelector('#chat-input'); if (input) input.value = '';
}
function heartbeat() {
  if (!state.demo && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type: 'heartbeat', visible: !document.hidden, active: Date.now() - state.lastActivity < 300000}));
}
function connectChat() {
  if (!state.user || state.demo || state.user.pinLogin || state.user.mustChangePassword) return;
  if (state.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.ws.readyState)) return;
  const generation = state.sessionGeneration;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`);
  state.ws = ws;
  ws.addEventListener('open', () => { if (generation !== state.sessionGeneration) { ws.close(); return; } state.connected = true; heartbeat(); renderChat(); });
  ws.addEventListener('message', event => {
    if (generation !== state.sessionGeneration) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'state') { state.online = Array.isArray(data.online) ? data.online : []; state.onlineCount = Number.isFinite(data.count) ? data.count : state.online.length; state.threshold = Number.isInteger(data.threshold) ? data.threshold : state.threshold; if (Array.isArray(data.messages)) state.messages = data.messages; renderChat(); }
    if (data.type === 'message' && data.message) { if (!state.messages.some(item => item.id === data.message.id)) state.messages.push(data.message); renderChat(); }
    if (data.type === 'error' || data.error) toast(data.error || data.message || '메시지를 보내지 못했습니다.', true);
  });
  ws.addEventListener('close', event => {
    if (generation !== state.sessionGeneration || state.ws !== ws) return;
    state.connected = false; state.ws = null; state.online = []; state.onlineCount = 0; renderChat();
    if (event.code === 4001 || event.code === 1008) { expireSession(); return; }
    clearTimeout(state.reconnect); state.reconnect = setTimeout(connectChat, 7000);
  });
  ws.addEventListener('error', () => { state.connected = false; renderChat(); });
}
function disconnect() {
  clearTimeout(state.reconnect); state.reconnect = null;
  const ws = state.ws; state.ws = null; state.connected = false;
  if (ws) ws.close();
}
async function loadMarket() {
  const generation = state.sessionGeneration;
  const data = await api('/api/market');
  if (generation !== state.sessionGeneration || !state.user || state.demo) return;
  state.market = {...defaultMarket(), ...data};
}
async function loadCalendar() {
  const generation = state.sessionGeneration;
  const data = await api('/api/calendar');
  if (generation === state.sessionGeneration && state.user && !state.demo) state.calendar = data;
}
async function loadDashboard() {
  const generation = state.sessionGeneration;
  const requests = [api('/api/market'), api('/api/calendar')];
  if (!state.user?.pinLogin) requests.push(api('/api/chat/history'), api('/api/settings'));
  const results = await Promise.allSettled(requests);
  if (generation !== state.sessionGeneration || !state.user || state.demo) return;
  const [market, calendar, history, settings] = results;
  if (market.status === 'fulfilled') state.market = {...defaultMarket(), ...market.value};
  else { state.market = defaultMarket(); toast(`시황 조회: ${errorText(market.reason)}`, true); }
  state.calendar = calendar.status === 'fulfilled' ? calendar.value : {status: 'unavailable', events: []};
  if (history?.status === 'fulfilled') state.messages = history.value.messages || [];
  if (settings?.status === 'fulfilled' && Number.isInteger(settings.value.chatThreshold)) state.threshold = settings.value.chatThreshold;
  if (results.some(result => result.status === 'rejected' && result.reason.status === 401)) { await expireSession(); return; }
  renderView(); renderChat(); connectChat();
}
async function expireSession() {
  if (!state.user || state.demo) return;
  disconnect(); state.sessionGeneration++; state.user = null; state.messages = []; state.chatDraft = ''; state.online = []; state.onlineCount = 0;
  closeCurrentModal?.(); renderWelcome(); toast('로그인 세션이 종료됐습니다. 다시 로그인해 주세요.');
}
async function logout() {
  try { await api('/api/logout', {method: 'POST', body: {}}); }
  catch (error) { toast(errorText(error), true); return; }
  disconnect(); state.sessionGeneration++; state.user = null; state.messages = []; state.chatDraft = ''; state.online = []; state.onlineCount = 0;
  closeCurrentModal?.(); renderWelcome();
}
function exitDemo() {
  disconnect(); state.sessionGeneration++; state.demo = false; state.user = null; state.messages = []; state.chatDraft = ''; state.online = []; state.onlineCount = 0; state.users = []; state.activity = null; state.market = null; state.chatOpen = false;
  closeCurrentModal?.(); renderWelcome();
}
async function initialize() {
  if (location.protocol === 'file:') { enterDemo(); return; }
  const results = await Promise.allSettled([api('/api/status'), api('/api/me')]);
  state.status = results[0].status === 'fulfilled' ? results[0].value : {error: true};
  if (results[1].status === 'fulfilled' && results[1].value.user) {
    state.user = results[1].value.user; state.market = defaultMarket(); state.sessionGeneration++;
    renderDesk(); await loadDashboard();
    if (state.user?.mustChangePassword) passwordModal(true);
  } else renderWelcome(location.pathname === '/setup' && state.status.setupAvailable && !state.status.initialized ? 'setup' : 'pin');
}
document.addEventListener('visibilitychange', heartbeat);
['pointerdown', 'keydown', 'touchstart'].forEach(event => document.addEventListener(event, () => { state.lastActivity = Date.now(); }, {passive: true}));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (state.chatOpen) toggleChat(false); if (state.menuOpen) toggleMenu(); } });
window.addEventListener('pagehide', () => { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type: 'heartbeat', visible: false, active: false})); });
window.setInterval(() => { updateClock(); heartbeat(); }, 20000);
initialize().catch(error => { state.status = {error: true}; renderWelcome(); toast(errorText(error), true); });
