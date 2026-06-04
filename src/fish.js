const CHAR_W = 15;
const CHAR_H = 32;
const TAIL = '>';

const VOID_TAGS = new Set(['area','base','br','col','embed','frame','hr','img','input','link','meta','param','source','track','wbr']);

function loadCaught() {
    try {
        const raw = JSON.parse(localStorage.getItem('caught') || '{}');
        const first = Object.values(raw)[0];
        if (first !== undefined && typeof first !== 'object') return {};
        return raw;
    } catch { return {}; }
}

const caught = loadCaught();
const discoveredSecrets = JSON.parse(localStorage.getItem('discoveredSecrets') || '[]');
const shownMilestones = new Set(JSON.parse(localStorage.getItem('shownMilestones') || '[]'));
let allTagKeys = [];
let codeEl = null;
let secretsEl = null;
let panelEl = null;
let codeSectionEl = null;
let dotEl = null;
let hasUnviewed = false;
let panelOpen = false;
const secrets = {};

async function loadSecrets() {
    const res = await fetch('src/secrets.html');
    const text = await res.text();
    let currentTag = null;
    text.trim().split('\n').forEach(line => {
        line = line.trim();
        if (!line) return;
        if (line.match(/^<\/?[\w]+>$/)) {
            currentTag = line;
            if (!secrets[currentTag]) secrets[currentTag] = [];
        } else if (currentTag) {
            const isUrl = line.startsWith('http');
            const isArena = line.includes('are.na/block/');
            const type = isArena ? 'image' : isUrl ? 'link' : 'text';
            secrets[currentTag].push({ type, value: line });
        }
    });
    renderSecrets();
}

const GOLD_CHANCE = 0.05;

export function getWeightedFish(creaturesData) {
    const lines = creaturesData.trim().split('\n');
    const weightedPool = [];
    lines.forEach(line => {
        const [str, weight] = line.split(':');
        const s = str.trim();
        const w = parseInt(weight);
        const h = new Date().getHours();
        const isLateNight = h >= 23 || h <= 3;
        const effectiveW = isLateNight && w <= 12 ? Math.round(w * 5) : w;
        for (let i = 0; i < effectiveW; i++) weightedPool.push(s);
        const goldW = Math.max(1, Math.round(effectiveW * GOLD_CHANCE));
        for (let i = 0; i < goldW; i++) weightedPool.push('¤' + s);
    });
    return weightedPool;
}

function saveCaught() {
    localStorage.setItem('caught', JSON.stringify(caught));
}

function completeKeys(keys) {
    for (const key of keys) {
        const tag = key.replace('¤', '');
        if (!caught[key]) caught[key] = { open: 0, close: 0 };
        if (caught[key].open === 0) caught[key].open = 1;
        if (!VOID_TAGS.has(tag) && caught[key].close === 0) caught[key].close = 1;
    }
    saveCaught();
    checkMilestones();
    renderInventory();
}


window.clearInventory = () => {
    Object.keys(caught).forEach(k => delete caught[k]);
    discoveredSecrets.length = 0;
    shownMilestones.clear();
    saveCaught();
    localStorage.removeItem('discoveredSecrets');
    localStorage.removeItem('shownMilestones');
    renderInventory();
    renderSecrets();
};

function setUnviewed(val) {
    hasUnviewed = val;
    if (dotEl) dotEl.style.display = (val && !panelOpen) ? 'block' : 'none';
}

function isGolden(fishStr) {
    return fishStr.startsWith('¤');
}

function displayStr(fishStr) {
    return isGolden(fishStr) ? fishStr.slice(1) : fishStr;
}

function getTag(fishStr) {
    const m = fishStr.match(/<\/?(\w+)>/);
    return m ? m[1] : null;
}

function isClosing(fishStr) {
    return displayStr(fishStr).includes('</');
}

