const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { COLORS, formatLp, buildV2Card } = require('./uiBuilder');
const { makeId } = require('./panelId');

const MAX_V2_COMPONENTS = 40;
const MAX_ACTION_ROWS = 5;
const MAX_SELECT_OPTIONS = 25;
const MAX_DISPLAYABLE_TEXT_LENGTH = 4000;

/**
 * Merender header ringkas 2 baris (Mini-HUD) di bagian atas panel.
 */
function formatMiniHud(player) {
    if (!player) return null;
    const titlePart = player.equipped_title ? ` · 🏷️ *${player.equipped_title}*` : '';
    const line1 = `👤 **${player.username}**${titlePart} · 💵 **${formatLp(player.cash)}** · 🏦 **${formatLp(player.bank)}**`;
    const line2 = [
        `⚡ **${Math.round(Number(player.energy || 0))}**`,
        `🍔 **${Math.round(Number(player.hunger || 0))}**`,
        `💧 **${Math.round(Number(player.thirst || 0))}**`,
        `❤️ **${Math.round(Number(player.health || 0))}**`
    ].join(' · ');
    return `${line1}\n${line2}`;
}

/**
 * Merender banner umpan balik hasil aksi (sukses, peringatan, error, info) di bagian atas panel.
 */
function formatBanner(banner) {
    if (!banner) return null;
    if (typeof banner === 'string') {
        return `ℹ️ ${banner}`;
    }
    const iconMap = {
        success: '🟢',
        warning: '🟡',
        danger: '🔴',
        info: 'ℹ️'
    };
    const icon = iconMap[banner.type] || 'ℹ️';
    return `${icon} ${banner.text}`;
}

/**
 * Membuat ButtonBuilder dengan customId standar `modul:aksi:ownerId:waktu36[:arg]`.
 */
function btn(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        label = '',
        emoji = null,
        style = ButtonStyle.Secondary,
        arg = '',
        disabled = false
    } = opts;

    const b = new ButtonBuilder()
        .setCustomId(makeId(mod, action, ownerId, arg, now))
        .setStyle(style)
        .setDisabled(Boolean(disabled));

    if (label) b.setLabel(String(label).slice(0, 80));
    if (emoji) b.setEmoji(emoji);
    return b;
}

/**
 * Membuat ActionRow berisi StringSelectMenuBuilder dengan pemotongan otomatis maksimal 25 opsi.
 */
function select(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        placeholder = 'Pilih opsi...',
        options = [],
        arg = '',
        disabled = false
    } = opts;

    const sliced = options.slice(0, MAX_SELECT_OPTIONS).map(opt => {
        const clean = {
            label: String(opt.label || opt.value || 'Opsi').slice(0, 100),
            value: String(opt.value).slice(0, 100)
        };
        if (opt.description) clean.description = String(opt.description).slice(0, 100);
        if (opt.emoji) clean.emoji = opt.emoji;
        if (opt.default !== undefined) clean.default = Boolean(opt.default);
        return clean;
    });

    const menu = new StringSelectMenuBuilder()
        .setCustomId(makeId(mod, action, ownerId, arg, now))
        .setPlaceholder(String(placeholder).slice(0, 150))
        .setDisabled(Boolean(disabled) || sliced.length === 0)
        .addOptions(
            sliced.length > 0
                ? sliced
                : [{ label: 'Tidak ada opsi tersedia', value: '_empty_' }]
        );

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Membuat ActionRow berisi UserSelectMenuBuilder bawaan Discord.
 */
