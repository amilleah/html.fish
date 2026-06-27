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
const shownMilestones = new Set(JSON.parse(localStorage.getItem('shownMilestones') || '[]'));
let allTagKeys = [];
let codeEl = null;
let panelEl = null;
let codeSectionEl = null;
let dotEl = null;
let panelOpen = false;

const GOLD_CHANCE = 0.05;
const bossTags = new Set(); // tags flagged with a trailing ":boss" in tags.html

export function getWeightedFish(creaturesData) {
    bossTags.clear();
    const lines = creaturesData.trim().split('\n');
    const weightedPool = [];
    lines.forEach(line => {
        const [str, weight, flag] = line.split(':');
        const s = (str || '').trim();
        const w = parseInt(weight);
        if (!s || isNaN(w)) return;
        if (flag && flag.trim() === 'boss') {
            const tag = getTag(s);
            if (tag) bossTags.add(tag);
        }
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

window.clearInventory = () => {
    Object.keys(caught).forEach(k => delete caught[k]);
    shownMilestones.clear();
    saveCaught();
    localStorage.removeItem('shownMilestones');
    renderInventory();
};

function setUnviewed(val) {
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

// Net upgrade tiers. Side length traces an S-curve (slow, then fast, then slow)
// from 150 px at unlock to unlimited at 1500 caught. Each tier shows a one-time
// unlock message via checkNetUpgrades().
const NET_TIERS = [
    { key: 'net',  at: 50,   size: 150,      name: 'NET',           desc: 'click + drag to catch multiple fish' },
    { key: 'net2', at: 300,  size: 380,      name: 'CAST NET',      desc: 'a wider throw' },
    { key: 'net3', at: 600,  size: 650,      name: 'TRAWL NET',     desc: 'sweep the shallows' },
    { key: 'net4', at: 950,  size: 1000,     name: 'SEINE NET',     desc: 'haul in whole schools' },
    { key: 'net5', at: 1250, size: 1300,     name: 'DRAGNET',       desc: 'almost nothing escapes' },
    { key: 'net6', at: 1500, size: Infinity, name: 'BOUNDLESS NET', desc: 'the whole pond is yours' },
];
const NET_UNLOCK = NET_TIERS[0].at; // fish caught to unlock the net
// Net recharge scales with the size of the net you cast along an exponential
// curve from NET_COOLDOWN_MIN (tiny casts) up to NET_COOLDOWN_MAX (a cast at
// NET_COOLDOWN_REF_SIZE px or larger). Exponential keeps small/medium nets
// cheap and only makes the biggest casts expensive.
const NET_COOLDOWN_MIN = 50;        // ms recharge for tiny casts
const NET_COOLDOWN_MAX = 5000;      // ms recharge for the largest casts
const NET_COOLDOWN_REF_SIZE = 1300; // cast size (px) that reaches the max recharge

// Current max net (drag-box) side length in px for how many fish you've caught.
function netMaxSize() {
    const c = totalCaught();
    let size = 0;
    for (const t of NET_TIERS) if (c >= t.at) size = t.size;
    return size;
}

// Clamped square net rectangle from a drag start to a current point.
function netRect(start, ex, ey) {
    const max = netMaxSize();
    const dx = ex - start.x, dy = ey - start.y;
    const w = Math.min(Math.abs(dx), max);
    const h = Math.min(Math.abs(dy), max);
    return {
        left: dx >= 0 ? start.x : start.x - w,
        top: dy >= 0 ? start.y : start.y - h,
        width: w,
        height: h,
    };
}

// Recharge time (ms) for a cast: its size (geometric mean of width and height)
// mapped exponentially onto [NET_COOLDOWN_MIN, NET_COOLDOWN_MAX].
function netCooldownFor(w, h) {
    const size = Math.sqrt(Math.max(0, w) * Math.max(0, h));
    const t = Math.min(1, size / NET_COOLDOWN_REF_SIZE);
    return NET_COOLDOWN_MIN * Math.pow(NET_COOLDOWN_MAX / NET_COOLDOWN_MIN, t);
}

function showNetMessage(tier) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:100;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(0,10,2,0.92);color:white;font-family:monospace;font-size:20px;line-height:2;padding:48px 56px;border:1px solid #1a2a1a;text-align:center;backdrop-filter:blur(8px);';
    const heading = tier.key === 'net' ? "you've unlocked:" : 'net upgraded:';
    const sizeLabel = tier.size === Infinity ? 'unlimited reach' : `${tier.size}×${tier.size} px`;
    box.innerHTML = `${heading}<br><br><span style="font-size:32px">${tier.name}!</span><br><br><span style="color:#555;font-size:15px">${tier.desc}<br>${sizeLabel}</span>`;
    const btn = document.createElement('button');
    btn.textContent = 'ok!';
    btn.style.cssText = 'margin-top:32px;background:transparent;color:#5a9a5a;font-family:monospace;font-size:18px;letter-spacing:1px;padding:10px 28px;border:1px solid #1a2a1a;cursor:pointer;';
    btn.addEventListener('mouseenter', () => { btn.style.color = '#8fc98f'; btn.style.borderColor = '#2a4a2a'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#5a9a5a'; btn.style.borderColor = '#1a2a1a'; });
    btn.addEventListener('click', () => overlay.remove());
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    btn.focus();
}

// Show a one-time message for the highest net tier newly reached.
function checkNetUpgrades() {
    const c = totalCaught();
    let highestNew = -1;
    for (let i = 0; i < NET_TIERS.length; i++) {
        if (c < NET_TIERS[i].at) break;
        if (!shownMilestones.has(NET_TIERS[i].key)) {
            highestNew = i;
            saveMilestone(NET_TIERS[i].key);
        }
    }
    if (highestNew >= 0) showNetMessage(NET_TIERS[highestNew]);
}

function catchFish(fishStr, el) {
    el.remove();
    const key = tagKey(fishStr);
    const firstEver = !caught[key];
    if (!caught[key]) caught[key] = { open: 0, close: 0 };
    const wasComplete = isComplete(key);
    const isFirst = isClosing(fishStr) ? caught[key].close === 0 : caught[key].open === 0;
    if (isClosing(fishStr)) caught[key].close++;
    else caught[key].open++;
    saveCaught();

    notifyCatch(fishStr, key, firstEver, wasComplete, isComplete(key));
    checkMilestones();
    checkNetUpgrades();
    if (isFirst) setUnviewed(true);
    renderInventory();
}

// A single hit: bosses lose 1 HP per hit and are only caught at 0; normal fish
// are caught on the first hit. Used by both click and net.
function hitFish(fishStr, el, viaNet = false) {
    if (el.dataset.boss !== '1') {
        catchFish(fishStr, el);
        return;
    }
    const max = parseFloat(el.dataset.maxhp);
    const dmg = viaNet ? parseFloat(el.dataset.netdmg) : 1; // net effect diminishes per boss
    const hp = parseFloat(el.dataset.hp) - dmg;
    el.dataset.hp = String(hp);
    if (hp <= 0) {
        catchFish(fishStr, el);
        return;
    }
    const fill = el.querySelector('[data-hpfill]');
    if (fill) fill.style.width = Math.max(0, (hp / max) * 100) + '%';
    el.style.opacity = '0.55';
    setTimeout(() => { if (el.isConnected) el.style.opacity = '1'; }, 90);
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

    // once a tag's golden form is captured, the gold entry stands in for the
    // white one — drop the white row to save space in caught.html
    const goldTags = new Set(
        Object.keys(caught).filter(k => k.startsWith('¤')).map(k => k.slice(1))
    );

    const entries = Object.entries(caught).filter(([key]) =>
        key.startsWith('¤') || !goldTags.has(key)
    ).sort((a, b) => {
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
        'user-select:none',
        '-webkit-user-select:none',
    ].join(';');

    const titleBar = document.createElement('div');
    titleBar.textContent = 'inventory';
    titleBar.style.cssText = 'color:#4a7a4a;letter-spacing:2px;padding:14px 16px 10px;border-bottom:1px solid #1a2a1a;flex-shrink:0;';

    codeEl = document.createElement('div');
    codeEl.style.cssText = 'padding:12px 12px 32px;';

    codeSectionEl = makeCollapsibleSection('caught.html', codeEl, 'codeCollapsed');
    codeSectionEl.style.cssText += ';flex:1;overflow-y:auto;min-height:0;';

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
        'user-select:none',
        '-webkit-user-select:none',
        `width:${(display.length + TAIL.length) * CHAR_W}px`,
        `height:${CHAR_H}px`,
    ].join(';');
    applyTagStyle(el, fishStr);
    el.addEventListener('click', () => hitFish(fishStr, el));
    container.appendChild(el);
    return el;
}

// A boss is a large red fish with a health bar. `fontSize` sets its size;
// `netDmg` is how much one net hit removes (clicks always remove 1).
function makeBossEl(fishStr, container, hp, fontSize, netDmg) {
    const display = displayStr(fishStr);
    const scale = fontSize / 26; // 26px is the normal fish size
    const el = document.createElement('div');
    el.dataset.fish = fishStr;
    el.dataset.boss = '1';
    el.dataset.hp = String(hp);
    el.dataset.maxhp = String(hp);
    el.dataset.netdmg = String(netDmg);
    el.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'color:#ff3b3b',
        'font-family:monospace',
        `font-size:${fontSize}px`,
        'font-weight:bold',
        'white-space:pre',
        'cursor:pointer',
        'user-select:none',
        '-webkit-user-select:none',
        'text-shadow:0 0 14px rgba(255,40,40,0.55)',
        `width:${(display.length + TAIL.length) * CHAR_W * scale}px`,
        `height:${CHAR_H * scale}px`,
    ].join(';');

    const label = document.createElement('span');
    label.textContent = TAIL + display;
    el.appendChild(label);

    const barH = Math.round(5 + scale * 2);
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:0;top:${-(barH + 8)}px;width:100%;height:${barH}px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,60,60,0.6);`;
    const fill = document.createElement('div');
    fill.dataset.hpfill = '1';
    fill.style.cssText = 'height:100%;width:100%;background:#ff3b3b;transition:width 0.12s ease;';
    bar.appendChild(fill);
    el.appendChild(bar);

    el.addEventListener('click', () => hitFish(fishStr, el));
    container.appendChild(el);
    return el;
}

function showBossBanner() {
    const banner = document.createElement('div');
    banner.textContent = '⚠ boss! ⚠';
    banner.style.cssText = 'position:fixed;top:8%;left:50%;transform:translateX(-50%);color:#ff3b3b;font-family:monospace;font-size:28px;letter-spacing:4px;text-shadow:0 0 16px rgba(255,40,40,0.7);z-index:90;pointer-events:none;transition:opacity 1s ease;';
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; }, 1800);
    setTimeout(() => banner.remove(), 2900);
}

let noticeContainer = null;
// Small toast in the bottom-left; stacks and auto-dismisses.
function showNotice(html, color) {
    if (!noticeContainer) {
        noticeContainer = document.createElement('div');
        noticeContainer.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:80;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(noticeContainer);
    }
    while (noticeContainer.children.length >= 6) noticeContainer.firstChild.remove();

    const note = document.createElement('div');
    note.innerHTML = html;
    note.style.cssText = `background:rgba(0,10,2,0.9);color:${color};font-family:monospace;font-size:15px;padding:10px 16px;border:1px solid #1a2a1a;border-left:3px solid ${color};backdrop-filter:blur(6px);white-space:pre;opacity:0;transform:translateY(8px);transition:opacity 0.25s ease,transform 0.25s ease;`;
    noticeContainer.appendChild(note);
    requestAnimationFrame(() => { note.style.opacity = '1'; note.style.transform = 'translateY(0)'; });
    setTimeout(() => { note.style.opacity = '0'; note.style.transform = 'translateY(8px)'; }, 3200);
    setTimeout(() => note.remove(), 3600);
}

// Announce a first-ever catch of a tag/colour, or a freshly completed pair.
function notifyCatch(fishStr, key, firstEver, wasComplete, nowComplete) {
    const golden = key.startsWith('¤');
    const tag = key.replace('¤', '');
    const color = golden ? '#ffd700' : '#9ad29a';
    const mark = golden ? '✦ ' : '';
    const esc = s => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (nowComplete && !wasComplete) {
        const pair = VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}></${tag}>`;
        showNotice(`${mark}${esc(pair)} complete!`, color);
    } else if (firstEver) {
        showNotice(`${mark}new fish: ${esc(displayStr(fishStr))}`, color);
    }
}

const BOSS_HUNT_SPEED = 175;  // px/s while actively chasing prey
const BOSS_DRIFT_SPEED = 70;  // px/s while full and just cruising
const BOSS_HUNT_RADIUS = 750; // px within which a hungry boss spots prey
const BOSS_HEAL_PER_FISH = 1; // hp regained per fish swallowed

// A boss runs its own movement loop: while hurt it chases the nearest fish and
// eats any within reach (healing per fish, up to full); while full it just
// drifts and wraps. Self-stops once the boss is caught (removed from the DOM).
function runBoss(boss, container, startX) {
    let x = startX;
    let y = window.innerHeight * (0.15 + Math.random() * 0.65);
    const bobOff = Math.random() * Math.PI * 2;
    let last = null;
    boss.style.transform = `translate(${x}px,${y}px)`;

    function frame(ts) {
        if (!boss.isConnected) return;
        if (last === null) last = ts;
        const dt = Math.min(0.05, (ts - last) / 1000);
        last = ts;

        const bw = boss.offsetWidth, bh = boss.offsetHeight;
        const cx = x + bw / 2, cy = y + bh / 2;
        const max = parseFloat(boss.dataset.maxhp);
        let hp = parseFloat(boss.dataset.hp);
        const hungry = hp < max;
        const eatDist = Math.min(170, bh * 0.8 + 30);

        let prey = null, best = BOSS_HUNT_RADIUS, preyX = 0, preyY = 0;
        const eaten = [];
        if (hungry) {
            container.querySelectorAll('[data-fish]').forEach(f => {
                if (f === boss || f.dataset.boss === '1') return;
                const fr = f.getBoundingClientRect();
                const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
                const d = Math.hypot(fx - cx, fy - cy);
                if (d < best) { best = d; prey = f; preyX = fx; preyY = fy; }
                if (d <= eatDist) eaten.push(f);
            });
        }

        if (eaten.length) {
            for (const f of eaten) {
                if (hp >= max) break;
                f.remove(); // consumed, not caught — the player misses out
                hp = Math.min(max, hp + BOSS_HEAL_PER_FISH);
            }
            boss.dataset.hp = String(hp);
            const fill = boss.querySelector('[data-hpfill]');
            if (fill) fill.style.width = (hp / max) * 100 + '%';
            boss.style.textShadow = '0 0 22px rgba(120,255,120,0.85)'; // heal glow
            setTimeout(() => { if (boss.isConnected) boss.style.textShadow = '0 0 14px rgba(255,40,40,0.55)'; }, 160);
        }

        if (prey) {
            const dx = preyX - cx, dy = preyY - cy;
            const dist = Math.hypot(dx, dy) || 1;
            const step = BOSS_HUNT_SPEED * dt;
            x += (dx / dist) * step;
            y += (dy / dist) * step;
        } else {
            x += BOSS_DRIFT_SPEED * dt;
            if (x > window.innerWidth + 280) x = -280;
            y += Math.sin(ts * 0.0008 + bobOff) * 14 * dt;
        }
        y = Math.max(-bh * 0.5, Math.min(window.innerHeight - bh * 0.5, y));

        boss.style.transform = `translate(${x}px,${y}px)`;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function makeAnchor(startX) {
    return {
        x: startX,
        baseY: window.innerHeight * 0.1 + Math.random() * window.innerHeight * 0.75,
        speed: Math.random() * 200 + 180,
        waveAmp: Math.random() * 14 + 4,
        waveFreq: Math.random() * 0.4 + 0.3,
        waveOffset: Math.random() * Math.PI * 2,
    };
}

function advanceAnchor(anchor, dt) {
    anchor.x += anchor.speed * dt;
    if (anchor.x > window.innerWidth + 300) anchor.x = -300;
}

function animateFish(el, anchorRef, offsetX, offsetY) {
    (anchorRef.els || (anchorRef.els = [])).push(el);
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

// Once you've caught MAX_PER_TYPE of a particular fish (a tag in a given
// colour), it stops spawning so the pond keeps offering variety.
const MAX_PER_TYPE = 50;

function isFishMaxed(fishStr) {
    const c = caught[tagKey(fishStr)];
    return !!c && (c.open + c.close) >= MAX_PER_TYPE;
}

// Random pick from a (weighted) pool that skips maxed-out fish; null if every
// entry is maxed.
function pickFish(pool) {
    for (let i = 0; i < 20; i++) {
        const f = pool[Math.floor(Math.random() * pool.length)];
        if (!isFishMaxed(f)) return f;
    }
    const avail = pool.filter(f => !isFishMaxed(f));
    return avail.length ? avail[Math.floor(Math.random() * avail.length)] : null;
}

function spawnListGroup(leaderStr, liPool, container, anchors, startX) {
    const isOrdered = getTag(leaderStr) === 'ol';
    const count = Math.floor(Math.random() * 4) + 2;
    const anchor = makeAnchor(startX);
    anchors.push(anchor);

    const leaderEl = makeFishEl(leaderStr, container);
    animateFish(leaderEl, anchor, 0, 0);

    const leaderW = displayStr(leaderStr).length * CHAR_W;

    for (let i = 0; i < count; i++) {
        const liStr = pickFish(liPool);
        if (!liStr) continue;
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

function spawnSchool(normalPool, container, anchors, startX) {
    const fishStr = pickFish(normalPool);
    if (!fishStr) return;
    const display = displayStr(fishStr);
    const fishW = (display.length + TAIL.length) * CHAR_W;
    const schoolSize = Math.floor(Math.random() * 8) + 6;
    const blobW = fishW * 2.5 + 40;
    const blobH = CHAR_H * 3 + 20;
    const anchor = makeAnchor(startX);
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

function spawnSolo(normalPool, container, anchors, startX) {
    const fishStr = pickFish(normalPool);
    if (!fishStr) return;
    const anchor = makeAnchor(startX);
    anchors.push(anchor);
    const el = makeFishEl(fishStr, container);
    animateFish(el, anchor, 0, 0);
}

// The net's effect on a boss follows the reciprocal series (1, 1/2, 1/3, …),
// so it matters less every boss. Bosses get incrementally larger, and their HP
// is proportional to the length of their tag string.
let bossesSpawned = 0;
const BOSS_FONT_BASE = 54;
const BOSS_FONT_STEP = 10;
const BOSS_FONT_MAX = 140;
const BOSS_HP_PER_CHAR = 2; // hp per character of the tag string

function spawnBoss(pool, container, anchors, startX) {
    const n = ++bossesSpawned;
    let fishStr = pickFish(pool) || pool[Math.floor(Math.random() * pool.length)];
    if (isGolden(fishStr)) fishStr = displayStr(fishStr); // bosses render red, not gold
    const hp = Math.max(1, Math.round(displayStr(fishStr).length * BOSS_HP_PER_CHAR)); // longer tag = tankier
    const fontSize = Math.min(BOSS_FONT_BASE + (n - 1) * BOSS_FONT_STEP, BOSS_FONT_MAX);
    const netDmg = 1 / n; // reciprocal series
    const el = makeBossEl(fishStr, container, hp, fontSize, netDmg);
    runBoss(el, container, startX);
}

// Spawn x positions: scattered across the screen (initial fill) vs. off-screen
// left so wave fish swim in (they all drift rightward and wrap around).
function scatterX() { return Math.random() * (window.innerWidth + 600) - 600; }
function offscreenX() { return -(Math.random() * 400 + 200); }

export function spawnSchools(fishPool, container, schoolCount = 6, soloCount = 5, listGroupCount = 4) {
    createInventory();

    const uniqueKeys = new Set(fishPool.map(f => {
        const tag = getTag(f);
        return tag ? (isGolden(f) ? `¤${tag}` : tag) : null;
    }).filter(Boolean));
    allTagKeys = [...uniqueKeys].filter(k => {
        const tag = k.replace('¤', '');
        return !['ol', 'ul', 'li'].includes(tag);
    });

    let lastTime = null;
    const anchors = [];

    const liPool = fishPool.filter(f => getTag(f) === 'li');
    const listLeaders = fishPool.filter(f => getTag(f) === 'ol' || getTag(f) === 'ul');
    const normalPool = fishPool.filter(f => getTag(f) !== 'li' && getTag(f) !== 'ol' && getTag(f) !== 'ul');

    const hasLists = listLeaders.length && liPool.length;

    // bosses are drawn only from tags flagged ":boss" (fall back to any if none)
    const bossCandidates = normalPool.filter(f => bossTags.has(getTag(f)));
    const bossPool = bossCandidates.length ? bossCandidates : normalPool;

    for (let s = 0; s < schoolCount; s++) spawnSchool(normalPool, container, anchors, scatterX());
    for (let s = 0; s < soloCount; s++) spawnSolo(normalPool, container, anchors, scatterX());
    if (hasLists) {
        for (let s = 0; s < listGroupCount; s++) {
            const leaderStr = pickFish(listLeaders);
            if (leaderStr) spawnListGroup(leaderStr, liPool, container, anchors, scatterX());
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

    // Keep the pond replenished so fishing never requires a page refresh: every
    // couple seconds, top the population back up with fresh fish entering
    // off-screen.
    const TARGET_FISH = 80;

    // Boss escalation is tied to how many fish you catch: every FISH_PER_WAVE
    // caught counts as one "wave" and raises the boss chance by BOSS_CHANCE_STEP.
    // When a boss finally appears the odds reset to zero. Larger FISH_PER_WAVE
    // and/or smaller step => rarer bosses.
    const FISH_PER_WAVE = 100;
    const BOSS_CHANCE_STEP = 0.3;
    let bossChance = 0;
    let lastWaveCount = totalCaught();

    function liveFishCount() {
        return container.querySelectorAll('[data-fish]').length;
    }
    function spawnWave() {
        // drop anchors whose fish have all been caught (keeps tick() bounded)
        for (let i = anchors.length - 1; i >= 0; i--) {
            const a = anchors[i];
            if (a.els && !a.els.some(el => el.isConnected)) anchors.splice(i, 1);
        }
        // top the population back up from off-screen
        let guard = 0;
        while (liveFishCount() < TARGET_FISH && guard++ < 12) {
            const roll = Math.random();
            if (roll < 0.65) {
                spawnSchool(normalPool, container, anchors, offscreenX());
            } else if (roll < 0.9 || !hasLists) {
                spawnSolo(normalPool, container, anchors, offscreenX());
            } else {
                const leaderStr = pickFish(listLeaders);
                if (leaderStr) spawnListGroup(leaderStr, liPool, container, anchors, offscreenX());
            }
        }
        // each completed wave of caught fish escalates (and may trigger) a boss
        while (totalCaught() - lastWaveCount >= FISH_PER_WAVE) {
            lastWaveCount += FISH_PER_WAVE;
            if (Math.random() < bossChance) {
                spawnBoss(bossPool, container, anchors, offscreenX());
                showBossBanner();
                bossChance = 0;
            } else {
                bossChance += BOSS_CHANCE_STEP;
            }
        }
    }
    setInterval(spawnWave, 2000);

    const sel = document.createElement('div');
    sel.style.cssText = 'position:fixed;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);pointer-events:none;display:none;z-index:5;';
    document.body.appendChild(sel);

    // net cooldown: after each cast the net must recharge before it can be cast
    // again. A small bar at the bottom fills back up as it recharges.
    const cdBar = document.createElement('div');
    cdBar.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:160px;height:6px;background:rgba(255,255,255,0.1);border:1px solid #1a2a1a;z-index:6;display:none;pointer-events:none;';
    const cdFill = document.createElement('div');
    cdFill.style.cssText = 'height:100%;width:0%;background:#5a9a5a;';
    cdBar.appendChild(cdFill);
    document.body.appendChild(cdBar);

    let netReadyAt = 0;
    const netReady = () => Date.now() >= netReadyAt;
    function startNetCooldown(duration) {
        netReadyAt = Date.now() + duration;
        cdBar.style.display = 'block';
        (function tickCd() {
            const remaining = netReadyAt - Date.now();
            if (remaining <= 0) { cdBar.style.display = 'none'; return; }
            cdFill.style.width = (1 - remaining / duration) * 100 + '%';
            requestAnimationFrame(tickCd);
        })();
    }

    let dragStart = null;

    document.addEventListener('mousedown', e => {
        if (totalCaught() < NET_UNLOCK) return;
        if (e.target.closest('[data-fish]') || e.target.closest('#inventory-panel')) return;
        if (!netReady()) return; // still recharging
        dragStart = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mousemove', e => {
        if (!dragStart) return;
        if (Math.abs(e.clientX - dragStart.x) < 4 && Math.abs(e.clientY - dragStart.y) < 4) return;
        const r = netRect(dragStart, e.clientX, e.clientY);
        sel.style.display = 'block';
        sel.style.left = r.left + 'px';
        sel.style.top = r.top + 'px';
        sel.style.width = r.width + 'px';
        sel.style.height = r.height + 'px';
    });

    document.addEventListener('mouseup', e => {
        if (!dragStart) return;
        const start = dragStart;
        dragStart = null;
        sel.style.display = 'none';
        const r = netRect(start, e.clientX, e.clientY);
        if (r.width < 4 || r.height < 4) return;
        const x1 = r.left, x2 = r.left + r.width;
        const y1 = r.top, y2 = r.top + r.height;
        document.querySelectorAll('[data-fish]').forEach(fish => {
            const fr = fish.getBoundingClientRect();
            if (fr.left < x2 && fr.right > x1 && fr.top < y2 && fr.bottom > y1) {
                hitFish(fish.dataset.fish, fish, true);
            }
        });
        startNetCooldown(netCooldownFor(r.width, r.height));
    });
}