function oppositeForm(fishStr) {
    const tag = getTag(fishStr);
    if (!tag || VOID_TAGS.has(tag)) return fishStr;
    const prefix = isGolden(fishStr) ? '¤' : '';
    return isClosing(fishStr) ? `${prefix}<${tag}>` : `${prefix}</${tag}>`;
}

function tagKey(fishStr) {
    const tag = getTag(fishStr);
    return isGolden(fishStr) ? `¤${tag}` : tag;
}

function isComplete(key) {
    const c = caught[key];
    if (!c) return false;
    const tag = key.replace('¤', '');
    return c.open > 0 && (VOID_TAGS.has(tag) || c.close > 0);
}

function saveMilestone(name) {
    shownMilestones.add(name);
    localStorage.setItem('shownMilestones', JSON.stringify([...shownMilestones]));
    setUnviewed(true);
}

function checkSecretsMilestone() {
    if (!Object.keys(secrets).length) return;
    const discoveredTags = new Set(discoveredSecrets.map(s => s.tag));
    const allFound = [...Object.keys(secrets)].every(t => discoveredTags.has(t));
    if (allFound && !shownMilestones.has('secrets')) { saveMilestone('secrets'); renderSecrets(); }
}

function checkMilestones() {
    if (!allTagKeys.length) return;
    const whiteKeys = allTagKeys.filter(k => !k.startsWith('¤'));
    const goldKeys = allTagKeys.filter(k => k.startsWith('¤'));
    const whiteComplete = whiteKeys.every(isComplete);
    const goldComplete = goldKeys.every(isComplete);
    if (whiteComplete && !shownMilestones.has('white')) { saveMilestone('white'); renderInventory(); }
    if (goldComplete && goldKeys.length && !shownMilestones.has('gold')) { saveMilestone('gold'); renderInventory(); }
    if (whiteComplete && goldComplete && !shownMilestones.has('complete')) { saveMilestone('complete'); renderInventory(); }
}

function totalCaught() {
    return Object.values(caught).reduce((s, c) => s + c.open + c.close, 0);
}

