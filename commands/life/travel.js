const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const {
    DEFAULT_CITY_ID,
    getCity,
    getAllCities,
    calculateCityRoute,
    calculateTravelVitalCost
} = require('../../data/cities');
const { calculateIntercityFuelNeeded } = require('../../data/vehicles');
const { getItem } = require('../../data/items');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getEquippedVehicle, getPlayerVehicles } = require('../../services/vehicleService');
const { getPlayerInventory } = require('../../services/inventoryService');
const {
    renderLinearMapText,
    hasOwnedItem,
    validateTravelAttempt,
    executeStartTravel
} = require('../../services/cityService');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');

function buildHighwayProgressBar(origCity, destCity, ratio, vehicleEmoji = '🚗') {
    const slots = 10;
    const clamped = Math.max(0, Math.min(1, Number(ratio || 0)));
    const pos = Math.min(slots - 1, Math.floor(clamped * slots));
    let track = '';
    for (let i = 0; i < slots; i++) {
        if (i < pos) track += '═';
        else if (i === pos) track += vehicleEmoji;
        else track += '─';
    }
    const pct = Math.round(clamped * 100);
    return `[${origCity.emoji} ${origCity.shortName}] ${track}► [${destCity.emoji} ${destCity.shortName}] **(${pct}%)**`;
}

async function fetchTravelState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const equipped = await getEquippedVehicle(conn, discordId, false, now);
        const ownedVehicles = await getPlayerVehicles(conn, discordId, false, now);
        const invRows = await getPlayerInventory(conn, discordId, false, 'all', now);
        return {
            player: synced.player,
            events: synced.events || {},
            equipped,
            ownedVehicles,
            invRows
        };
    });
}