function userSelect(mod, action, ownerId, opts = {}, now = Date.now()) {
    const normalizedOpts = typeof opts === 'string' ? { placeholder: opts } : (opts || {});
    const {
        placeholder = '🔍 Pilih warga...',
        arg = '',
        disabled = false
    } = normalizedOpts;

    const menu = new UserSelectMenuBuilder()
        .setCustomId(makeId(mod, action, ownerId, arg, now))
        .setPlaceholder(String(placeholder).slice(0, 150))
        .setDisabled(Boolean(disabled));

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Membuat ActionRow tombol persentase (25%, 50%, Semua, ✏️ Nominal Lain, dan opsional ⬅️ Kembali).
 */
function percentRow(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        argPrefix = '',
        customAction = `${action}_modal`,
        backAction = null,
        backArg = '',
        disabled = false
    } = opts;

    const makeArg = (val) => (argPrefix ? `${argPrefix}:${val}` : String(val));

    const components = [
        btn(mod, action, ownerId, { label: '25%', style: ButtonStyle.Primary, arg: makeArg('25'), disabled }, now),
        btn(mod, action, ownerId, { label: '50%', style: ButtonStyle.Primary, arg: makeArg('50'), disabled }, now),
        btn(mod, action, ownerId, { label: 'Semua', style: ButtonStyle.Success, arg: makeArg('100'), disabled }, now),
        btn(mod, customAction, ownerId, { label: 'Nominal Lain', emoji: '✏️', style: ButtonStyle.Secondary, arg: argPrefix, disabled }, now)
    ];

    if (backAction) {
        components.push(
            btn(mod, backAction, ownerId, { label: 'Kembali', emoji: '⬅️', style: ButtonStyle.Secondary, arg: backArg }, now)
        );
    }

    return new ActionRowBuilder().addComponents(components);
}

/**
 * Membuat ActionRow tombol kuantitas cepat (×1, ×5, ×10, Maks, ✏️ Lain).
 */
function quantityRow(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        presets = [1, 5, 10],
        maxLabel = 'Maks',
        argPrefix = '',
        customAction = `${action}_modal`,
        disabled = false,
        disableMulti = false
    } = opts;

    const makeArg = (val) => (argPrefix ? `${argPrefix}:${val}` : String(val));
    const components = [];

    for (const p of presets.slice(0, 3)) {
        const isDisabled = disabled || (disableMulti && p > 1);
        components.push(
            btn(mod, action, ownerId, {
                label: `×${p}`,
                style: p === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary,
                arg: makeArg(String(p)),
                disabled: isDisabled
            }, now)
        );
    }

    if (maxLabel) {
        components.push(
            btn(mod, action, ownerId, {
                label: maxLabel,
                style: ButtonStyle.Success,
                arg: makeArg('max'),
                disabled: disabled || disableMulti
            }, now)
        );
    }

    if (customAction) {
        components.push(
            btn(mod, customAction, ownerId, {
                label: 'Lain',
                emoji: '✏️',
                style: ButtonStyle.Secondary,
                arg: argPrefix,
                disabled: disabled || disableMulti
            }, now)
        );
    }

    return new ActionRowBuilder().addComponents(components.slice(0, 5));
}

/**
 * Membagi array menjadi halaman (pagination).
 */
function paginate(items = [], page = 1, perPage = 8) {
    const list = Array.isArray(items) ? items : [];
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
    const startIndex = (safePage - 1) * perPage;
    const slice = list.slice(startIndex, startIndex + perPage);

    return {
        slice,
        page: safePage,
        totalPages,
        total: list.length,
        startIndex
    };
}

/**
 * Membuat ActionRow navigasi halaman `◀️ Hal X/Y ▶️` ditambah tombol ekstra bila muat.
 */
function pageRow(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        page = 1,
        totalPages = 1,
        argPrefix = '',
        extraButtons = []
    } = opts;

    const makePageArg = (targetPage) => (argPrefix ? `${argPrefix}:${targetPage}` : String(targetPage));

    const components = [
        btn(mod, action, ownerId, {
            emoji: '◀️',
            style: ButtonStyle.Secondary,
            arg: makePageArg(page - 1),
            disabled: page <= 1
        }, now),
        btn(mod, 'noop', ownerId, {
            label: `Hal ${page}/${totalPages}`,
            style: ButtonStyle.Secondary,
            arg: String(page),
            disabled: true
        }, now),
        btn(mod, action, ownerId, {
            emoji: '▶️',
            style: ButtonStyle.Secondary,
            arg: makePageArg(page + 1),
            disabled: page >= totalPages
        }, now)
    ];

    for (const extra of extraButtons) {
        if (components.length < 5 && extra) {
            components.push(extra);
        }
    }

    return new ActionRowBuilder().addComponents(components);
}