function showNetUnlock() {
    if (shownMilestones.has('net')) return;
    saveMilestone('net');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:100;cursor:pointer;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(0,10,2,0.92);color:white;font-family:monospace;font-size:20px;line-height:2;padding:48px 56px;border:1px solid #1a2a1a;text-align:center;backdrop-filter:blur(8px);';
    box.innerHTML = `you've unlocked:<br><br><span style="font-size:32px">NET!</span><br><br><span style="color:#555;font-size:15px">click + drag to catch multiple fish</span>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => overlay.remove());
}

function catchFish(fishStr, el) {
    el.remove();
    const key = tagKey(fishStr);
    if (!caught[key]) caught[key] = { open: 0, close: 0 };
    const isFirst = isClosing(fishStr) ? caught[key].close === 0 : caught[key].open === 0;
    if (isClosing(fishStr)) caught[key].close++;
    else caught[key].open++;
    saveCaught();

    let secretFound = false;
    const tagStr = `<${key.replace('¤', '')}>`;
    const pool = secrets[tagStr];
    if (pool && pool.length > 0 && Math.random() < 0.05) {
        const foundValues = new Set(discoveredSecrets.map(s => s.value));
        const remaining = pool.filter(s => !foundValues.has(s.value));
        if (remaining.length > 0) {
            const picked = remaining[Math.floor(Math.random() * remaining.length)];
            discoveredSecrets.push({ tag: tagStr, type: picked.type, value: picked.value });
            localStorage.setItem('discoveredSecrets', JSON.stringify(discoveredSecrets));
            secretFound = true;
        }
    }

    checkMilestones();
    checkSecretsMilestone();
    if (totalCaught() >= 50) showNetUnlock();
    if (isFirst || secretFound) setUnviewed(true);
    renderInventory();
    renderSecrets();
}

function applyTagStyle(el, fishStr) {
    const tag = getTag(fishStr);
    if (tag === 'b' || tag === 'strong') el.style.fontWeight = 'bold';
    if (tag === 'i' || tag === 'em') el.style.fontStyle = 'italic';
}

function makeLine(lineNum, indent, content, color, extra, bold, italic) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:baseline;min-height:22px';

    const num = document.createElement('span');
    num.textContent = String(lineNum).padStart(3, ' ');
    num.style.cssText = 'color:#444;user-select:none;margin-right:36px;flex-shrink:0';

    const code = document.createElement('span');
    code.textContent = '  '.repeat(indent) + content;
    code.style.color = color || 'white';
    if (bold) code.style.fontWeight = 'bold';
    if (italic) code.style.fontStyle = 'italic';

    row.appendChild(num);
    row.appendChild(code);

    if (extra) {
        const aside = document.createElement('span');
        aside.textContent = '  ' + extra;
        aside.style.color = '#555';
        row.appendChild(aside);
    }

    return row;
}

function renderInventory() {
    codeEl.innerHTML = '';

    const entries = Object.entries(caught).sort((a, b) => {
        const ag = a[0].startsWith('¤'), bg = b[0].startsWith('¤');
        if (ag !== bg) return ag ? -1 : 1;
        const aComplete = a[1].open > 0 && (VOID_TAGS.has(a[0].replace('¤','')) || a[1].close > 0);
        const bComplete = b[1].open > 0 && (VOID_TAGS.has(b[0].replace('¤','')) || b[1].close > 0);
        if (aComplete !== bComplete) return aComplete ? -1 : 1;
        return (b[1].open + b[1].close) - (a[1].open + a[1].close);
    });

    let n = 1;
    const dimColor = '#444';
    const needColor = '#555';

    if (shownMilestones.has('white') || shownMilestones.has('gold') || shownMilestones.has('complete')) {
        if (shownMilestones.has('complete')) {
            codeEl.appendChild(makeLine(n++, 0, '<!-- ✦ collection complete -->', '#ffd700'));
        } else {
            if (shownMilestones.has('white')) codeEl.appendChild(makeLine(n++, 0, '<!-- all elements discovered -->', '#5a9a5a'));
            if (shownMilestones.has('gold')) codeEl.appendChild(makeLine(n++, 0, '<!-- ✦ all golden elements discovered -->', '#ffd700'));
        }
        codeEl.appendChild(makeLine(n++, 0, '', dimColor));
    }

    codeEl.appendChild(makeLine(n++, 0, '<!DOCTYPE html>', dimColor));
    codeEl.appendChild(makeLine(n++, 0, '<html>', dimColor));
    codeEl.appendChild(makeLine(n++, 1, '<body>', dimColor));
    codeEl.appendChild(makeLine(n++, 0, '', dimColor));

    if (entries.length === 0) {
        codeEl.appendChild(makeLine(n++, 2, '<!-- nothing caught -->', dimColor));
    }

    for (const [key, counts] of entries) {
        const golden = key.startsWith('¤');
        const tag = key.replace('¤', '');
        const isVoid = VOID_TAGS.has(tag);
        const bold = tag === 'b' || tag === 'strong';
        const italic = tag === 'i' || tag === 'em';
        const baseColor = golden ? '#ffd700' : 'white';

        const openColor = counts.open > 0 ? baseColor : needColor;
        const openExtra = counts.open > 1 ? `×${counts.open}` : '';
        codeEl.appendChild(makeLine(n++, 2, `<${tag}>`, openColor, openExtra, bold, italic));

        if (!isVoid) {
            const closeColor = counts.close > 0 ? baseColor : needColor;
            const closeExtra = counts.close > 1 ? `×${counts.close}` : '';
            codeEl.appendChild(makeLine(n++, 2, `</${tag}>`, closeColor, closeExtra, bold, italic));
        }
    }

    codeEl.appendChild(makeLine(n++, 0, '', dimColor));
    codeEl.appendChild(makeLine(n++, 1, '</body>', dimColor));
    codeEl.appendChild(makeLine(n++, 0, '</html>', dimColor));
}

function makeCollapsibleSection(label, contentEl, storageKey, onToggle) {
    const collapsed = storageKey ? localStorage.getItem(storageKey) === '1' : false;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:14px 16px;border-top:1px solid #1a2a1a;user-select:none;';

    const arrow = document.createElement('span');
    arrow.style.cssText = 'color:#444;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'color:#4a7a4a;letter-spacing:2px;';

    header.appendChild(arrow);
    header.appendChild(lbl);

    contentEl.style.overflow = 'visible';

    function apply(c) {
        arrow.textContent = c ? '▶' : '▼';
        contentEl.style.display = c ? 'none' : 'block';
        if (storageKey) localStorage.setItem(storageKey, c ? '1' : '0');
        if (onToggle) onToggle(c);
    }

    apply(collapsed);
    header.addEventListener('click', () => apply(contentEl.style.display !== 'none'));

    const wrap = document.createElement('div');
    wrap.appendChild(header);
    wrap.appendChild(contentEl);
    return wrap;
}

function renderSecrets() {
    if (!secretsEl) return;
    secretsEl.innerHTML = '';

    if (shownMilestones.has('secrets')) {
        const badge = document.createElement('div');
        badge.textContent = '<!-- all secrets discovered -->';
        badge.style.cssText = 'color:#5a9a5a;padding:4px 16px 12px;';
        secretsEl.appendChild(badge);
    }

    if (discoveredSecrets.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '<!-- no secrets discovered -->';
        empty.style.cssText = 'color:#444;padding:4px 16px 24px;';
        secretsEl.appendChild(empty);
        return;
    }

    const seen = new Set();
    const deduped = discoveredSecrets.filter(s => seen.has(s.value) ? false : seen.add(s.value));

    const byTag = new Map();
    for (const secret of deduped) {
        if (!byTag.has(secret.tag)) byTag.set(secret.tag, []);
        byTag.get(secret.tag).push(secret);
    }

    const allImages = deduped.filter(s => s.type === 'image');
    if (allImages.length > 0) {
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:12px 16px 20px;';
        for (const secret of allImages) {
            const a = document.createElement('a');
            a.href = secret.value;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'display:block;aspect-ratio:1;overflow:hidden;opacity:0.85;';
            const img = document.createElement('img');
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            const arenaMatch = secret.value.match(/are\.na\/block\/(\d+)/);
            if (arenaMatch) {
                fetch(`https://api.are.na/v3/blocks/${arenaMatch[1]}`)
                    .then(r => r.json())
                    .then(block => { img.src = block.image?.square?.src || block.image?.medium?.src || block.image?.original?.src || ''; });
            } else {
                img.src = secret.value;
            }
            a.appendChild(img);
            grid.appendChild(a);
        }
        secretsEl.appendChild(grid);
    }

    for (const [tag, items] of byTag) {
        const nonImages = items.filter(s => s.type !== 'image');
        if (nonImages.length === 0) continue;

        const group = document.createElement('div');
        group.style.cssText = 'padding:4px 16px 16px;';

        const lbl = document.createElement('div');
        lbl.textContent = tag;
        lbl.style.cssText = 'color:#555;margin-bottom:8px;';
        group.appendChild(lbl);

        for (const secret of nonImages) {
            if (secret.type === 'text') {
                const p = document.createElement('div');
                p.textContent = secret.value;
                p.style.cssText = 'color:white;line-height:1.6;';
                group.appendChild(p);
            } else if (secret.type === 'link') {
                const a = document.createElement('a');
                a.href = secret.value;
                a.textContent = secret.value;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.style.cssText = 'display:block;color:#5a9a5a;word-break:break-all;margin-bottom:4px;';
                group.appendChild(a);
            }
        }

        secretsEl.appendChild(group);
    }
}

