// ===== 설정 =====
const CONFIG = {
    // 시트 ID는 비밀번호로 암호화되어 있음 (AES-GCM + PBKDF2)
    // 비밀번호가 맞아야만 복호화되어 시트에 접근 가능
    // 새로 생성: /tmp/encrypt-sheet-id.mjs 참고 (비밀번호·시트ID 변경 시)
    VAULT: {
        salt: '7V7aweeTI/usuGv43Pecnw==',
        iv: 'JK9m1SXE5z7N9pKl',
        data: 'DAVgMdNlGucLtLgV1RusTCteBGW+0ani1b1ZzdUycXkyfT8ubH+XCnkKWEhNHn5NXCC+AJFR2gaAyC2e',
        iterations: 600000,
    },
    // 대출·목표·계좌 분류 설정은 구글 시트 '설정' 탭에서 로드 (코드에 개인정보 없음)
};

// ===== 암호화 유틸 =====
const b64decode = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function decryptSheetId(password) {
    const enc = new TextEncoder();
    const v = CONFIG.VAULT;
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: b64decode(v.salt), iterations: v.iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false, ['decrypt']
    );
    // 비밀번호가 틀리면 여기서 예외 발생 (AES-GCM 인증 실패)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(v.iv) }, key, b64decode(v.data));
    return new TextDecoder().decode(decrypted);
}

// ===== 기본 데이터 (시트 로드 실패 시 표시되는 더미 샘플) =====
const DEFAULT_DATA = {
    '2026-06': {
        income: [
            { name: '남편 월급', amount: 3000000 },
            { name: '아내 월급', amount: 3000000 },
        ],
        variable: [
            { name: '식비', amount: 500000 },
            { name: '생활비', amount: 300000 },
            { name: '관리비', amount: 200000 },
        ],
        fixed: [
            { name: '대출이자', amount: 1000000 },
            { name: '보험', amount: 200000 },
        ],
        allowance: [
            { name: '남편 용돈', amount: 300000 },
            { name: '아내 용돈', amount: 300000 },
        ],
        subscription: [
            { name: '유튜브 프리미엄', amount: 15000 },
            { name: 'OTT', amount: 15000 },
        ],
        saving: [
            { name: '적금', amount: 500000 },
            { name: '주식 투자', amount: 500000 },
        ],
        accounts: [
            { name: '공용통장', balance: 1000000 },
            { name: '청약', balance: 1000000 },
            { name: '적금', balance: 1000000 },
        ],
        loanPaid: 1000000,
        goalHouse: 1000000,
    },
};

// ===== App =====
let currentMonth = '';
let allData = {};
let expenseChart = null;
let trendChart = null;
let sheetId = null; // 복호화된 시트 ID (메모리 + 세션)

