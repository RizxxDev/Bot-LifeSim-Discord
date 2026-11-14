const crypto = require('crypto');
const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getCity } = require('../data/cities');
const { getJob, getRankForShifts } = require('../data/jobs');
const { isNewbieBoostActive } = require('./economyService');
const {
    normalizeEquippedOutfit,
    buildOutfitSignature,
    getHighestEquippedRarity,
    generateAvatarBuffer
} = require('./avatarService');
const { formatLp } = require('../utils/uiBuilder');

const BANNER_WIDTH = 800;
const BANNER_HEIGHT = 280;
const MAX_BANNER_CACHE = 120;
const FONT_FAMILY = '"Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif';

const BANNER_CACHE = new Map();

const CITY_THEMES = {
    kota_barat: {
        id: 'kota_barat',
        gradTop: '#0A192F',
        gradBottom: '#112D4E',
        accent: '#0EA5E9',
        accentSoft: 'rgba(14, 165, 233, 0.18)',
        accentStroke: 'rgba(14, 165, 233, 0.35)',
        cardFill: 'rgba(9, 25, 48, 0.78)',
        cardStroke: 'rgba(56, 189, 248, 0.25)',
        containerColor: 0x0EA5E9,
        motif: 'waves'
    },
    kota_sentral: {
        id: 'kota_sentral',
        gradTop: '#0F1028',
        gradBottom: '#1E1B4B',
        accent: '#6366F1',
        accentSoft: 'rgba(99, 102, 241, 0.20)',
        accentStroke: 'rgba(129, 140, 248, 0.38)',
        cardFill: 'rgba(17, 17, 46, 0.80)',
        cardStroke: 'rgba(129, 140, 248, 0.26)',
        containerColor: 0x6366F1,
        motif: 'skyline'
    },
    kota_timur: {
        id: 'kota_timur',
        gradTop: '#071F18',
        gradBottom: '#0E382B',
        accent: '#10B981',
        accentSoft: 'rgba(16, 185, 129, 0.18)',
        accentStroke: 'rgba(52, 211, 153, 0.36)',
        cardFill: 'rgba(8, 33, 25, 0.78)',
        cardStroke: 'rgba(52, 211, 153, 0.25)',
        containerColor: 0x10B981,
        motif: 'hills'
    }
};

const RARITY_STYLES = {
    common: {
        label: 'COMMON',
        bg: 'rgba(148, 163, 184, 0.16)',
        border: 'rgba(148, 163, 184, 0.55)',
        text: '#E2E8F0'
    },
    uncommon: {
        label: 'UNCOMMON',
        bg: 'rgba(16, 185, 129, 0.18)',
        border: 'rgba(52, 211, 153, 0.65)',
        text: '#6EE7B7'
    },
    rare: {
        label: 'RARE',
        bg: 'rgba(59, 130, 246, 0.20)',
        border: 'rgba(96, 165, 250, 0.72)',
        text: '#93C5FD'
    },
    epic: {
        label: 'EPIC',
        bg: 'rgba(168, 85, 247, 0.22)',
        border: 'rgba(192, 132, 252, 0.78)',
        text: '#D8B4FE'
    },
    legendary: {
        label: 'LEGENDARY',
        bg: 'rgba(245, 158, 11, 0.22)',
        border: 'rgba(251, 191, 36, 0.85)',
        text: '#FDE68A'
    }
};

function getCityTheme(cityId) {
    const city = getCity(cityId);
    return CITY_THEMES[city.id] || CITY_THEMES.kota_sentral;
}

/**
 * Menghapus karakter emoji Unicode agar aman dirender oleh font sistem Canvas tanpa kotak pecah.
 */