/**
 * Memvalidasi batas komponen Discord Components V2 (<= 40 komponen total, <= 5 ActionRow).
 */
function countV2Components({ title, blocks = [], actionRows = [], footer }) {
    let count = 1; // ContainerBuilder
    if (title) count += 2; // TextDisplay + Separator

    blocks.forEach((b, idx) => {
        if (!b) return;
        if (typeof b === 'string') {
            count += 1;
        } else if (b.divider) {
            count += 1;
        } else if (b.text && b.button) {
            count += 3; // Section + TextDisplay + ButtonAccessory
        } else if (b.text) {
            count += 1;
        }
        if (idx < blocks.length - 1 && b.separatorAfter) {
            count += 1;
        }
    });

    if (actionRows && actionRows.length > 0) {
        count += 1; // Separator sebelum actionRows
        for (const row of actionRows) {
            count += 1; // ActionRow
            const children = row.components || [];
            count += children.length;
        }
    }

    if (footer) {
        count += 2; // Separator + TextDisplay
    }

    return count;
}

/**
 * Menghitung total panjang karakter seluruh TextDisplay dalam satu payload Components V2 (batas Discord <= 4000 karakter).
 */
function countV2DisplayableText({ title, blocks = [], footer }) {
    let totalChars = 0;
    if (title) {
        totalChars += (`## ${title}`).length;
    }
    for (const b of blocks) {
        if (!b) continue;
        if (typeof b === 'string') {
            totalChars += b.length;
        } else if (typeof b.text === 'string') {
            totalChars += b.text.length;
        }
    }
    if (footer) {
        totalChars += (`-# ${footer}`).length;
    }
    return totalChars;
}

function assertComponentLimit(payloadMeta) {
    const rows = payloadMeta.actionRows || [];
    if (rows.length > MAX_ACTION_ROWS) {
        throw new Error(`Jumlah ActionRow (${rows.length}) melebihi batas maksimal Discord (${MAX_ACTION_ROWS}).`);
    }
    const total = countV2Components(payloadMeta);
    if (total > MAX_V2_COMPONENTS) {
        throw new Error(`Total komponen V2 (${total}) melebihi batas maksimal Discord (${MAX_V2_COMPONENTS}).`);
    }
    const textLen = countV2DisplayableText(payloadMeta);
    if (textLen > MAX_DISPLAYABLE_TEXT_LENGTH) {
        throw new Error(`Total teks tampilan Components V2 (${textLen} karakter) melebihi batas maksimal Discord (${MAX_DISPLAYABLE_TEXT_LENGTH}).`);
    }

    // Validasi tidak ada custom_id yang duplikat atau teks "undefined" dalam satu payload pesan
    const checkNoUndefined = (str, ctx) => {
        if (typeof str === 'string' && /\bundefined\b/.test(str)) {
            throw new Error(`Teks mengandung "undefined" pada ${ctx}: ${str}`);
        }
    };
    checkNoUndefined(payloadMeta.title, 'title');
    checkNoUndefined(payloadMeta.footer, 'footer');

    const seenCustomIds = new Set();
    for (const b of (payloadMeta.blocks || [])) {
        if (typeof b === 'string') {
            checkNoUndefined(b, 'block');
        } else if (b?.text) {
            checkNoUndefined(b.text, 'block.text');
        }
        const cid = b?.button?.data?.custom_id;
        if (cid) {
            if (seenCustomIds.has(cid)) {
                throw new Error(`Duplicate custom_id terdeteksi pada block button: ${cid}`);
            }
            seenCustomIds.add(cid);
        }
    }
    for (const row of rows) {
        for (const comp of (row.components || [])) {
            const cid = comp?.data?.custom_id;
            if (cid) {
                if (seenCustomIds.has(cid)) {
                    throw new Error(`Duplicate custom_id terdeteksi pada ActionRow: ${cid}`);
                }
                seenCustomIds.add(cid);
            }
            checkNoUndefined(comp?.data?.label, `button label (${cid})`);
            checkNoUndefined(comp?.data?.placeholder, `select placeholder (${cid})`);
            for (const opt of (comp?.options || [])) {
                checkNoUndefined(opt?.data?.label, `select option label (${cid})`);
                checkNoUndefined(opt?.data?.description, `select option description (${cid})`);
            }
        }
    }

    return total;
}

