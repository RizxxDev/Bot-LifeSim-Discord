const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    getPlayerVehicles,
    buyVehicleCash,
    equipVehicle,
    refuelVehicle,
    serviceVehicle
} = require('../../services/vehicleService');
const {
    FUEL_PRICE_PER_LITER,
    getAllVehicles,
    getVehicle
} = require('../../data/vehicles');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    confirmView
} = require('../../utils/panelBuilder');

function formatVehicleRowStatus(vRow) {
    const v = vRow.vehicle;
    if (!v) return `• Kendaraan tidak dikenal (${vRow.vehicle_id})`;

    const activeBadge = vRow.is_equipped === 1 ? '🟢 **AKTIF DIPAKAI**' : '⚪ *Tersimpan di Garasi*';
    const fuelText = v.tankCapacity > 0
        ? `⛽ Bensin: **${vRow.fuel_liters.toFixed(2)} / ${v.tankCapacity} L**`
        : '⛽ *Tanpa Bensin (Tenaga Kayuh)*';

    const kmSinceService = Math.max(0, Number((vRow.odometer_km - vRow.last_service_km).toFixed(1)));
    const serviceStatus = vRow.overdue
        ? `⚠️ **WAJIB SERVIS!** (${kmSinceService}/${v.serviceIntervalKm} km · Bonus -50% & 10% risiko mogok)`
        : `🔧 Servis: **${kmSinceService} / ${v.serviceIntervalKm} km** *(Biaya servis: ${formatLp(v.serviceCost)})*`;

    return [
        `${v.emoji} **${v.name}** — ${activeBadge}`,
        `   └ 🛣️ Odometer: **${vRow.odometer_km.toFixed(1)} km** · ${fuelText}`,
        `   └ ${serviceStatus}`
    ].join('\n');
}

async function fetchVehicleState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const owned = await getPlayerVehicles(conn, discordId, false);
        return { player: synced.player, owned };
    });
}

