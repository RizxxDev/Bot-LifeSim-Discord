const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../database/mariadb');
const { getCaffeineCount, incrementCaffeineCount } = require('../database/redis');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, removeItem } = require('./inventoryService');
const { getItem } = require('../data/items');
const { VITALS } = require('../data/constants');
const { COLORS, formatVitalsCompact, buildV2Card } = require('../utils/uiBuilder');
const { buildRegistrationModal } = require('./onboardingService');

async function autocompleteInventoryByTags(interaction, allowedTags = []) {
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    try {
        const rows = await query(
            `SELECT item_id, SUM(quantity) AS total_qty
             FROM player_inventory
             WHERE discord_id = ? AND storage_location = 'bag' AND quantity > 0
             GROUP BY item_id`,
            [interaction.user.id]
        );

        const choices = [];
        for (const row of rows) {
            const item = getItem(row.item_id);
            if (!item || !item.tags) continue;
            const matchesTag = allowedTags.some(t => item.tags.includes(t));
            if (!matchesTag) continue;

            const searchTarget = `${item.id} ${item.name}`.toLowerCase();
            if (focused && !searchTarget.includes(focused)) continue;

            const effParts = [];
            if (item.effects?.hunger) effParts.push(`🍔+${item.effects.hunger}`);
            if (item.effects?.thirst) effParts.push(`💧+${item.effects.thirst}`);
            if (item.effects?.energy) effParts.push(`⚡+${item.effects.energy}`);
            if (item.effects?.health) effParts.push(`❤️+${item.effects.health}`);
            if (item.buff) effParts.push(`✨${item.buff.label}`);

            const effLabel = effParts.length > 0 ? ` (${effParts.join(' ')})` : '';
            choices.push({
                name: `${item.name} ×${row.total_qty}${effLabel}`.slice(0, 100),
                value: item.id
            });
        }

        await interaction.respond(choices.slice(0, 25));
    } catch {
        await interaction.respond([]);
    }
}