function buildTravelPanel({
    state,
    selectedDestId = null,
    hireDriverTrip = false,
    banner = null,
    now = Date.now()
}) {
    const { player: p, events = {}, equipped, invRows = [] } = state;
    const ownerId = p.discord_id;

    let effectiveBanner = banner;
    if (!effectiveBanner && events.arrivedCity) {
        const arrCity = getCity(events.arrivedCity);
        effectiveBanner = {
            type: 'success',
            text: `🎉 Selamat datang di **${arrCity.emoji} ${arrCity.name}**! Kamu telah tiba di kota tujuan dengan selamat.`
        };
    }

    // =========================================================================
    // MODE 1: SEDANG DALAM PERJALANAN ANTAR-KOTA
    // =========================================================================
    if (Number(p.traveling_until || 0) > now) {
        const orig = getCity(p.travel_origin || p.current_city || DEFAULT_CITY_ID);
        const dest = getCity(p.travel_destination || DEFAULT_CITY_ID);
        const route = calculateCityRoute(orig.id, dest.id);
        const totalMs = route ? route.durationMs : 60000;
        const remMs = Math.max(0, Number(p.traveling_until) - now);
        const ratio = Math.max(0, Math.min(1, 1 - remMs / totalMs));
        const arriveUnix = Math.floor(Number(p.traveling_until) / 1000);
        const hasDriver = Number(p.travel_has_driver || 0) === 1;
        const vehObj = equipped?.vehicle || null;
        const vehIcon = vehObj ? vehObj.emoji : (hasDriver ? '🚘' : '🚗');

        const modeLines = hasDriver
            ? [
                `👨‍✈️ **Mode Perjalanan:** Disopiri Supir Pribadi *(Kursi Penumpang)*`,
                `🛡️ **Stat Vital Aman:** **0** pengurangan Energy, Hunger, & Thirst`,
                `📱 **Akses Selama di Mobil:** \`/consume\`, \`/profile\`, \`/wardrobe\`, \`/inventory\``
            ]
            : [
                `🛵 **Mode Perjalanan:** Mengemudi Sendiri`,
                `⚠️ **Fokus Berkendara:** Perintah aktivitas lain dikunci sampai tiba di tujuan`
            ];

        const blocks = [
            [
                `🛣️ **Rute Perjalanan Aktif (${route ? route.distanceKm : 0} km)**${route?.passesCentral ? ' · *Lintas Langsung via Tol Sentral*' : ''}`,
                buildHighwayProgressBar(orig, dest, ratio, vehIcon),
                `⏱️ **Estimasi Tiba:** <t:${arriveUnix}:R> (<t:${arriveUnix}:T>)`
            ].join('\n'),
            [
                vehObj
                    ? `🚘 **Kendaraan:** ${vehObj.emoji} **${vehObj.name}** *(Sisa BBM: ${Number(equipped.fuel_liters || 0).toFixed(2)}/${vehObj.tankCapacity} L)*`
                    : `🚘 **Kendaraan:** Aktif`,
                ...modeLines
            ].join('\n'),
            [
                `🏙️ **Fasilitas Menantimu di ${dest.emoji} ${dest.name}:**`,
                ...dest.highlights.map(h => `• ${h}`)
            ].join('\n')
        ];

        const rowButtons = [
            btn('travel', 'home', ownerId, {
                label: 'Segarkan Status Ketibaan',
                emoji: '🔄',
                style: ButtonStyle.Primary
            }, now)
        ];

        if (hasDriver) {
            rowButtons.push(
                btn('consume', 'home', ownerId, {
                    label: 'Makan / Minum',
                    emoji: '🍱',
                    style: ButtonStyle.Success
                }, now)
            );
        }

        return buildPanel({
            mod: 'travel',
            ownerId,
            accentColor: COLORS.WARNING,
            title: `🚗 Perjalanan Menuju ${dest.name}`,
            player: p,
            banner: effectiveBanner,
            blocks,
            rows: [new ActionRowBuilder().addComponents(rowButtons)],
            footer: 'Klik Segarkan Status Ketibaan setelah hitung mundur selesai untuk langsung beraktivitas di kota baru.',
            now
        });
    }

    // =========================================================================
    // MODE 2: TERMINAL & PETA ANTAR-KOTA (SIAP BERANGKAT)
    // =========================================================================
    const currentCity = getCity(p.current_city || DEFAULT_CITY_ID);
    const destinations = getAllCities().filter(c => c.id !== currentCity.id);
    const activeDest = (selectedDestId && destinations.find(c => c.id === selectedDestId)) || destinations[0];
    const route = calculateCityRoute(currentCity.id, activeDest.id);

    const vehObj = equipped?.vehicle || null;
    const hasWeeklyContract = Boolean(
        vehObj?.supportsDriver &&
        (equipped?.hasActiveDriverContract || Number(equipped?.driver_hired_until || 0) > now)
    );
    const effectiveHireTrip = Boolean(vehObj?.supportsDriver && !hasWeeklyContract && hireDriverTrip);

    const validation = validateTravelAttempt({
        player: p,
        equippedVehicleRow: equipped,
        invRows,
        toCityId: activeDest.id,
        hireDriverTrip: effectiveHireTrip,
        now
    });

    // Blok 1: Peta Linear & Kota Sekarang
    const mapBlock = [
        `🗺️ **Peta Jalur Tol 3 Kota:**`,
        renderLinearMapText({ currentCityId: currentCity.id }),
        ``,
        `📍 **Lokasimu Sekarang:** ${currentCity.emoji} **${currentCity.name}** *(${currentCity.positionLabel})*`,
        ...currentCity.highlights.map(h => `   ${h}`)
    ].join('\n');

    // Blok 2: Status Kendaraan & SIM
    let vehicleBlock = '';
    if (!equipped || !vehObj) {
        vehicleBlock = [
            `🚘 **Kendaraan Keberangkatan:** ❌ *Belum ada kendaraan aktif*`,
            `   └ Beli atau pasang motor/mobil terlebih dahulu melalui \`/vehicle\` untuk bepergian antar-kota.`
        ].join('\n');
    } else {
        const licItem = vehObj.reqLicenseItem ? getItem(vehObj.reqLicenseItem) : null;
        const ownsLic = vehObj.reqLicenseItem ? hasOwnedItem(invRows, vehObj.reqLicenseItem) : true;
        const licBadge = !vehObj.reqLicenseItem
            ? '⚪ *Tanpa SIM*'
            : ownsLic
                ? `✅ **${licItem ? licItem.name : vehObj.reqLicenseItem} Aktif**`
                : `❌ **Belum Punya ${licItem ? licItem.name : vehObj.reqLicenseItem}** *(Beli di \`/shop\` Layanan)*`;

        const fuelBadge = vehObj.tankCapacity > 0
            ? `⛽ BBM: **${Number(equipped.fuel_liters || 0).toFixed(2)} / ${vehObj.tankCapacity} L**`
            : `🚲 *Tenaga Kayuh (Dilarang Masuk Tol Antar-Kota)*`;

        const driverContractLine = vehObj.supportsDriver
            ? (hasWeeklyContract
                ? `\n   └ 👨‍✈️ **Kontrak Supir Mingguan Aktif:** Berakhir <t:${Math.floor(Number(equipped.driver_hired_until) / 1000)}:R> *(Gratis ongkos supir!)*`
                : `\n   └ 👨‍✈️ **Supir Mobil:** Tersedia disewa per rute (**+${formatLp(route.driverFareLp)}**) atau kontrak 7 hari di \`/vehicle\``)
            : '';

        vehicleBlock = [
            `🚘 **Kendaraan Aktif:** ${vehObj.emoji} **${vehObj.name}** · ${licBadge}`,
            `   └ ${fuelBadge} · 🛣️ Odometer: **${Number(equipped.odometer_km || 0).toFixed(1)} km**${driverContractLine}`
        ].join('\n');
    }

    // Blok 3: Pratinjau Rute ke Kota Tujuan
    const fuelNeeded = vehObj ? calculateIntercityFuelNeeded(vehObj, route.distanceKm) : 0;
    const effectiveWithDriver = Boolean(vehObj?.supportsDriver && (hasWeeklyContract || effectiveHireTrip));
    const vitalCost = calculateTravelVitalCost(route.distanceKm, effectiveWithDriver);

    const fuelPreview = !vehObj
        ? '*Pilih kendaraan bermotor di `/vehicle`*'
        : !vehObj.canIntercityTravel
            ? '❌ *Sepeda tidak dapat dipakai antar-kota*'
            : `**${fuelNeeded.toFixed(2)} L** *(Sisa tangki: ${Number(equipped.fuel_liters || 0).toFixed(2)} L)*`;

    const vitalPreview = effectiveWithDriver
        ? `✨ **0 Energy · 0 Hunger · 0 Thirst** *(Disopiri Supir + Bebas akses \`/consume\`, \`/profile\`, \`/wardrobe\`, \`/inventory\`)*`
        : `⚡ **-${vitalCost.energy} Energy** · 🍔 **-${vitalCost.hunger} Hunger** · 💧 **-${vitalCost.thirst} Thirst**`;

    const driverPreview = hasWeeklyContract
        ? `👨‍✈️ **Supir Kontrak Mingguan (Gratis)**`
        : effectiveHireTrip
            ? `👨‍✈️ **Sewa Supir Sekali Jalan (+${formatLp(route.driverFareLp)})**`
            : `🛵 **Mengemudi Sendiri (Rp 0)**`;

    const readinessLine = validation.ok
        ? `🟢 **Status Rute:** Siap berangkat sekarang!`
        : `🔴 **Belum Bisa Berangkat:** ${validation.message}`;

    const routeBlock = [
        `🎯 **Rencana Rute: ${currentCity.emoji} ${currentCity.shortName} ──► ${activeDest.emoji} ${activeDest.name}**`,
        `• 📏 Jarak & Waktu : **${route.distanceKm} km** · **${route.durationSec} detik**${route.passesCentral ? ' *(Langsung tanpa transit manual di Metropolis Sentral)*' : ''}`,
        `• ⛽ Kebutuhan BBM : ${fuelPreview}`,
        `• 🚘 Mode Kemudi   : ${driverPreview}`,
        `• ❤️ Dampak Stat   : ${vitalPreview}`,
        `• 🏛️ Keunggulan    : ${activeDest.tagline}`,
        readinessLine
    ].join('\n');

    const rows = [
        select('travel', 'pick_dest', ownerId, {
            placeholder: '🗺️ Pilih kota tujuan perjalanan...',
            arg: effectiveHireTrip ? '1' : '0',
            options: destinations.map(d => {
                const r = calculateCityRoute(currentCity.id, d.id);
                return {
                    label: `${d.name} (${r.distanceKm} km · ${r.durationSec} detik)`,
                    value: d.id,
                    emoji: d.emoji,
                    description: d.tagline.slice(0, 95),
                    default: d.id === activeDest.id
                };
            })
        }, now)
    ];

    const actionButtons = [
        btn('travel', 'depart', ownerId, {
            label: `Berangkat ke ${activeDest.shortName}`,
            emoji: '🚗',
            style: ButtonStyle.Success,
            arg: `${activeDest.id}:${effectiveHireTrip ? 1 : 0}`,
            disabled: !validation.ok
        }, now)
    ];

    if (vehObj?.supportsDriver && !hasWeeklyContract) {
        actionButtons.push(
            btn('travel', 'toggle_driver', ownerId, {
                label: effectiveHireTrip
                    ? `Pakai Supir (+${formatLp(route.driverFareLp)})`
                    : `Sewa Supir (+${formatLp(route.driverFareLp)})`,
                emoji: effectiveHireTrip ? '✅' : '👨‍✈️',
                style: effectiveHireTrip ? ButtonStyle.Primary : ButtonStyle.Secondary,
                arg: `${activeDest.id}:${effectiveHireTrip ? 0 : 1}`
            }, now)
        );
    }

    actionButtons.push(
        btn('vehicle', 'home', ownerId, {
            label: 'Garasi & BBM',
            emoji: '⛽',
            style: ButtonStyle.Secondary
        }, now),
        btn('travel', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(actionButtons.slice(0, 5)));

    return buildPanel({
        mod: 'travel',
        ownerId,
        accentColor: validation.ok ? COLORS.PRIMARY : COLORS.WARNING,
        title: `🗺️ Terminal & Jalan Tol Antar-Kota`,
        player: p,
        banner: effectiveBanner,
        blocks: [mapBlock, vehicleBlock, routeBlock],
        rows,
        footer: 'Gunakan mobil + Supir agar bebas lelah (0 pengurangan stat) & tetap bisa membuka /consume dan /profile di jalan!',
        now
    });
}

module.exports = {
    name: 'travel',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('travel')
        .setDescription('Jelajahi peta 3 kota, cek rute & bensin kendaraan, sewa supir, dan mulai perjalanan.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchTravelState(interaction.user.id, now);
        return await interaction.reply(buildTravelPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchTravelState(interaction.user.id, now);
                return await interaction.update({ ...buildTravelPanel({ state, now }), attachments: [] });
            },
            async pick_dest_btn(interaction, parsed) {
                const now = Date.now();
                const destId = parsed.arg || null;
                const state = await fetchTravelState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTravelPanel({ state, selectedDestId: destId, now }),
                    attachments: []
                });
            },
            async toggle_driver(interaction, parsed) {
                const now = Date.now();
                const [destId, driverFlag] = String(parsed.arg || '').split(':');
                const hireDriverTrip = driverFlag === '1';
                const state = await fetchTravelState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTravelPanel({ state, selectedDestId: destId || null, hireDriverTrip, now }),
                    attachments: []
                });
            },
            async depart(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const [destId, driverFlag] = String(parsed.arg || '').split(':');
                const hireDriverTrip = driverFlag === '1';

                const res = await executeStartTravel(userId, destId, hireDriverTrip, now);
                const state = await fetchTravelState(userId, now);

                if (!res.ok) {
                    return await interaction.update({
                        ...buildTravelPanel({
                            state,
                            selectedDestId: destId || null,
                            hireDriverTrip,
                            banner: { type: 'danger', text: res.message || 'Gagal memulai perjalanan.' },
                            now
                        }),
                        attachments: []
                    });
                }

                const feeNote = res.driverFeeToPay > 0 ? ` (Ongkos Supir **${formatLp(res.driverFeeToPay)}**)` : '';
                const banner = {
                    type: 'success',
                    text: `🚗 Berangkat menuju **${res.toCity.emoji} ${res.toCity.name}** sejauh **${res.route.distanceKm} km** menggunakan **${res.vehicle.emoji} ${res.vehicle.name}** (-${res.fuelNeeded.toFixed(2)} L BBM)${feeNote}!`
                };

                return await interaction.update({
                    ...buildTravelPanel({ state, banner, now }),
                    attachments: []
                });
            }
        },
        selects: {
            async pick_dest(interaction, parsed) {
                const now = Date.now();
                const destId = interaction.values[0] || null;
                const hireDriverTrip = parsed.arg === '1';
                const state = await fetchTravelState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTravelPanel({ state, selectedDestId: destId, hireDriverTrip, now }),
                    attachments: []
                });
            }
        }
    },

    fetchTravelState,
    buildTravelPanel
};