const App = {
    init() {
        const saved = sessionStorage.getItem('finance-sheet-id');
        if (saved) {
            sheetId = saved;
            this.showDashboard();
        }
        document.getElementById('pw-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.unlock();
        });
    },

    async unlock() {
        const pw = document.getElementById('pw-input').value;
        const errEl = document.getElementById('pw-error');
        errEl.textContent = '확인 중...';
        try {
            sheetId = await decryptSheetId(pw);
            sessionStorage.setItem('finance-sheet-id', sheetId);
            errEl.textContent = '';
            this.showDashboard();
        } catch (e) {
            errEl.textContent = '비밀번호가 틀렸습니다.';
        }
    },

    showDashboard() {
        document.getElementById('lock-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        this.loadData();
    },

    async loadData() {
        // 구글 시트 연동이 설정되어 있으면 시트에서 로드
        if (sheetId) {
            try {
                await this.fetchFromSheet();
            } catch (e) {
                console.log('구글 시트 로드 실패, 기본 데이터 사용:', e);
                allData = DEFAULT_DATA;
            }
        } else {
            allData = DEFAULT_DATA;
        }

        // 월 선택 드롭다운 (2026-06 이후만, 데이터 있는 달만)
        const months = Object.keys(allData).filter(m => m >= '2026-06').sort().reverse();
        const select = document.getElementById('month-select');
        select.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');

        // 현재 월에 해당하는 탭을 기본 선택
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        currentMonth = months.includes(thisMonth) ? thisMonth : months[0] || '2026-06';
        select.value = currentMonth;
        this.renderMonth(currentMonth);
    },

    loadMonth(month) {
        currentMonth = month;
        this.renderMonth(month);
    },

    renderMonth(month) {
        const d = allData[month];
        if (!d) return;

        const totalIncome = this.sum(d.income);
        const totalVariable = this.sum(d.variable);
        const totalFixed = this.sum(d.fixed);
        const totalAllowance = this.sum(d.allowance);
        const totalSub = this.sum(d.subscription);
        const totalExpense = totalVariable + totalFixed + totalAllowance + totalSub;
        const totalSaving = this.sum(d.saving);
        const balance = totalIncome - totalExpense - totalSaving;

        document.getElementById('total-income').textContent = this.fmt(totalIncome);
        document.getElementById('total-expense').textContent = this.fmt(totalExpense);
        document.getElementById('total-save').textContent = this.fmt(totalSaving);

        const balEl = document.getElementById('balance');
        balEl.textContent = this.fmt(balance);
        balEl.style.color = balance >= 0 ? '#f39c12' : '#e74c3c';

        // 지출 차트
        this.renderExpenseChart([
            { label: '변동지출', value: totalVariable, color: '#FF6B6B' },
            { label: '고정지출', value: totalFixed, color: '#FFA94D' },
            { label: '용돈', value: totalAllowance, color: '#A78BFA' },
            { label: 'IT 구독', value: totalSub, color: '#339AF0' },
        ]);

        // 통장별 잔고 (트리맵)
        this.renderTreemap(d.accounts || []);

        // 대출 현황 (시트 '설정' 탭 기반 — 없으면 섹션 숨김)
        this.renderLoan(d.loanPaid || 0);

        // 상세 내역 (아코디언 + 목표 대비 비교)
        const budget = this.budgetData || {};
        const categories = [
            { key: 'income', label: '수입', items: d.income, budget: budget.income, type: 'income', style: 'income-title' },
            { key: 'variable', label: '변동 지출', items: d.variable, budget: budget.variable, type: 'expense', style: 'expense-title' },
            { key: 'fixed', label: '고정 지출', items: d.fixed, budget: budget.fixed, type: 'expense', style: 'expense-title' },
            { key: 'allowance', label: '용돈', items: d.allowance, budget: budget.allowance, type: 'expense', style: 'expense-title' },
            { key: 'subscription', label: 'IT 구독료', items: d.subscription, budget: budget.subscription, type: 'expense', style: 'expense-title' },
            { key: 'saving', label: '월 저축', items: d.saving, budget: budget.saving, type: 'saving', style: 'save-title' },
        ];

        const accordion = document.getElementById('detail-accordion');
        accordion.innerHTML = categories.map(cat => {
            const total = this.sum(cat.items);
            const detailHtml = this.buildDetailCompare(cat.items, cat.budget, cat.type);
            return `<details class="detail-group">
                <summary class="detail-summary ${cat.style}">
                    <span class="cat-name">${cat.label}</span>
                    <span><span class="cat-total">${this.fmt(total)}</span><span class="cat-arrow">▸</span></span>
                </summary>
                <div class="detail-list" style="padding:8px 12px 12px;">${detailHtml}</div>
            </details>`;
        }).join('');

        // 목표 — 시트 '설정' 탭 기반, 통장 잔고 자동 합산 (없으면 섹션 숨김)
        this.renderGoals(d.accounts || []);

        // 월별 수입/지출 추이 차트
        this.renderTrendChart();

        // 자산 추이 꺾은선 차트
        this.renderAssetTrendChart();
    },

    renderLoan(loanPaid) {
        const s = this.settings || {};
        const section = document.getElementById('loan-section');
        const total = parseInt(String(s['대출 원금'] || '').replace(/[",\s]/g, '')) || 0;
        if (!total) { section.style.display = 'none'; return; }
        section.style.display = '';
        const remain = total - loanPaid;
        const pct = loanPaid / total * 100;
        document.getElementById('loan-total').textContent = this.fmt(total);
        document.getElementById('loan-rate').textContent = s['대출 금리'] ? s['대출 금리'] + '%' : '-';
        document.getElementById('loan-method').textContent = s['상환 방식'] || '-';
        document.getElementById('loan-period').textContent = s['대출 기간'] || '-';
        document.getElementById('loan-paid').textContent = this.fmt(loanPaid);
        document.getElementById('loan-remain').textContent = this.fmt(remain);
        document.getElementById('loan-bar').style.width = pct + '%';
        document.getElementById('loan-pct').textContent = pct.toFixed(2) + '% 상환 완료';
    },

    renderGoals(accounts) {
        const s = this.settings || {};
        const section = document.getElementById('goal-section');
        const list = document.getElementById('goal-list');
        const colors = ['linear-gradient(90deg,#6C63FF,#A78BFA)', 'linear-gradient(90deg,#339AF0,#74C0FC)', 'linear-gradient(90deg,#51CF66,#8CE99A)'];
        const goals = [];
        for (let i = 1; i <= 5; i++) {
            const name = s[`목표${i} 이름`];
            if (!name) continue;
            const target = parseInt(String(s[`목표${i} 금액`] || '').replace(/[",\s]/g, '')) || 0;
            const keywords = String(s[`목표${i} 계좌`] || '').split(',').map(t => t.trim()).filter(Boolean);
            const current = accounts
                .filter(a => keywords.some(k => a.name.includes(k)))
                .reduce((sum, a) => sum + a.balance, 0);
            goals.push({ name, target, current, desc: s[`목표${i} 설명`] || '' });
        }
        if (goals.length === 0) { section.style.display = 'none'; return; }
        section.style.display = '';
        list.innerHTML = goals.map((g, i) => `<div class="goal-item">
            <div class="goal-header">
                <span class="goal-name">${g.name}</span>
                <span class="goal-target">목표 ${this.fmtKorean(g.target)}</span>
            </div>
            ${g.desc ? `<p class="goal-desc">${g.desc}</p>` : ''}
            <div class="goal-progress">
                <div class="goal-bar" style="width:${g.target ? Math.min(g.current / g.target * 100, 100) : 0}%;background:${colors[i % colors.length]};"></div>
            </div>
            <p class="goal-status">${this.fmt(g.current)} / ${this.fmt(g.target)}</p>
        </div>`).join('');
    },

    renderExpenseChart(data) {
        const ctx = document.getElementById('expense-chart').getContext('2d');
        if (expenseChart) expenseChart.destroy();
        expenseChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    data: data.map(d => d.value),
                    backgroundColor: data.map(d => d.color),
                    borderWidth: 0,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, font: { size: 13, family: 'Noto Sans KR' } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${parseInt(ctx.raw).toLocaleString()}원`
                        }
                    }
                },
                cutout: '60%',
            }
        });
    },

    renderTreemap(accounts) {
        const container = document.getElementById('treemap');
        let totalAsset = accounts.reduce((s, a) => s + a.balance, 0);
        document.getElementById('total-asset-value').textContent = this.fmt(totalAsset);

        // 리사이즈 시 다시 그리기 (최초 1회만 등록)
        this._treemapAccounts = accounts;
        if (!this._treemapResizeBound) {
            this._treemapResizeBound = true;
            let timer;
            window.addEventListener('resize', () => {
                clearTimeout(timer);
                timer = setTimeout(() => this.renderTreemap(this._treemapAccounts || []), 200);
            });
        }

        // 터치/클릭 시 툴팁 잠깐 표시 (작은 칸도 이름·금액 확인 가능, 최초 1회만 등록)
        if (!this._treemapTipBound) {
            this._treemapTipBound = true;
            container.addEventListener('click', (e) => {
                const item = e.target.closest('.treemap-item');
                if (!item) return;
                container.querySelectorAll('.treemap-item.show-tip').forEach(el => {
                    if (el !== item) el.classList.remove('show-tip');
                });
                item.classList.add('show-tip');
                clearTimeout(this._tipTimer);
                this._tipTimer = setTimeout(() => item.classList.remove('show-tip'), 2500);
            });
        }

        if (totalAsset === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">데이터 없음</p>';
            return;
        }

        // 색상 그룹 (시트 '설정' 탭의 계좌 분류 기반)
        const s = this.settings || {};
        const livingKeys = String(s['생활자금 계좌'] || '').split(',').map(t => t.trim()).filter(Boolean);
        const investKeys = String(s['투자저축 계좌'] || '').split(',').map(t => t.trim()).filter(Boolean);
        const colorFor = (name) => {
            if (livingKeys.some(k => name.includes(k))) return '#2bbfb3';
            if (investKeys.some(k => name.includes(k))) return '#f5c542';
            return '#b0b8c1';
        };

        const items = [...accounts]
            .filter(a => a.balance > 0)
            .sort((a, b) => b.balance - a.balance)
            .map(a => ({ name: a.name, value: a.balance, color: colorFor(a.name) }));

        // squarified 트리맵: 면적 = 금액 비례
        const W = container.clientWidth || 600;
        const H = 300;
        const rects = this.squarify(items, W, H);

        container.innerHTML = rects.map(r => {
            const minSide = Math.min(r.w, r.h);
            const showName = r.w > 44 && r.h > 24;
            const showValue = r.w > 70 && r.h > 44;
            const nameSize = Math.max(10, Math.min(15, minSide / 5.5));
            const valSize = Math.max(9, Math.min(13, minSide / 7));
            return `<div class="treemap-item" style="left:${r.x.toFixed(1)}px;top:${r.y.toFixed(1)}px;width:${r.w.toFixed(1)}px;height:${r.h.toFixed(1)}px;background:${r.color};">
                ${showName ? `<span class="treemap-name" style="font-size:${nameSize.toFixed(1)}px">${r.name}</span>` : ''}
                ${showValue ? `<span class="treemap-value" style="font-size:${valSize.toFixed(1)}px">${this.fmtKorean(r.value)}</span>` : ''}
                <span class="treemap-tooltip">${r.name}: ${r.value.toLocaleString('ko-KR')}원</span>
            </div>`;
        }).join('');
        container.style.height = H + 'px';
    },

    // squarified treemap 알고리즘 (Bruls et al.) — 정사각형에 가까운 분할
    squarify(items, W, H) {
        const total = items.reduce((s, i) => s + i.value, 0);
        const scale = (W * H) / total;
        const data = items.map(it => ({ ...it, area: it.value * scale }));
        const result = [];
        let x = 0, y = 0, w = W, h = H;
        let row = [];

        const worst = (row, length) => {
            const sum = row.reduce((s, r) => s + r.area, 0);
            const max = Math.max(...row.map(r => r.area));
            const min = Math.min(...row.map(r => r.area));
            return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
        };

        const layoutRow = (row) => {
            const sum = row.reduce((s, r) => s + r.area, 0);
            if (w >= h) {
                // 세로 막대로 배치 (왼쪽부터)
                const rw = sum / h;
                let ry = y;
                for (const r of row) {
                    const rh = r.area / rw;
                    result.push({ ...r, x, y: ry, w: rw, h: rh });
                    ry += rh;
                }
                x += rw; w -= rw;
            } else {
                // 가로 막대로 배치 (위부터)
                const rh = sum / w;
                let rx = x;
                for (const r of row) {
                    const rw = r.area / rh;
                    result.push({ ...r, x: rx, y, w: rw, h: rh });
                    rx += rw;
                }
                y += rh; h -= rh;
            }
        };

        for (let i = 0; i < data.length; i++) {
            const length = Math.min(w, h);
            if (row.length === 0 || worst([...row, data[i]], length) <= worst(row, length)) {
                row.push(data[i]);
            } else {
                layoutRow(row);
                row = [data[i]];
            }
        }
        if (row.length) layoutRow(row);
        return result;
    },

    buildDetailCompare(actual, budget, type) {
        if (!actual || actual.length === 0) {
            return '<div class="detail-item"><span>-</span><span>-</span></div>';
        }

        const budgetMap = {};
        if (budget) budget.forEach(b => { budgetMap[b.name] = b.amount; });

        return actual.map(i => {
            const target = budgetMap[i.name];
            let colorClass = 'amount-same';
            let diffText = '';

            if (target !== undefined && target > 0) {
                const diff = i.amount - target;
                if (diff > 0) { colorClass = 'amount-over'; diffText = `<span class="diff">(+${this.fmtShort(diff)})</span>`; }
                else if (diff < 0) { colorClass = 'amount-under'; diffText = `<span class="diff">(${this.fmtShort(diff)})</span>`; }
            }

            return `<div class="detail-item"><span>${i.name}</span><span class="${colorClass}">${this.fmt(i.amount)}${diffText}</span></div>`;
        }).join('');
    },

    renderTrendChart() {
        const months = Object.keys(allData).sort();
        const incomes = months.map(m => this.sum(allData[m].income));
        const expenses = months.map(m => {
            const d = allData[m];
            return this.sum(d.variable) + this.sum(d.fixed) + this.sum(d.allowance) + this.sum(d.subscription);
        });
        const savings = months.map(m => this.sum(allData[m].saving));

        const ctx = document.getElementById('trend-chart').getContext('2d');
        if (trendChart) trendChart.destroy();
        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    { label: '수입', data: incomes, borderColor: '#6C63FF', backgroundColor: 'rgba(108,99,255,0.08)', fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#6C63FF' },
                    { label: '지출', data: expenses, borderColor: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.08)', fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#FF6B6B' },
                    { label: '저축', data: savings, borderColor: '#51CF66', backgroundColor: 'rgba(81,207,102,0.08)', fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#51CF66' },
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 12, family: 'Noto Sans KR' } } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${parseInt(ctx.raw).toLocaleString()}원` } }
                },
                scales: {
                    y: { ticks: { callback: (v) => (v / 10000).toFixed(0) + '만' } }
                }
            }
        });
    },

    renderAssetTrendChart() {
        const trend = this.assetTrend || {};
        const months = Object.keys(trend).sort();
        if (months.length === 0) return;

        const values = months.map(m => trend[m]);

        const ctx = document.getElementById('asset-trend-chart');
        if (!ctx) return;

        if (this.assetChart) this.assetChart.destroy();
        this.assetChart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: '총 자산',
                    data: values,
                    borderColor: '#6C63FF',
                    backgroundColor: 'rgba(108, 99, 255, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 3,
                    pointBackgroundColor: '#6C63FF',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `총 자산: ${parseInt(ctx.raw).toLocaleString()}원`
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (v) => {
                                if (v >= 100000000) return (v / 100000000).toFixed(1) + '억';
                                return (v / 10000).toFixed(0) + '만';
                            }
                        }
                    }
                }
            }
        });
    },

    // 구글 시트에서 데이터 로드
    async fetchFromSheet() {
        const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;

        // 시트 탭 이름 목록 가져오기 (월별 탭들)
        // 우선 고정 탭 로드: 통장잔고, 대출
        // 목표 지출/수입 시트 로드 (있으면)
        // 설정 탭 로드 (대출/목표/계좌 분류 — 없으면 해당 섹션 숨김)
        this.settings = {};
        try {
            const settingsCsv = await fetch(`${base}&sheet=${encodeURIComponent('설정')}`).then(r => r.text());
            this.settings = this.parseSettingsCsv(settingsCsv);
        } catch (e) { /* 설정 탭 없으면 무시 */ }

        // 목표 탭 로드 — 탭이 존재하면 무조건 로드
        this.budgetData = null;
        try {
            const budgetCsv = await fetch(`${base}&sheet=${encodeURIComponent('목표')}`).then(r => r.text());
            if (budgetCsv && budgetCsv.length > 50) {
                const parsed = this.parseMonthCsv(budgetCsv);
                // 데이터가 있으면 목표로 사용
                if (parsed.income.length > 0 || parsed.variable.length > 0) {
                    this.budgetData = parsed;
                }
            }
        } catch (e) { /* 목표 탭 없으면 무시 */ }

        const [assetCsv, loanCsv] = await Promise.all([
            fetch(`${base}&sheet=${encodeURIComponent('자산 현황')}`).then(r => r.text()),
            fetch(`${base}&sheet=${encodeURIComponent('대출')}`).then(r => r.text()),
        ]);

        const assetData = this.parseAssetCsv(assetCsv); // { '2026-06': [{name, balance}], ... }
        const loanPaid = this.parseLoanCsv(loanCsv);

        // 자산 현황 시트의 월 헤더에서 데이터가 있는 달 파악
        const assetMonths = Object.keys(assetData);

        // 시트 탭 존재 확인: 자산 현황에 월 데이터가 있는 달 + 현재 달만 시도
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthCandidates = [...new Set([...assetMonths, thisMonth])].filter(m => m >= '2026-06').sort();

        allData = {};

        // 각 월별 탭 로드 (순차적으로 — 첫 번째 탭 중복 감지)
        let firstTabHash = null;
        for (const month of monthCandidates) {
            try {
                const csv = await fetch(`${base}&sheet=${encodeURIComponent(month)}`).then(r => r.text());
                if (!csv || csv.length < 50) continue;

                // 첫 번째 성공한 탭의 해시 저장
                const hash = csv.substring(0, 200);
                if (firstTabHash === null) {
                    firstTabHash = hash;
                } else if (hash === firstTabHash) {
                    // 탭이 없어서 첫 번째 탭이 반환된 것 → 스킵
                    continue;
                }

                const parsed = this.parseMonthCsv(csv);
                const hasData = parsed.income.length > 0 || parsed.variable.length > 0 || parsed.fixed.length > 0;
                if (!hasData) continue;

                parsed.accounts = assetData[month] || assetData[Object.keys(assetData).pop()] || [];
                parsed.loanPaid = loanPaid;
                allData[month] = parsed;
            } catch (e) { /* 탭 없으면 무시 */ }
        }

        // 자산 추이 데이터 저장 (모든 월별 통장 합산)
        this.assetTrend = {};
        for (const [month, accounts] of Object.entries(assetData)) {
            this.assetTrend[month] = accounts.reduce((sum, a) => sum + a.balance, 0);
        }

        if (Object.keys(allData).length === 0) throw new Error('No data');
    },

    parseCSVRows(csv) {
        const rows = [];
        const lines = csv.split('\n');
        for (const line of lines) {
            const row = [];
            let inQuotes = false;
            let cell = '';
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') {
                    inQuotes = !inQuotes;
                } else if (c === ',' && !inQuotes) {
                    row.push(cell.trim());
                    cell = '';
                } else {
                    cell += c;
                }
            }
            row.push(cell.trim());
            rows.push(row);
        }
        return rows;
    },

    parseMonthCsv(csv) {
        const rows = this.parseCSVRows(csv);
        const data = { income: [], variable: [], fixed: [], allowance: [], subscription: [], saving: [] };
        const categoryMap = {
            '수입': 'income',
            '변동지출': 'variable',
            '고정지출': 'fixed',
            '용돈': 'allowance',
            '구독료': 'subscription',
            '저축': 'saving',
        };

        for (let i = 1; i < rows.length; i++) {
            const [cat, name, amountStr] = rows[i];
            if (!cat || !name) continue;
            const amount = parseInt(String(amountStr).replace(/[",\s]/g, '')) || 0;
            const key = categoryMap[cat];
            if (key) {
                data[key].push({ name, amount });
            }
        }
        return data;
    },

    parseAssetCsv(csv) {
        const rows = this.parseCSVRows(csv);
        if (rows.length < 2) return {};
        const header = rows[0]; // ['통장명', '2026-06', '2026-07', ...]
        const months = header.slice(1).filter(h => h && h.match(/\d{4}-\d{2}/));
        const result = {};

        months.forEach((month, mi) => {
            result[month] = [];
            for (let i = 1; i < rows.length; i++) {
                const name = rows[i][0];
                if (!name) continue;
                const balStr = rows[i][mi + 1] || '0';
                const balance = parseInt(String(balStr).replace(/[",\s]/g, '')) || 0;
                result[month].push({ name, balance });
            }
        });

        return result;
    },

    parseSettingsCsv(csv) {
        const rows = this.parseCSVRows(csv);
        const map = {};
        for (let i = 1; i < rows.length; i++) {
            const [key, val] = rows[i];
            if (key) map[key] = val || '';
        }
        return map;
    },

    parseLoanCsv(csv) {
        const rows = this.parseCSVRows(csv);
        for (let i = 1; i < rows.length; i++) {
            const [item, valStr] = rows[i];
            if (item && item.includes('상환')) {
                return parseInt(String(valStr).replace(/[",\s]/g, '')) || 0;
            }
        }
        return 0;
    },

    openSheet() {
        if (sheetId) {
            window.open(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, '_blank');
        } else {
            alert('비밀번호 잠금을 먼저 해제해주세요.');
        }
    },

    // 유틸
    sum(arr) {
        return (arr || []).reduce((s, i) => s + (i.amount || 0), 0);
    },

    fmt(n) {
        return Math.round(n).toLocaleString('ko-KR') + '원';
    },

    fmtShort(n) {
        const abs = Math.abs(n);
        if (abs >= 10000) return (n / 10000).toFixed(0) + '만';
        return n.toLocaleString();
    },

    fmtKorean(n) {
        if (n >= 100000000) {
            const eok = n / 100000000;
            return (eok % 1 === 0 ? eok : eok.toFixed(1)) + '억';
        }
        if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
        return n.toLocaleString('ko-KR') + '원';
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