function buildVehiclePanel({
    state,
    selectedVehicleId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, owned } = state;
    const ownerId = p.discord_id;
    const allVehicles = getAllVehicles();
    const ownedMap = new Map(owned.map(o => [o.vehicle_id, o]));
    const equippedRow = owned.find(o => o.is_equipped === 1) || owned[0] || null;

    const activeId = selectedVehicleId || (equippedRow ? equippedRow.vehicle_id : null);
    const activeVeh = activeId ? getVehicle(activeId) : null;
    const activeOwnedRow = activeVeh ? ownedMap.get(activeVeh.id) || null : null;

    const garageLines = owned.length > 0
        ? owned.map(formatVehicleRowStatus).join('\n\n')
        : '⚪ *Garasimu masih kosong. Pilih kendaraan di bawah untuk membeli tunai atau cicil di `/credit`.*';

    const blocks = [
        [
            `🚘 **Garasi Kendaraanmu (${owned.length}/${allVehicles.length} Unit)** · ⛽ **Harga BBM SPBU:** **${formatLp(FUEL_PRICE_PER_LITER)}/L**`,
            garageLines
        ].join('\n')
    ];

    if (activeVeh) {
        const fuelSpec = activeVeh.tankCapacity > 0
            ? `Tangki **${activeVeh.tankCapacity} L** (Kerja: ${activeVeh.fuelPerShift} L · Lokasi Jauh: ${activeVeh.fuelPerTrip} L)`
            : 'Tanpa BBM (Tenaga Kayuh)';
        const ownBadge = activeOwnedRow
            ? (activeOwnedRow.is_equipped === 1 ? '🟢 **Sedang Dipakai**' : '✅ **Dimiliki di Garasi**')
            : activeVeh.gachaExclusive
                ? '🎰 *Belum Dimiliki (Eksklusif Jackpot `/gacha`)*'
                : (activeVeh.canCredit ? '💳 *Belum Dimiliki (Bisa Tunai / Kredit `/credit`)*' : '💵 *Belum Dimiliki (Beli Tunai)*');

        blocks.push(
            [
                `🔎 **Spesifikasi Kendaraan: ${activeVeh.emoji} ${activeVeh.name}** — ${ownBadge}`,
                `• 💰 ${activeVeh.gachaExclusive ? 'Nilai Taksiran Aset' : 'Harga Dealer'} : **${formatLp(activeVeh.buyPrice)}**`,
                `• ⛽ Konsumsi BBM : ${fuelSpec}`,
                `• 🔧 Servis Rutin : Tiap **${activeVeh.serviceIntervalKm} km** (**${formatLp(activeVeh.serviceCost)}**)`,
                `• ✨ Manfaat      : ${activeVeh.description}`
            ].join('\n')
        );
    } else {
        const dealerLines = allVehicles.map(v => {
            const isOwned = ownedMap.has(v.id);
            const badge = isOwned
                ? '✅ **Dimiliki**'
                : v.gachaExclusive
                    ? '🎰 *Jackpot `/gacha`*'
                    : (v.canCredit ? '💳 *Tunai/Kredit*' : '💵 *Tunai*');
            return `${v.emoji} **${v.name}** — **${formatLp(v.buyPrice)}** (${badge})\n   └ ✨ ${v.description}`;
        });
        blocks.push(`**📋 Katalog Dealer Kendaraan Kota:**\n${dealerLines.join('\n')}`);
    }

    const rows = [
        select('vehicle', 'pick', ownerId, {
            placeholder: '🚘 Pilih kendaraan untuk dikelola atau dibeli...',
            options: allVehicles.map(v => {
                const row = ownedMap.get(v.id);
                const statusTag = row
                    ? (row.is_equipped === 1 ? ' [AKTIF]' : ' [DIMILIKI]')
                    : '';
                return {
                    label: `${v.name}${statusTag}`,
                    value: v.id,
                    emoji: v.emoji,
                    description: `${formatLp(v.buyPrice)} — ${v.description.slice(0, 70)}`,
                    default: activeVeh ? activeVeh.id === v.id : false
                };
            })
        }, now)
    ];

    const actionButtons = [];
    if (activeVeh) {
        if (activeOwnedRow) {
            if (activeOwnedRow.is_equipped !== 1) {
                actionButtons.push(
                    btn('vehicle', 'equip', ownerId, {
                        label: 'Pakai Kendaraan',
                        emoji: '🔑',
                        style: ButtonStyle.Primary,
                        arg: activeVeh.id
                    }, now)
                );
            }
            if (activeVeh.tankCapacity > 0 && activeOwnedRow. is_equipped === 1) {
                const missingLiters = Math.max(0, Number((activeVeh.tankCapacity - activeOwnedRow.fuel_liters).toFixed(2)));
                const refuelCost = Math.max(100, Math.round(missingLiters * FUEL_PRICE_PER_LITER));
                actionButtons.push(
                    btn('vehicle', 'refuel', ownerId, {
                        label: missingLiters > 0.01 ? `Isi Penuh BBM (${formatLp(refuelCost)})` : 'Tangki Penuh',
                        emoji: '⛽',
                        style: ButtonStyle.Success,
                        disabled: missingLiters <= 0.01
                    }, now)
                );
            }
            const kmSince = Math.max(0, Number((activeOwnedRow.odometer_km - activeOwnedRow.last_service_km).toFixed(1)));
            actionButtons.push(
                btn('vehicle', 'service', ownerId, {
                    label: `Servis (${formatLp(activeVeh.serviceCost)})`,
                    emoji: '🔧',
                    style: activeOwnedRow.overdue ? ButtonStyle.Danger : ButtonStyle.Secondary,
                    disabled: kmSince < 10,
                    arg: activeVeh.id
                }, now)
            );
        } else if (!activeVeh.gachaExclusive) {
            actionButtons.push(
                btn('vehicle', 'buy_prompt', ownerId, {
                    label: `Beli Tunai (${formatLp(activeVeh.buyPrice)})`,
                    emoji: '💵',
                    style: ButtonStyle.Success,
                    arg: activeVeh.id
                }, now)
            );
        }
    } else if (equippedRow && equippedRow.vehicle && equippedRow.vehicle.tankCapacity > 0) {
        const missingLiters = Math.max(0, Number((equippedRow.vehicle.tankCapacity - equippedRow.fuel_liters).toFixed(2)));
        const refuelCost = Math.max(100, Math.round(missingLiters * FUEL_PRICE_PER_LITER));
        actionButtons.push(
            btn('vehicle', 'refuel', ownerId, {
                label: missingLiters > 0.01 ? `Isi Penuh BBM (${formatLp(refuelCost)})` : 'Tangki Penuh',
                emoji: '⛽',
                style: ButtonStyle.Success,
                disabled: missingLiters <= 0.01
            }, now)
        );
    }

    actionButtons.push(
        btn('vehicle', 'catalog', ownerId, {
            label: 'Semua Katalog',
            emoji: '📋',
            style: ButtonStyle.Secondary
        }, now),
        btn('vehicle', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(actionButtons.slice(0, 5)));

    const hasOverdue = owned.some(o => o.overdue);
    return buildPanel({
        mod: 'vehicle',
        ownerId,
        accentColor: hasOverdue ? COLORS.WARNING : COLORS.PRIMARY,
        title: `🚘 Garasi, SPBU & Dealer Kendaraan`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Kendaraan aktif memberi bonus gaji /work dan diskon Energy ke lokasi jauh (/fishing & /mining).',
        now
    });
}

module.exports = {
    name: 'vehicle',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('vehicle')
        .setDescription('Buka panel kendaraan interaktif: garasi, beli kendaraan, isi bensin SPBU, dan servis berkala.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchVehicleState(interaction.user.id, now);
        return await interaction.reply(buildVehiclePanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchVehicleState(interaction.user.id, now);
                return await interaction.update(buildVehiclePanel({ state, now }));
            },
            async catalog(interaction) {
                const now = Date.now();
                const state = await fetchVehicleState(interaction.user.id, now);
                return await interaction.update(buildVehiclePanel({ state, selectedVehicleId: '', now }));
            },
            async equip(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const vehId = parsed.arg || '';
                const res = await withTransaction(async (conn) => {
                    await syncPlayerVitals(conn, userId, now, true);
                    return await equipVehicle(conn, userId, vehId);
                });

                const state = await fetchVehicleState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🔑 **${res.vehicle.emoji} ${res.vehicle.name}** kini dipasang sebagai kendaraan utama!` }
                    : { type: 'warning', text: 'Kendaraan tersebut belum ada di garasimu.' };
                return await interaction.update(buildVehiclePanel({ state, selectedVehicleId: vehId, banner, now }));
            },
            async refuel(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await refuelVehicle(conn, synced.player, null, now);
                });

                const state = await fetchVehicleState(userId, now);
                let banner = null;
                if (res.ok) {
                    banner = {
                        type: 'success',
                        text: `⛽ Berhasil mengisi **+${res.litersAdded} L** BBM untuk **${res.vehicle.emoji} ${res.vehicle.name}** seharga **${formatLp(res.totalCost)}**!`
                    };
                } else if (res.error === 'TANK_ALREADY_FULL') {
                    banner = { type: 'info', text: `⛽ Tangki **${res.vehicle.emoji} ${res.vehicle.name}** sudah penuh!` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo tidak cukup untuk membeli **${res.litersToBuy} L** bensin seharga **${formatLp(res.required)}**.` };
                } else {
                    banner = { type: 'warning', text: 'Tidak dapat mengisi bensin untuk kendaraan ini.' };
                }

                return await interaction.update(buildVehiclePanel({ state, banner, now }));
            },
            async service(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const vehId = parsed.arg || null;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await serviceVehicle(conn, synced.player, vehId, now);
                });

                const state = await fetchVehicleState(userId, now);
                let banner = null;
                if (res.ok) {
                    banner = {
                        type: 'success',
                        text: `🔧 Servis berkala **${res.vehicle.emoji} ${res.vehicle.name}** selesai pada odometer **${res.odometerKm.toFixed(1)} km** (Biaya **${formatLp(res.cost)}**). Performa kembali 100%!`
                    };
                } else if (res.error === 'ALREADY_FRESH') {
                    banner = { type: 'info', text: `🔧 Kondisi **${res.vehicle.emoji} ${res.vehicle.name}** masih prima (baru menempuh ${res.kmSinceLast} km sejak servis terakhir).` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo tidak cukup! Biaya servis **${formatLp(res.required)}**, saldo Cash + Bank kamu **${formatLp(res.totalFunds)}**.` };
                } else {
                    banner = { type: 'warning', text: 'Gagal melakukan servis kendaraan.' };
                }

                return await interaction.update(buildVehiclePanel({ state, selectedVehicleId: vehId, banner, now }));
            },
            async buy_prompt(interaction, parsed) {
                const now = Date.now();
                const vehId = parsed.arg || 'sepeda';
                const veh = getVehicle(vehId);
                const state = await fetchVehicleState(interaction.user.id, now);

                return await interaction.update(
                    confirmView({
                        mod: 'vehicle',
                        confirmAction: 'buy_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🚘 Konfirmasi Pembelian ${veh.emoji} ${veh.name}`,
                        description: [
                            `Kamu akan membeli **${veh.emoji} ${veh.name}** secara tunai:`,
                            `• Harga Beli Tunai: **${formatLp(veh.buyPrice)}**\n• Manfaat: ${veh.description}`,
                            'Kendaraan akan langsung masuk ke garasi dengan tangki bensin penuh. Lanjutkan pembelian?'
                        ],
                        confirmLabel: `Ya, Beli (${formatLp(veh.buyPrice)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: veh.id,
                        player: state.player,
                        now
                    })
                );
            },
            async buy_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const vehId = parsed.arg || 'sepeda';
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await buyVehicleCash(conn, synced.player, vehId, now);
                });

                const state = await fetchVehicleState(userId, now);
                let banner = null;
                if (res.ok) {
                    banner = {
                        type: 'success',
                        text: `🎉 Selamat! **${res.vehicle.emoji} ${res.vehicle.name}** berhasil dibeli seharga **${formatLp(res.paid)}** dan langsung aktif digunakan!`
                    };
                } else if (res.error === 'ALREADY_OWNED') {
                    banner = { type: 'warning', text: `Kamu sudah memiliki **${res.vehicle.emoji} ${res.vehicle.name}** di garasimu!` };
                } else if (res.error === 'GACHA_EXCLUSIVE') {
                    banner = { type: 'warning', text: `🎰 **${res.vehicle.emoji} ${res.vehicle.name}** hanya bisa didapatkan melalui Jackpot di \`/gacha\`!` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    const creditHint = res.vehicle.canCredit
                        ? ` Kamu juga bisa mencicilnya dengan DP 20% (${formatLp(Math.round(res.required * 0.2))}) di \`/credit\`.`
                        : '';
                    banner = {
                        type: 'danger',
                        text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) belum cukup untuk membeli **${res.vehicle.name}** (${formatLp(res.required)}).${creditHint}`
                    };
                } else {
                    banner = { type: 'danger', text: 'Gagal membeli kendaraan.' };
                }

                return await interaction.update(buildVehiclePanel({ state, selectedVehicleId: vehId, banner, now }));
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const vehId = interaction.values[0] || '';
                const state = await fetchVehicleState(interaction.user.id, now);
                return await interaction.update(buildVehiclePanel({ state, selectedVehicleId: vehId, now }));
            }
        }
    },

    buildVehiclePanel
};