function createInventory() {
    const handle = document.createElement('div');
    handle.textContent = '▶';
    handle.style.cssText = [
        'position:fixed',
        'right:0',
        'top:0',
        'background:rgba(0,10,2,0.75)',
        'color:white',
        'font-family:monospace',
        'font-size:22px',
        'letter-spacing:1px',
        'padding:16px 24px',
        'cursor:pointer',
        'z-index:20',
        'user-select:none',
        'transition:right 0.3s ease',
        'border-bottom:1px solid #0f1f0f',
        'border-left:1px solid #0f1f0f',
    ].join(';');

    panelEl = document.createElement('div');
    panelEl.id = 'inventory-panel';
    panelEl.style.cssText = [
        'position:fixed',
        'top:0',
        `right:-${Math.round(window.innerWidth * 0.3)}px`,
        `width:${Math.round(window.innerWidth * 0.3)}px`,
        'height:100vh',
        'background:rgba(0,10,2,0.75)',
        'backdrop-filter:blur(12px)',
        'font-family:monospace',
        'font-size:22px',
        'z-index:15',
        'overflow:hidden',
        'transition:right 0.3s ease',
        'display:flex',
        'flex-direction:column',
    ].join(';');

    const titleBar = document.createElement('div');
    titleBar.textContent = 'inventory';
    titleBar.style.cssText = 'color:#4a7a4a;letter-spacing:2px;padding:14px 16px 10px;border-bottom:1px solid #1a2a1a;flex-shrink:0;';

    codeEl = document.createElement('div');
    codeEl.style.cssText = 'padding:12px 12px 32px;';

    codeSectionEl = makeCollapsibleSection('caught.html', codeEl, 'codeCollapsed');
    codeSectionEl.style.cssText += ';flex-shrink:0;max-height:45vh;overflow-y:auto;';

    secretsEl = document.createElement('div');
    const secretsSection = makeCollapsibleSection('secrets.html', secretsEl, 'secretsCollapsed');
    secretsSection.style.cssText += ';flex:1;overflow-y:auto;min-height:0;';

    const infoContentEl = document.createElement('div');
    infoContentEl.style.cssText = 'padding:0 0 16px;';
    const infoSection = makeCollapsibleSection('info.html', infoContentEl, null);
    infoSection.style.cssText += ';flex-shrink:0;';

    fetch('src/info.html').then(r => r.text()).then(text => {
        text.trim().split('\n').forEach(line => {
            const div = document.createElement('div');
            div.innerHTML = line;
            div.style.cssText = 'color:white;padding:4px 16px;line-height:1.6;';
            infoContentEl.appendChild(div);
        });
    });

    panelEl.appendChild(titleBar);
    panelEl.appendChild(codeSectionEl);
    panelEl.appendChild(secretsSection);
    panelEl.appendChild(infoSection);
    dotEl = document.createElement('span');
    dotEl.style.cssText = [
        'position:absolute',
        'top:8px',
        'right:8px',
        'width:7px',
        'height:7px',
        'background:#e05050',
        'border-radius:50%',
        'display:none',
    ].join(';');
    handle.appendChild(dotEl);

    document.body.appendChild(panelEl);
    document.body.appendChild(handle);

    panelOpen = localStorage.getItem('panelOpen') === '1';
    let open = panelOpen;

    function applyOpen() {
        const w = Math.round(window.innerWidth * 0.3);
        panelEl.style.right = open ? '0' : `-${w}px`;
        handle.style.right = open ? `${w}px` : '0';
        handle.textContent = open ? '◀' : '▶';
        handle.appendChild(dotEl);
        if (open) setUnviewed(false);
    }

    applyOpen();

    handle.addEventListener('click', () => {
        open = !open;
        panelOpen = open;
        localStorage.setItem('panelOpen', open ? '1' : '0');
        applyOpen();
    });

    renderInventory();
}

