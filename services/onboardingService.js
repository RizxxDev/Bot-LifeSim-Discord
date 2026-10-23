const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { BRANDING, STARTER_PACK } = require('../data/constants');
const { getItem } = require('../data/items');
const { COLORS, formatLp, buildV2Card, validateUsername } = require('../utils/uiBuilder');
const { withTransaction, query } = require('../database/mariadb');
const { addItem } = require('./inventoryService');

function buildWelcomeCardPayload(ephemeral = true) {
    const starterList = STARTER_PACK.items
        .map(it => {
            const def = getItem(it.itemId);
            return def ? `${def.emoji} ${def.name} ×${it.qty}` : `${it.itemId} ×${it.qty}`;
        })
        .join(' · ');

    const startRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('reg_open_modal')
            .setLabel('Mulai Hidup Baru')
            .setEmoji('🌱')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('help_open_home')
            .setLabel('Lihat Panduan')
            .setEmoji('📖')
            .setStyle(ButtonStyle.Secondary)
    );

    return buildV2Card({
        accentColor: COLORS.SUCCESS,
        title: `🌆 ${BRANDING.WELCOME_TITLE}`,
        blocks: [
            'Selamat datang! Di sini kamu akan menjalani kehidupan virtual dari nol: memilih karir, menempuh pendidikan, menjaga kesehatan, hingga mengumpulkan kekayaan dari memancing dan menambang.',
            `🎁 **Paket Modal Awal Warga Baru:**\n💵 Uang Tunai **${formatLp(STARTER_PACK.cash)}**\n🎒 **Tas Kecil (20 Slot)** berisi: ${starterList}`,
            'Klik tombol **🌱 Mulai Hidup Baru** di bawah untuk mendaftarkan nama karaktermu!'
        ],
        actionRows: [startRow],
        footer: 'Satu karakter berlaku secara global di seluruh server Discord.',
        ephemeral
    });
}

function buildRegistrationModal(isRename = false) {
    const modal = new ModalBuilder()
        .setCustomId(isRename ? 'rename_submit_modal' : 'reg_submit_modal')
        .setTitle(isRename ? 'Ganti Nama Karakter' : BRANDING.WELCOME_TITLE);

    const usernameInput = new TextInputBuilder()
        .setCustomId('username_input')
        .setLabel('Nama / Username Karakter (3-16 karakter)')
        .setPlaceholder('Contoh: Budi_Santoso99 (huruf, angka, underscore)')
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
    return modal;
}

function buildRegistrationErrorPayload(reason, isRename = false) {
    const retryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(isRename ? 'rename_open_modal' : 'reg_open_modal')
            .setLabel('Coba Lagi')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary)
    );

    return buildV2Card({
        accentColor: COLORS.DANGER,
        title: '❌ Pendaftaran Username Ditolak',
        blocks: [
            reason,
            'Silakan klik tombol **🔄 Coba Lagi** di bawah untuk memasukkan username lain.'
        ],
        actionRows: [retryRow],
        ephemeral: true
    });
}

async function getPlayerBasic(discordId) {
    const rows = await query(`SELECT * FROM players WHERE discord_id = ? LIMIT 1`, [discordId]);
    return rows.length > 0 ? rows[0] : null;
}

async function processRegistrationModal(interaction) {
    const rawUsername = interaction.fields.getTextInputValue('username_input');
    const validation = validateUsername(rawUsername);

    if (!validation.valid) {
        return await interaction.reply(buildRegistrationErrorPayload(validation.reason, false));
    }

    const discordId = interaction.user.id;
    const now = Date.now();

    try {
        await withTransaction(async (conn) => {
            const [existingUser] = await conn.execute(
                `SELECT discord_id FROM players WHERE discord_id = ? FOR UPDATE`,
                [discordId]
            );
            if (existingUser.length > 0) {
                throw new Error('ALREADY_REGISTERED');
            }

            const [existingName] = await conn.execute(
                `SELECT discord_id FROM players WHERE username_lower = ? LIMIT 1`,
                [validation.usernameLower]
            );
            if (existingName.length > 0) {
                throw new Error('USERNAME_TAKEN');
            }

            await conn.execute(
                `INSERT INTO players (
                    discord_id, username, username_lower, cash, bank,
                    energy, hunger, thirst, health, last_tick_at,
                    education_level, backpack_tier, max_slots, created_at
                ) VALUES (?, ?, ?, ?, 0, 100, 100, 100, 100, ?, 'SD', 0, 20, ?)`,
                [discordId, validation.username, validation.usernameLower, STARTER_PACK.cash, now, now]
            );

            for (const starterItem of STARTER_PACK.items) {
                await addItem(conn, discordId, starterItem.itemId, starterItem.qty, now);
            }

            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'faucet', 'starter_pack', ?, ?, ?, ?)`,
                [discordId, STARTER_PACK.cash, STARTER_PACK.cash, JSON.stringify({ username: validation.username }), now]
            );
        });
    } catch (err) {
        if (err.message === 'ALREADY_REGISTERED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: 'ℹ️ Sudah Terdaftar',
                    blocks: ['Akun Discord kamu sudah memiliki karakter aktif! Gunakan `/profile` atau `/help` untuk mulai bermain.'],
                    ephemeral: true
                })
            );
        }
        if (err.message === 'USERNAME_TAKEN' || err.code === 'ER_DUP_ENTRY') {
            return await interaction.reply(
                buildRegistrationErrorPayload(
                    `Username **\`${validation.username}\`** sudah digunakan oleh warga lain! Silakan pilih username yang berbeda.`,
                    false
                )
            );
        }
        throw err;
    }

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('help_open_home')
            .setLabel('Panduan & Cara Mulai')
            .setEmoji('📖')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('job_quick_list')
            .setLabel('Cari Pekerjaan (/job)')
            .setEmoji('💼')
            .setStyle(ButtonStyle.Success)
    );

    return await interaction.reply(
        buildV2Card({
            accentColor: COLORS.SUCCESS,
            title: `🎉 Selamat Datang, ${validation.username}!`,
            blocks: [
                `Identitas barumu telah tercatat di **${BRANDING.WELCOME_TITLE}**.`,
                `💵 **Saldo Awal:** ${formatLp(STARTER_PACK.cash)}\n⚡ **Stat Vital:** Energy 100 · Hunger 100 · Thirst 100 · Health 100\n🎒 **Paket Starter:** Pancingan Bambu, 20 Umpan Cacing, Beliung Batu, serta bekal makan & minum 3 hari telah dimasukkan ke \`/inventory\`.`,
                `**Langkah Pertamamu:**\n1. Lamar pekerjaan awal lewat \`/job apply\` (atau klik tombol di bawah).\n2. Jalankan shift pertamamu dengan \`/work\`.\n3. Coba memancing dengan \`/fishing\` atau menambang dengan \`/mining\`!\n4. 🌟 **Bonus Warga Baru (7 Hari):** EXP Kerja & Skill **×1,5** dan **Bebas Pajak Penghasilan**!`
            ],
            actionRows: [actionRow],
            ephemeral: true
        })
    );
}

module.exports = {
    buildWelcomeCardPayload,
    buildRegistrationModal,
    buildRegistrationErrorPayload,
    getPlayerBasic,
    processRegistrationModal
};