function stripEmojiForCanvas(rawText) {
    return String(rawText || '')
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\uFE0E\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function clampVital(val) {
    const num = Number(val || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
}

function resolvePrimaryStatusChip(player, now = Date.now()) {
    if (Number(player.hospital_until || 0) > now) {
        return { label: 'DIRAWAT RS', bg: 'rgba(239, 68, 68, 0.22)', border: '#EF4444', text: '#FCA5A5' };
    }
    if (Number(player.traveling_until || 0) > now) {
        return { label: 'PERJALANAN', bg: 'rgba(56, 189, 248, 0.22)', border: '#38BDF8', text: '#BAE6FD' };
    }
    if (Number(player.sleeping_until || 0) > now) {
        return { label: 'TIDUR', bg: 'rgba(167, 139, 250, 0.22)', border: '#A78BFA', text: '#DDD6FE' };
    }
    if (isNewbieBoostActive(player, now)) {
        return { label: 'NEWBIE BOOST', bg: 'rgba(34, 197, 94, 0.20)', border: '#22C55E', text: '#86EFAC' };
    }
    return null;
}

function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    const str = String(text || '');
    if (ctx.measureText(str).width <= maxWidth) return str;
    const ellipsis = '...';
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = str.slice(0, mid) + ellipsis;
        if (ctx.measureText(candidate).width <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return str.slice(0, lo) + ellipsis;
}

function drawWavesMotif(ctx, theme) {
    ctx.save();
    const layers = [
        { y: 195, amp: 14, freq: 0.012, phase: 0.4, alpha: 0.12 },
        { y: 225, amp: 16, freq: 0.015, phase: 1.8, alpha: 0.16 },
        { y: 252, amp: 12, freq: 0.018, phase: 3.1, alpha: 0.22 }
    ];

    for (const layer of layers) {
        ctx.beginPath();
        ctx.moveTo(0, BANNER_HEIGHT);
        for (let x = 0; x <= BANNER_WIDTH; x += 16) {
            const y = layer.y + Math.sin(x * layer.freq + layer.phase) * layer.amp;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(BANNER_WIDTH, BANNER_HEIGHT);
        ctx.closePath();
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = layer.alpha;
        ctx.fill();
    }
    ctx.restore();
}

function drawSkylineMotif(ctx, theme) {
    ctx.save();
    const buildings = [
        { x: 245, w: 34, h: 68 },
        { x: 284, w: 28, h: 98 },
        { x: 318, w: 42, h: 122 },
        { x: 365, w: 26, h: 82 },
        { x: 396, w: 48, h: 144 },
        { x: 450, w: 30, h: 94 },
        { x: 486, w: 40, h: 118 },
        { x: 532, w: 28, h: 76 },
        { x: 566, w: 52, h: 152 },
        { x: 624, w: 34, h: 106 },
        { x: 664, w: 44, h: 132 },
        { x: 714, w: 32, h: 88 },
        { x: 752, w: 48, h: 116 }
    ];

    for (const b of buildings) {
        const y = BANNER_HEIGHT - b.h;
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.11;
        ctx.fillRect(b.x, y, b.w, b.h);

        ctx.globalAlpha = 0.16;
        for (let wy = y + 10; wy < BANNER_HEIGHT - 16; wy += 16) {
            for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 11) {
                if ((wx + wy) % 3 !== 0) {
                    ctx.fillRect(wx, wy, 4, 6);
                }
            }
        }
    }
    ctx.restore();
}

function drawHillsMotif(ctx, theme) {
    ctx.save();
    ctx.fillStyle = theme.accent;

    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.moveTo(0, BANNER_HEIGHT);
    ctx.lineTo(0, 224);
    ctx.bezierCurveTo(180, 170, 320, 250, 500, 198);
    ctx.bezierCurveTo(640, 158, 730, 188, BANNER_WIDTH, 165);
    ctx.lineTo(BANNER_WIDTH, BANNER_HEIGHT);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.moveTo(0, BANNER_HEIGHT);
    ctx.lineTo(0, 246);
    ctx.bezierCurveTo(210, 212, 360, 266, 560, 224);
    ctx.bezierCurveTo(680, 200, 745, 232, BANNER_WIDTH, 212);
    ctx.lineTo(BANNER_WIDTH, BANNER_HEIGHT);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function drawBackdrop(ctx, theme) {
    const bgGrad = ctx.createLinearGradient(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
    bgGrad.addColorStop(0, theme.gradTop);
    bgGrad.addColorStop(1, theme.gradBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);

    // Soft top-right radial highlight matching city accent
    const rad = ctx.createRadialGradient(690, 40, 20, 690, 40, 320);
    rad.addColorStop(0, theme.accentSoft);
    rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);

    if (theme.motif === 'waves') drawWavesMotif(ctx, theme);
    else if (theme.motif === 'skyline') drawSkylineMotif(ctx, theme);
    else drawHillsMotif(ctx, theme);

    // Subtle top accent bar & outer edge border
    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, 0, BANNER_WIDTH, 4);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, BANNER_WIDTH - 2, BANNER_HEIGHT - 2);
}

function drawPill(ctx, { x, y, text, bg, border, textColor, height = 24, padX = 10, fontSize = 11 }) {
    ctx.save();
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    const textW = ctx.measureText(text).width;
    const width = Math.ceil(textW + padX * 2);

    roundRectPath(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = border;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
    ctx.restore();
    return width;
}

function drawInfoCard(ctx, { x, y, w, h, label, value, subValue, theme, valueColor = '#F8FAFC', valueFontSize = 16 }) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 12);
    ctx.fillStyle = theme.cardFill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.cardStroke;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 10px ${FONT_FAMILY}`;
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(label, x + 14, y + 11);

    ctx.font = `700 ${valueFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = valueColor;
    ctx.fillText(fitText(ctx, value, w - 28), x + 14, y + 27);

    if (subValue) {
        ctx.font = `500 11px ${FONT_FAMILY}`;
        ctx.fillStyle = '#CBD5E1';
        ctx.fillText(fitText(ctx, subValue, w - 28), x + 14, y + 50);
    }
    ctx.restore();
}

function drawVitalBarCell(ctx, { x, y, w, h, code, value, color, theme }) {
    const safeVal = clampVital(value);
    ctx.save();

    roundRectPath(ctx, x, y, w, h, 10);
    ctx.fillStyle = theme.cardFill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.stroke();

    // Colored dot indicator + code label
    ctx.beginPath();
    ctx.arc(x + 15, y + 14, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 11px ${FONT_FAMILY}`;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(code, x + 25, y + 14);

    // Numeric value right-aligned
    ctx.textAlign = 'right';
    ctx.font = `700 11px ${FONT_FAMILY}`;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`${safeVal}/100`, x + w - 12, y + 14);

    // Progress bar track
    const trackX = x + 12;
    const trackY = y + 25;
    const trackW = w - 24;
    const trackH = 8;

    roundRectPath(ctx, trackX, trackY, trackW, trackH, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fill();

    if (safeVal > 0) {
        const fillW = Math.max(8, Math.round((safeVal / 100) * trackW));
        roundRectPath(ctx, trackX, trackY, fillW, trackH, 4);
        ctx.fillStyle = color;
        ctx.fill();
    }

    ctx.restore();
}

function buildBannerCacheKey({
    player,
    jobShifts = 0,
    normOutfit,
    now = Date.now()
}) {
    const city = getCity(player.current_city);
    const cleanUsername = stripEmojiForCanvas(player.username) || String(player.username || 'Warga');
    const cleanTitle = stripEmojiForCanvas(player.equipped_title);
    const streak = Math.max(0, Number(player.daily_streak) || 0);
    const statusChip = resolvePrimaryStatusChip(player, now);
    const totalWealth = Math.round(Number(player.cash || 0) + Number(player.bank || 0));

    let jobName = 'Pengangguran';
    let rankName = '';
    if (player.current_job) {
        const job = getJob(player.current_job);
        const rank = getRankForShifts(jobShifts);
        jobName = stripEmojiForCanvas(job?.name || player.current_job) || String(player.current_job);
        rankName = stripEmojiForCanvas(rank?.name || '') || '';
    }

    const hp = clampVital(player.health);
    const en = clampVital(player.energy);
    const hg = clampVital(player.hunger);
    const th = clampVital(player.thirst);
    const outfitSig = buildOutfitSignature(normOutfit);

    const signature = [
        city.id,
        cleanUsername,
        cleanTitle,
        streak,
        statusChip ? statusChip.label : 'NORMAL',
        jobName,
        rankName,
        totalWealth,
        hp,
        en,
        hg,
        th,
        outfitSig
    ].join('|');

    return {
        signature,
        city,
        cleanUsername,
        cleanTitle,
        streak,
        statusChip,
        jobName,
        rankName,
        totalWealth,
        hp,
        en,
        hg,
        th
    };
}

function normalizeBannerInput(inputData, now = Date.now()) {
    if (inputData && inputData.player && inputData.normOutfit) {
        return {
            player: inputData.player,
            jobShifts: Number(inputData.jobShifts || 0),
            normOutfit: inputData.normOutfit,
            now
        };
    }

    const isEnvelope = Boolean(inputData && inputData.player);
    const player = isEnvelope ? inputData.player : (inputData || {});
    const jobShifts = isEnvelope ? Number(inputData.jobShifts || 0) : Number(inputData?.jobShifts || 0);
    const rawOutfit = isEnvelope ? (inputData.wardrobe?.equipped ?? inputData.equipped) : inputData?.equipped;

    const normOutfit = (rawOutfit && rawOutfit.body !== undefined)
        ? normalizeEquippedOutfit({
            equipped_body: rawOutfit.body,
            equipped_hair: rawOutfit.hair,
            equipped_hat: rawOutfit.hat,
            equipped_top: rawOutfit.top,
            equipped_bottom: rawOutfit.bottom,
            equipped_shoes: rawOutfit.shoes,
            equipped_accessory: rawOutfit.accessory
        })
        : normalizeEquippedOutfit(rawOutfit || null);

    return {
        player,
        jobShifts,
        normOutfit,
        now
    };
}

function clearProfileBannerCache() {
    BANNER_CACHE.clear();
}

/**
 * Merender gambar PNG banner profil 800x280 px dengan tema kota dinamis dan cache LRU.
 */
async function generateProfileBannerBuffer(dataOrPlayer, now = Date.now()) {
    const normalized = normalizeBannerInput(dataOrPlayer, now);
    const meta = buildBannerCacheKey(normalized);

    if (BANNER_CACHE.has(meta.signature)) {
        const cached = BANNER_CACHE.get(meta.signature);
        BANNER_CACHE.delete(meta.signature);
        BANNER_CACHE.set(meta.signature, cached);
        return cached;
    }

    const theme = getCityTheme(meta.city.id);
    const highestRarity = getHighestEquippedRarity(normalized.normOutfit);
    const rarityStyle = RARITY_STYLES[highestRarity] || RARITY_STYLES.common;

    const canvas = createCanvas(BANNER_WIDTH, BANNER_HEIGHT);
    const ctx = canvas.getContext('2d');

    drawBackdrop(ctx, theme);

    // 1. Left Zone: Avatar Chibi (204x204 rounded) + Rarity Pill
    const avatarSize = 204;
    const avatarX = 24;
    const avatarY = 20;
    const avatarBuf = await generateAvatarBuffer(normalized.normOutfit);
    const avatarImg = await loadImage(avatarBuf);

    ctx.save();
    roundRectPath(ctx, avatarX, avatarY, avatarSize, avatarSize, 22);
    ctx.clip();
    // Pangkas margin pad=6 bawaan avatarService (256x256 -> 242x242) agar pas edge-to-edge di bingkai 204x204
    ctx.drawImage(avatarImg, 7, 7, 242, 242, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, avatarX, avatarY, avatarSize, avatarSize, 22);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rarityStyle.border;
    ctx.stroke();
    ctx.restore();

    // Pill rarity outfit di bawah portrait
    const pillY = 234;
    const pillH = 26;
    ctx.save();
    roundRectPath(ctx, avatarX, pillY, avatarSize, pillH, 13);
    ctx.fillStyle = rarityStyle.bg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rarityStyle.border;
    ctx.stroke();

    ctx.font = `700 11px ${FONT_FAMILY}`;
    ctx.fillStyle = rarityStyle.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`OUTFIT: ${rarityStyle.label}`, avatarX + avatarSize / 2, pillY + pillH / 2 + 0.5);
    ctx.restore();

    // 2. Right Zone Header (x = 252 .. 776)
    const rightX = 252;
    const rightMaxX = 776;
    const rightW = rightMaxX - rightX;

    // Right-aligned pills: City Badge & optional conditional Status Chip
    const cityLabel = stripEmojiForCanvas(meta.city.shortName || meta.city.name) || 'Metropolis Sentral';
    ctx.save();
    ctx.font = `700 11px ${FONT_FAMILY}`;
    const cityPillW = Math.ceil(ctx.measureText(cityLabel).width + 20);
    const cityPillX = rightMaxX - cityPillW;
    drawPill(ctx, {
        x: cityPillX,
        y: 22,
        text: cityLabel,
        bg: theme.accentSoft,
        border: theme.accentStroke,
        textColor: '#F8FAFC',
        height: 24,
        padX: 10,
        fontSize: 11
    });

    let pillsLeftEdge = cityPillX;
    if (meta.statusChip) {
        const chipW = Math.ceil(ctx.measureText(meta.statusChip.label).width + 20);
        const chipX = cityPillX - chipW - 8;
        drawPill(ctx, {
            x: chipX,
            y: 22,
            text: meta.statusChip.label,
            bg: meta.statusChip.bg,
            border: meta.statusChip.border,
            textColor: meta.statusChip.text,
            height: 24,
            padX: 10,
            fontSize: 11
        });
        pillsLeftEdge = chipX;
    }

    // Username (left-aligned, truncated cleanly before pills)
    const maxNameW = Math.max(120, pillsLeftEdge - rightX - 16);
    ctx.font = `700 24px ${FONT_FAMILY}`;
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fitText(ctx, meta.cleanUsername, maxNameW), rightX, 18);

    // Sub-line: Equipped Title (stripped emoji) + Streak Xh
    const subParts = [];
    if (meta.cleanTitle) subParts.push(meta.cleanTitle);
    subParts.push(`Streak ${meta.streak}h`);
    ctx.font = `600 13px ${FONT_FAMILY}`;
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(fitText(ctx, subParts.join('  •  '), rightW), rightX, 50);
    ctx.restore();

    // 3. 2 Info Cards (y = 82 .. 154)
    const cardGap = 12;
    const cardW = (rightW - cardGap) / 2; // 256 px
    const cardY = 80;
    const cardH = 72;

    drawInfoCard(ctx, {
        x: rightX,
        y: cardY,
        w: cardW,
        h: cardH,
        label: 'PEKERJAAN SAAT INI',
        value: meta.jobName,
        subValue: meta.rankName ? `Jabatan: ${meta.rankName}` : 'Belum bekerja (/job)',
        theme,
        valueColor: '#F8FAFC',
        valueFontSize: 15
    });

    drawInfoCard(ctx, {
        x: rightX + cardW + cardGap,
        y: cardY,
        w: cardW,
        h: cardH,
        label: 'TOTAL KEKAYAAN',
        value: stripEmojiForCanvas(formatLp(meta.totalWealth)),
        subValue: 'Gabungan Cash & Bank',
        theme,
        valueColor: '#FDE68A',
        valueFontSize: 17
    });

    // 4. Grid 2x2 Vitals Progress Bars (y = 164 .. 260)
    const barRowGap = 10;
    const barW = cardW;
    const barH = 43;
    const barY1 = 164;
    const barY2 = barY1 + barH + barRowGap;

    drawVitalBarCell(ctx, {
        x: rightX,
        y: barY1,
        w: barW,
        h: barH,
        code: 'HP',
        value: meta.hp,
        color: '#EF4444',
        theme
    });
    drawVitalBarCell(ctx, {
        x: rightX + barW + cardGap,
        y: barY1,
        w: barW,
        h: barH,
        code: 'EN',
        value: meta.en,
        color: '#F59E0B',
        theme
    });
    drawVitalBarCell(ctx, {
        x: rightX,
        y: barY2,
        w: barW,
        h: barH,
        code: 'HG',
        value: meta.hg,
        color: '#FB923C',
        theme
    });
    drawVitalBarCell(ctx, {
        x: rightX + barW + cardGap,
        y: barY2,
        w: barW,
        h: barH,
        code: 'TH',
        value: meta.th,
        color: '#38BDF8',
        theme
    });

    const buffer = canvas.toBuffer('image/png');
    if (BANNER_CACHE.size >= MAX_BANNER_CACHE) {
        const oldestKey = BANNER_CACHE.keys().next().value;
        BANNER_CACHE.delete(oldestKey);
    }
    BANNER_CACHE.set(meta.signature, buffer);
    return buffer;
}

/**
 * Menghasilkan AttachmentBuilder + URL 'attachment://profile_<hash>.png' untuk Discord Components V2.
 */
async function buildProfileBannerAttachment(dataOrPlayer, now = Date.now()) {
    const normalized = normalizeBannerInput(dataOrPlayer, now);
    const meta = buildBannerCacheKey(normalized);
    const shortHash = crypto.createHash('md5').update(meta.signature).digest('hex').slice(0, 12);
    const fileName = `profile_${shortHash}.png`;
    const buffer = await generateProfileBannerBuffer(normalized, now);
    const attachment = new AttachmentBuilder(buffer, {
        name: fileName,
        description: `Banner Profil ${meta.cleanUsername}`
    });

    return {
        buffer,
        fileName,
        url: `attachment://${fileName}`,
        attachment,
        cityTheme: getCityTheme(meta.city.id)
    };
}

module.exports = {
    BANNER_WIDTH,
    BANNER_HEIGHT,
    MAX_BANNER_CACHE,
    CITY_THEMES,
    getCityTheme,
    stripEmojiForCanvas,
    clearProfileBannerCache,
    generateProfileBannerBuffer,
    buildProfileBannerAttachment
};