function makeFishEl(fishStr, container) {
    const display = displayStr(fishStr);
    const golden = isGolden(fishStr);
    const el = document.createElement('div');
    el.dataset.fish = fishStr;
    el.innerText = TAIL + display;
    el.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        `color:${golden ? '#ffd700' : 'white'}`,
        'font-family:monospace',
        'font-size:26px',
        'white-space:pre',
        'cursor:pointer',
        `width:${(display.length + TAIL.length) * CHAR_W}px`,
        `height:${CHAR_H}px`,
    ].join(';');
    applyTagStyle(el, fishStr);
    el.addEventListener('click', () => catchFish(fishStr, el));
    container.appendChild(el);
    return el;
}

function makeAnchor(startX) {
    return {
        x: startX,
        baseY: window.innerHeight * 0.1 + Math.random() * window.innerHeight * 0.75,
        speed: Math.random() * 100 + 80,
        waveAmp: Math.random() * 14 + 4,
        waveFreq: Math.random() * 0.4 + 0.3,
        waveOffset: Math.random() * Math.PI * 2,
    };
}

function advanceAnchor(anchor, dt) {
    anchor.x += anchor.speed * dt;
    if (anchor.x > window.innerWidth + 400) anchor.x = -400;
}

function animateFish(el, anchorRef, offsetX, offsetY) {
    const jitterAmp = Math.random() * 8 + 4;
    const jitterFreq = Math.random() * 1.5 + 1.0;
    const jitterOffset = Math.random() * Math.PI * 2;

    function frame(ts) {
        if (!el.isConnected) return;
        const jx = Math.sin(ts * 0.001 * jitterFreq * 1.3 + jitterOffset) * jitterAmp * 0.5;
        const jy = Math.sin(ts * 0.001 * jitterFreq + jitterOffset) * jitterAmp;
        const ax = anchorRef.x + offsetX + jx;
        const ay = anchorRef.baseY
            + Math.sin(ts * 0.001 * anchorRef.waveFreq + anchorRef.waveOffset) * anchorRef.waveAmp
            + offsetY + jy;
        el.style.transform = `translate(${ax}px,${ay}px)`;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function spawnListGroup(leaderStr, liPool, container, anchors) {
    const isOrdered = getTag(leaderStr) === 'ol';
    const count = Math.floor(Math.random() * 4) + 2;
    const anchor = makeAnchor(Math.random() * (window.innerWidth + 600) - 600);
    anchors.push(anchor);

    const leaderEl = makeFishEl(leaderStr, container);
    animateFish(leaderEl, anchor, 0, 0);

    const leaderW = displayStr(leaderStr).length * CHAR_W;

    for (let i = 0; i < count; i++) {
        const liStr = liPool[Math.floor(Math.random() * liPool.length)];
        const liW = displayStr(liStr).length * CHAR_W;
        let offsetX, offsetY;

        if (isOrdered) {
            offsetX = -(leaderW + liW + 20);
            offsetY = (i - (count - 1) / 2) * (CHAR_H + 6);
        } else {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random());
            offsetX = -Math.abs(Math.cos(angle) * r * (leaderW * 2 + 40)) - leaderW;
            offsetY = Math.sin(angle) * r * (CHAR_H * 2.5);
        }

        const el = makeFishEl(liStr, container);
        animateFish(el, anchor, offsetX, offsetY);
    }
}

export function spawnSchools(fishPool, container, schoolCount = 6, soloCount = 5, listGroupCount = 4) {
    createInventory();
    loadSecrets();

    const uniqueKeys = new Set(fishPool.map(f => {
        const tag = getTag(f);
        return tag ? (isGolden(f) ? `¤${tag}` : tag) : null;
    }).filter(Boolean));
    allTagKeys = [...uniqueKeys].filter(k => {
        const tag = k.replace('¤', '');
        return !['ol', 'ul', 'li'].includes(tag);
    });

    function completeSecrets() {
        for (const [tag, items] of Object.entries(secrets)) {
            const found = new Set(discoveredSecrets.filter(s => s.tag === tag).map(s => s.value));
            for (const item of items) {
                if (!found.has(item.value)) discoveredSecrets.push({ tag, type: item.type, value: item.value });
            }
        }
        localStorage.setItem('discoveredSecrets', JSON.stringify(discoveredSecrets));
        checkSecretsMilestone();
        renderSecrets();
    }

    let lastTime = null;
    const anchors = [];

    const liPool = fishPool.filter(f => getTag(f) === 'li');
    const listLeaders = fishPool.filter(f => getTag(f) === 'ol' || getTag(f) === 'ul');
    const normalPool = fishPool.filter(f => getTag(f) !== 'li' && getTag(f) !== 'ol' && getTag(f) !== 'ul');

    for (let s = 0; s < schoolCount; s++) {
        const fishStr = normalPool[Math.floor(Math.random() * normalPool.length)];
        const display = displayStr(fishStr);
        const fishW = (display.length + TAIL.length) * CHAR_W;
        const schoolSize = Math.floor(Math.random() * 8) + 6;
        const blobW = fishW * 2.5 + 40;
        const blobH = CHAR_H * 3 + 20;
        const anchor = makeAnchor(Math.random() * (window.innerWidth + 600) - 600);
        anchors.push(anchor);

        for (let i = 0; i < schoolSize; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random());
            const offsetX = -Math.abs(Math.cos(angle) * r * blobW);
            const offsetY = Math.sin(angle) * r * blobH;
            const f = Math.random() < 0.12 ? oppositeForm(fishStr) : fishStr;
            const el = makeFishEl(f, container);
            animateFish(el, anchor, offsetX, offsetY);
        }
    }

    for (let s = 0; s < soloCount; s++) {
        const fishStr = normalPool[Math.floor(Math.random() * normalPool.length)];
        const anchor = makeAnchor(Math.random() * (window.innerWidth + 600) - 600);
        anchors.push(anchor);
        const el = makeFishEl(fishStr, container);
        animateFish(el, anchor, 0, 0);
    }

    if (listLeaders.length && liPool.length) {
        for (let s = 0; s < listGroupCount; s++) {
            const leaderStr = listLeaders[Math.floor(Math.random() * listLeaders.length)];
            spawnListGroup(leaderStr, liPool, container, anchors);
        }
    }

    function tick(ts) {
        if (lastTime === null) lastTime = ts;
        const dt = (ts - lastTime) / 1000;
        lastTime = ts;
        for (const anchor of anchors) advanceAnchor(anchor, dt);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    const sel = document.createElement('div');
    sel.style.cssText = 'position:fixed;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);pointer-events:none;display:none;z-index:5;';
    document.body.appendChild(sel);

    let dragStart = null;

    document.addEventListener('mousedown', e => {
        if (totalCaught() < 50) return;
        if (e.target.closest('[data-fish]') || e.target.closest('#inventory-panel')) return;
        dragStart = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mousemove', e => {
        if (!dragStart) return;
        const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        sel.style.display = 'block';
        sel.style.left = Math.min(e.clientX, dragStart.x) + 'px';
        sel.style.top = Math.min(e.clientY, dragStart.y) + 'px';
        sel.style.width = Math.abs(dx) + 'px';
        sel.style.height = Math.abs(dy) + 'px';
    });

    document.addEventListener('mouseup', e => {
        if (!dragStart) return;
        const start = dragStart;
        dragStart = null;
        sel.style.display = 'none';
        const x1 = Math.min(e.clientX, start.x), x2 = Math.max(e.clientX, start.x);
        const y1 = Math.min(e.clientY, start.y), y2 = Math.max(e.clientY, start.y);
        if (x2 - x1 < 4 || y2 - y1 < 4) return;
        document.querySelectorAll('[data-fish]').forEach(fish => {
            const fr = fish.getBoundingClientRect();
            if (fr.left < x2 && fr.right > x1 && fr.top < y2 && fr.bottom > y1) {
                catchFish(fish.dataset.fish, fish);
            }
        });
    });
}