async function handleConsumptionCommand(interaction, mode = 'eat') {
    const itemId = interaction.options.getString('item', true).toLowerCase();
    const requestedAmount = Math.max(1, Math.min(20, interaction.options.getInteger('amount') || 1));
    const item = getItem(itemId);

    const allowedTags = mode === 'eat'
        ? ['food']
        : mode === 'drink'
            ? ['drink']
            : ['medicine', 'license', 'service', 'prestise'];

    const shopQuickButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(mode === 'use' ? 'shop_jump_apotek' : 'shop_jump_warung')
            .setLabel(mode === 'use' ? 'Buka Apotek (/shop)' : 'Beli Cepat di Warung (/shop)')
            .setEmoji('🛒')
            .setStyle(ButtonStyle.Primary)
    );

    if (!item || !item.tags || !allowedTags.some(t => item.tags.includes(t))) {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.WARNING,
                title: '⚠️ Item Tidak Sesuai',
                blocks: [
                    mode === 'eat'
                        ? 'Item tersebut bukan makanan! Gunakan `/eat` khusus untuk makanan (atau ikan segar yang bisa dibakar).'
                        : mode === 'drink'
                            ? 'Item tersebut bukan minuman! Gunakan `/drink` khusus untuk minuman.'
                            : 'Item tersebut tidak dapat digunakan lewat `/use`.'
                ],
                actionRows: [shopQuickButton],
                ephemeral: true
            })
        );
    }

    // Khusus Akta Ganti Nama: buka modal form ganti username
    if (item.id === 'surat_ganti_nama') {
        const rows = await query(
            `SELECT SUM(quantity) AS total_qty FROM player_inventory WHERE discord_id = ? AND item_id = 'surat_ganti_nama'`,
            [interaction.user.id]
        );
        const owned = Number(rows[0]?.total_qty || 0);
        if (owned <= 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Item Tidak Dimiliki',
                    blocks: ['Kamu tidak memiliki **📜 Akta Ganti Nama Resmi** di tasmu. Beli terlebih dahulu di Kantor Layanan (`/shop`).'],
                    ephemeral: true
                })
            );
        }
        return await interaction.showModal(buildRegistrationModal(true));
    }

    const now = Date.now();
    const discordId = interaction.user.id;

    // Cek jumlah konsumsi kafein hari ini bila item mengandung kafein
    let caffeineBefore = 0;
    if (item.caffeineType) {
        caffeineBefore = await getCaffeineCount(discordId, item.caffeineType, now);
    }

    let result;
    try {
        result = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const player = synced.player;
            const invRows = await getPlayerInventory(conn, discordId, true);

            const ownedQty = invRows
                .filter(r => r.item_id === item.id)
                .reduce((acc, r) => acc + Number(r.quantity), 0);

            if (ownedQty <= 0) {
                return { error: 'NOT_OWNED' };
            }

            // Jika item berupa Gelar Prestise (pasang gelar, tidak habis dipakai)
            if (item.tags.includes('prestise') && item.titleLabel) {
                await conn.execute(
                    `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                    [item.titleLabel, discordId]
                );
                player.equipped_title = item.titleLabel;
                return { equippedTitle: item.titleLabel, player };
            }

            // Jika item berupa SIM C / SIM A / Laptop (pasif)
            if (item.id === 'sim_c' || item.id === 'sim_a' || item.id === 'laptop') {
                return { error: 'PASSIVE_ITEM' };
            }

            // Jika item berupa Tabung Gas LPG 3kg: tambahkan +10 muatan kompor per tabung
            if (item.id === 'gas_lpg') {
                const useGas = Math.min(ownedQty, requestedAmount);
                const addedCharges = useGas * (item.lpgCharges || 10);
                await removeItem(conn, discordId, item.id, useGas);
                const newCharges = Number(player.lpg_charges || 0) + addedCharges;
                await conn.execute(
                    `UPDATE players SET lpg_charges = ? WHERE discord_id = ?`,
                    [newCharges, discordId]
                );
                player.lpg_charges = newCharges;
                return {
                    lpgRefilled: true,
                    usedCount: useGas,
                    addedCharges,
                    totalCharges: newCharges,
                    remainingOwned: ownedQty - useGas,
                    player
                };
            }

            const maxUsable = Math.min(ownedQty, requestedAmount);
            let usedCount = 0;
            let totalGain = { hunger: 0, thirst: 0, energy: 0, health: 0 };
            let caffeineReducedCount = 0;

            for (let i = 0; i < maxUsable; i++) {
                // Cek apakah stat utama sudah penuh (100) agar item tidak terbuang sia-sia
                if (mode === 'eat' && player.hunger >= VITALS.MAX && !item.buff) {
                    break;
                }
                if (mode === 'drink' && player.thirst >= VITALS.MAX && (!item.effects?.energy || player.energy >= VITALS.MAX)) {
                    break;
                }
                if (mode === 'use' && item.effects?.health && !item.effects?.energy && !item.buff && player.health >= VITALS.MAX) {
                    break;
                }

                usedCount += 1;

                if (item.effects?.hunger) {
                    const before = player.hunger;
                    player.hunger = Math.min(VITALS.MAX, player.hunger + item.effects.hunger);
                    totalGain.hunger += (player.hunger - before);
                }
                if (item.effects?.thirst) {
                    const before = player.thirst;
                    player.thirst = Math.min(VITALS.MAX, player.thirst + item.effects.thirst);
                    totalGain.thirst += (player.thirst - before);
                }
                if (item.effects?.health) {
                    const before = player.health;
                    player.health = Math.min(VITALS.MAX, player.health + item.effects.health);
                    totalGain.health += (player.health - before);
                }
                if (item.effects?.energy) {
                    let energyEffect = item.effects.energy;
                    if (item.caffeineType) {
                        const cupIndex = caffeineBefore + usedCount;
                        if (cupIndex >= 3) {
                            energyEffect = item.caffeineType === 'kopi' ? 5 : 8;
                            caffeineReducedCount += 1;
                        }
                    }
                    const before = player.energy;
                    player.energy = Math.min(VITALS.MAX, player.energy + energyEffect);
                    totalGain.energy += (player.energy - before);
                }
            }

            if (usedCount === 0) {
                return { error: 'ALREADY_FULL', player };
            }

            await removeItem(conn, discordId, item.id, usedCount);

            const isCookedDish = item.tags && item.tags.includes('cooked');
            const addedCookedEaten = isCookedDish ? usedCount : 0;
            player.cooked_dishes_eaten = Number(player.cooked_dishes_eaten || 0) + addedCookedEaten;

            await conn.execute(
                `UPDATE players SET energy = ?, hunger = ?, thirst = ?, health = ?, cooked_dishes_eaten = cooked_dishes_eaten + ? WHERE discord_id = ?`,
                [player.energy, player.hunger, player.thirst, player.health, addedCookedEaten, discordId]
            );

            let appliedBuff = null;
            let buffSkippedStronger = false;
            if (item.buff) {
                const existingBuff = (synced.buffs || []).find(
                    b => b.buff_type === item.buff.type && Number(b.expires_at) > now
                );
                if (item.buff.isHomeCooked && existingBuff && Number(existingBuff.multiplier) > Number(item.buff.multiplier)) {
                    buffSkippedStronger = true;
                } else {
                    const expiresAt = now + item.buff.durationSec * 1000;
                    await conn.execute(
                        `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                         VALUES (?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier), expires_at = VALUES(expires_at)`,
                        [discordId, item.buff.type, item.buff.multiplier, expiresAt]
                    );
                    appliedBuff = item.buff;
                }
            }

            return {
                usedCount,
                remainingOwned: ownedQty - usedCount,
                totalGain,
                caffeineReducedCount,
                appliedBuff,
                buffSkippedStronger,
                player
            };
        });
    } catch (err) {
        throw err;
    }

    if (result.error === 'NOT_OWNED') {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.WARNING,
                title: '🎒 Persediaan Kosong',
                blocks: [`Kamu tidak punya **${item.emoji} ${item.name}** di tasmu saat ini.`],
                actionRows: [shopQuickButton],
                ephemeral: true
            })
        );
    }

    if (result.error === 'PASSIVE_ITEM') {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.PRIMARY,
                title: `ℹ️ ${item.emoji} ${item.name}`,
                blocks: ['Item ini bersifat **pasif** — selama ada di dalam tasmu, syarat pekerjaan otomatis terpenuhi tanpa perlu di-`/use`.'],
                ephemeral: true
            })
        );
    }

    if (result.error === 'ALREADY_FULL') {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '✨ Kondisimu Sudah Penuh!',
                blocks: [
                    `Stat targetmu sudah berada di angka **100**, sehingga **${item.emoji} ${item.name}** tidak jadi dikonsumsi agar tidak terbuang sia-sia.`,
                    formatVitalsCompact(result.player)
                ],
                ephemeral: true
            })
        );
    }

    if (result.equippedTitle) {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.ECONOMY,
                title: '👑 Gelar Prestise Dipasang!',
                blocks: [
                    `Gelar **${result.equippedTitle}** kini aktif dan tampil di kartu \`/profile\` kamu!`
                ]
            })
        );
    }

    if (result.lpgRefilled) {
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '🟢 Tabung Gas LPG Dipasang!',
                blocks: [
                    `Kamu memasang **${result.usedCount}× ${item.emoji} ${item.name}** ke kompor propertimu *(tersisa ${result.remainingOwned} di tas)*.`,
                    `🔥 **Muatan Kompor Bertambah:** **+${result.addedCharges}x masak** (Total cadangan: **${result.totalCharges}x masak**).`
                ]
            })
        );
    }

    if (item.caffeineType && result.usedCount > 0) {
        await incrementCaffeineCount(discordId, item.caffeineType, result.usedCount, now);
    }

    const gainParts = [];
    if (result.totalGain.hunger > 0) gainParts.push(`🍔 **+${Math.round(result.totalGain.hunger)} Hunger**`);
    if (result.totalGain.thirst > 0) gainParts.push(`💧 **+${Math.round(result.totalGain.thirst)} Thirst**`);
    if (result.totalGain.energy > 0) gainParts.push(`⚡ **+${Math.round(result.totalGain.energy)} Energy**`);
    if (result.totalGain.health > 0) gainParts.push(`❤️ **+${Math.round(result.totalGain.health)} Health**`);
    if (result.appliedBuff) gainParts.push(`✨ Buff Aktif: **${result.appliedBuff.label}**`);

    const notes = [];
    if (result.usedCount < requestedAmount) {
        notes.push(`ℹ️ Kamu meminta **${requestedAmount}x**, namun otomatis berhenti di **${result.usedCount}x** karena stat sudah mencapai 100 (sisa item tidak terbuang).`);
    }
    if (result.caffeineReducedCount > 0) {
        notes.push(`☕ *Toleransi Kafein Harian:* Konsumsi ke-3 dst hari ini memberikan efek Energy yang lebih kecil.`);
    }
    if (result.buffSkippedStronger) {
        notes.push(`ℹ️ *Buff Restoran Tetap Aktif:* Kamu sedang memiliki buff restoran yang lebih kuat, sehingga buff masakan rumahan tidak menimpa buff aktifmu.`);
    }

    const actionVerb = item.tags.includes('fish')
        ? 'membakar & memakan'
        : mode === 'eat'
            ? 'memakan'
            : mode === 'drink'
                ? 'meminum'
                : 'menggunakan';

    return await interaction.reply(
        buildV2Card({
            accentColor: COLORS.SUCCESS,
            title: `${item.emoji} Berhasil ${actionVerb.charAt(0).toUpperCase() + actionVerb.slice(1)} ${item.name}`,
            blocks: [
                `Kamu ${actionVerb} **${result.usedCount}× ${item.emoji} ${item.name}** *(tersisa ${result.remainingOwned} di tas)*.`,
                gainParts.length > 0 ? `📈 **Efek:** ${gainParts.join(' · ')}` : null,
                `📊 **Stat Saat Ini:** ${formatVitalsCompact(result.player)}`,
                notes.length > 0 ? notes.join('\n') : null
            ]
        })
    );
}

module.exports = {
    autocompleteInventoryByTags,
    handleConsumptionCommand
};