/**
 * Membangun panel interaktif tunggal dengan Mini-HUD, Notification Banner, dan validasi komponen.
 */
function buildPanel({
    mod = 'panel',
    ownerId = '0',
    accentColor = COLORS.PRIMARY,
    title = null,
    player = null,
    banner = null,
    blocks = [],
    rows = [],
    nav = null,
    footer = null,
    ephemeral = false,
    now = Date.now()
}) {
    const finalBlocks = [];

    const hudText = formatMiniHud(player);
    if (hudText) {
        finalBlocks.push({ text: hudText, separatorAfter: true });
    }

    const bannerText = formatBanner(banner);
    if (bannerText) {
        finalBlocks.push({ text: bannerText, separatorAfter: true });
    }

    for (const b of blocks) {
        if (b !== null && b !== undefined && b !== '') {
            finalBlocks.push(b);
        }
    }

    const finalRows = [...rows.filter(Boolean)];

    if (nav) {
        if (nav instanceof ActionRowBuilder) {
            finalRows.push(nav);
        } else if (Array.isArray(nav) && nav.length > 0) {
            finalRows.push(new ActionRowBuilder().addComponents(nav.slice(0, 5)));
        } else if (typeof nav === 'object') {
            const navBtns = [];
            if (nav.backAction) {
                navBtns.push(
                    btn(mod, nav.backAction, ownerId, {
                        label: nav.backLabel || 'Kembali',
                        emoji: '⬅️',
                        style: ButtonStyle.Secondary,
                        arg: nav.backArg || ''
                    }, now)
                );
            }
            if (nav.homeAction) {
                navBtns.push(
                    btn(mod, nav.homeAction, ownerId, {
                        label: nav.homeLabel || 'Menu Utama',
                        emoji: '🏠',
                        style: ButtonStyle.Secondary,
                        arg: nav.homeArg || ''
                    }, now)
                );
            }
            if (navBtns.length > 0) {
                finalRows.push(new ActionRowBuilder().addComponents(navBtns));
            }
        }
    }

    assertComponentLimit({
        title,
        blocks: finalBlocks,
        actionRows: finalRows,
        footer
    });

    return buildV2Card({
        accentColor,
        title,
        blocks: finalBlocks,
        actionRows: finalRows,
        footer,
        ephemeral
    });
}

/**
 * Membangun tampilan konfirmasi 2-langkah di tempat (in-place) untuk transaksi mahal/permanen.
 */
function confirmView({
    mod,
    confirmAction,
    cancelAction = 'home',
    ownerId,
    title = '⚠️ Konfirmasi Tindakan',
    description = 'Apakah kamu yakin ingin melanjutkan tindakan ini?',
    confirmLabel = 'Ya, Lanjutkan',
    cancelLabel = 'Batal',
    confirmStyle = ButtonStyle.Danger,
    arg = '',
    cancelArg = '',
    player = null,
    banner = null,
    accentColor = COLORS.WARNING,
    footer = null,
    now = Date.now()
}) {
    const row = new ActionRowBuilder().addComponents(
        btn(mod, confirmAction, ownerId, {
            label: confirmLabel,
            emoji: '✅',
            style: confirmStyle,
            arg
        }, now),
        btn(mod, cancelAction, ownerId, {
            label: cancelLabel,
            emoji: '❌',
            style: ButtonStyle.Secondary,
            arg: cancelArg
        }, now)
    );

    return buildPanel({
        mod,
        ownerId,
        accentColor,
        title,
        player,
        banner,
        blocks: Array.isArray(description) ? description : [description],
        rows: [row],
        footer,
        now
    });
}

/**
 * Membangun Modal input angka untuk tombol `[✏️ Nominal Lain]` atau `[✏️ Jumlah Lain]`.
 */
function numberModal(mod, action, ownerId, opts = {}, now = Date.now()) {
    const {
        title = 'Masukkan Nominal / Jumlah',
        label = 'Masukkan angka bulat positif',
        placeholder = 'Contoh: 50000',
        defaultValue = '',
        maxLength = 15,
        arg = ''
    } = opts;

    const modal = new ModalBuilder()
        .setCustomId(makeId(mod, action, ownerId, arg, now))
        .setTitle(String(title).slice(0, 45));

    const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(String(label).slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(String(placeholder).slice(0, 100))
        .setMinLength(1)
        .setMaxLength(maxLength)
        .setRequired(true);

    if (defaultValue) {
        input.setValue(String(defaultValue));
    }

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

/**
 * Membaca dan memvalidasi angka bulat positif dari ModalSubmitInteraction.
 */
function parseModalNumber(interaction, optsOrField = {}, maybeOpts = {}) {
    const opts = typeof optsOrField === 'string' ? (maybeOpts || {}) : (optsOrField || {});
    const { min = 1, max = Number.MAX_SAFE_INTEGER } = opts;
    const raw = (interaction.fields.getTextInputValue('value') || '').trim();
    const cleaned = raw.replace(/[.,_\s]/g, '').replace(/^lp/i, '');
    if (!/^\d+$/.test(cleaned)) {
        return {
            ok: false,
            error: `Input \`${raw}\` tidak valid. Masukkan angka bulat positif (tanpa huruf atau tanda negatif).`
        };
    }

    const num = Number(cleaned);
    if (!Number.isSafeInteger(num) || num < min) {
        return {
            ok: false,
            error: `Jumlah minimal adalah **${min.toLocaleString('id-ID')}**.`
        };
    }
    if (num > max) {
        return {
            ok: false,
            error: `Jumlah melampaui batas maksimal (**${max.toLocaleString('id-ID')}**).`
        };
    }

    return { ok: true, value: num };
}

/**
 * Membangun kartu panel kedaluwarsa (expired) ketika tombol diklik lewat 5 menit.
 */
function buildExpiredPanel(mod = 'panel') {
    return buildV2Card({
        accentColor: COLORS.WARNING,
        title: '⌛ Sesi Panel Berakhir',
        blocks: [
            `Sesi panel \`/${mod}\` ini telah berakhir karena tidak ada aktivitas selama **5 menit**.`,
            `Silakan jalankan kembali perintah \`/${mod}\` untuk membuka panel baru.`
        ]
    });
}

/**
 * Mengirim pembaruan panel di tempat (interaction.update) bila berasal dari komponen pesan
 * atau modal yang dibuka dari komponen pesan, atau fallback ke interaction.reply.
 */
async function respondOrUpdate(interaction, payload) {
    if (typeof interaction.update === 'function') {
        if (typeof interaction.isFromMessage === 'function') {
            return interaction.isFromMessage()
                ? await interaction.update(payload)
                : await interaction.reply(payload);
        }
        return await interaction.update(payload);
    }
    return await interaction.reply(payload);
}

module.exports = {
    MAX_V2_COMPONENTS,
    MAX_ACTION_ROWS,
    MAX_SELECT_OPTIONS,
    MAX_DISPLAYABLE_TEXT_LENGTH,
    formatMiniHud,
    formatBanner,
    btn,
    select,
    userSelect,
    percentRow,
    quantityRow,
    paginate,
    pageRow,
    countV2Components,
    countV2DisplayableText,
    assertComponentLimit,
    buildPanel,
    confirmView,
    numberModal,
    parseModalNumber,
    buildExpiredPanel,
    respondOrUpdate
};
