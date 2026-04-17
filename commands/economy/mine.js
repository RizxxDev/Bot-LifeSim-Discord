const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'mine',
    aliases: ['mining', 'nambang'],
    prefix: true,
    slash: true,
    cooldown: 5, // Cooldown awal saja, karena game ini butuh waktu untuk diselesaikan
    data: new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Mulai sesi penambangan interaktif!'),

    async executeSlash(interaction) {
        await handleInteractiveMine(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleInteractiveMine(message, message.author, false);
    }
};

async function handleInteractiveMine(context, user, isSlash) {
    const userId = user.id;

    try {
        // 1. Cek Pickaxe di Inventory
        const inventory = await db.query('SELECT item_id FROM inventory WHERE user_id = ? AND item_id IN ("pickaxe", "gpick") AND amount > 0', [userId]);
        
        let pickType = 'none';
        let pickName = '';
        
        // Cek pickaxe terbaik yang dimiliki
        if (inventory.some(i => i.item_id === 'gpick')) {
            pickType = 'gpick';
            pickName = 'Golden Pickaxe';
        } else if (inventory.some(i => i.item_id === 'pickaxe')) {
            pickType = 'pickaxe';
            pickName = 'Normal Pickaxe';
        }

        if (pickType === 'none') {
            const msg = `❌ **${user.username}**, kamu tidak memiliki beliung! Beli \`pickaxe\` atau \`gpick\` terlebih dahulu.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        // 2. Setup Pesan Awal (Mirip BDScript Lmine awal)
        const oreList = pickType === 'gpick' 
            ? '- Rock\n- Coal Ore\n- Copper Ore\n- Iron Ore\n- Gold Ore\n- Diamond Ore'
            : '- Rock\n- Coal Ore\n- Copper Ore\n- Iron Ore';

        const embed = new EmbedBuilder()
            .setColor('#ffa601')
            .setTitle('⛏️ MINING')
            .setDescription(`🧰 **Your Pickaxe**\n> **Type:** \`${pickName}\`\n> **Effect:** _None_\n\n━━━━━━━━━━━━━━\n\n⛰️ **Mining Area**\n> Mine random ores by pressing the button\n> Better pickaxe = better luck\n\n💎 **Ore available for mining**\n${oreList}\n\n━━━━━━━━━━━━━━\n⚠️ *Mining consumes durability*`);

        const startButton = new ButtonBuilder()
            .setCustomId('start_mine')
            .setLabel('Start Mining')
            .setEmoji('⛏️')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(startButton);

        // Kirim pesan
        const response = isSlash 
            ? await context.reply({ embeds: [embed], components: [row], fetchReply: true }) 
            : await context.channel.send({ embeds: [embed], components: [row] });

        // 3. Setup Collector (Pengganti $onInteraction)
        // Collector ini akan mendengarkan klik tombol selama 60 detik
        const collector = response.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 60000,
            filter: i => i.user.id === userId // Hanya pemanggil command yang bisa klik
        });

        // Variabel Status In-Memory (Pengganti setVar/getVar BDFD)
        let currentOre = null;
        let hp = 0;
        let maxHp = 0;

        collector.on('collect', async (interaction) => {
            // Mencegah status "This interaction failed"
            await interaction.deferUpdate();

            // ==========================================
            // TOMBOL: START MINING ($customID==mine)
            // ==========================================
            if (interaction.customId === 'start_mine') {
                const oreOptions = pickType === 'gpick' 
                    ? ['rock', 'coal', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore']
                    : ['rock', 'coal', 'iron_ore', 'copper_ore'];
                
                currentOre = getRandomOre(oreOptions);

                // Set HP & Rarity
                if (currentOre === 'rock') { hp = maxHp = randomInt(10, 25); }
                else if (currentOre === 'copper_ore') { hp = maxHp = randomInt(15, 27); }
                else if (currentOre === 'coal') { hp = maxHp = randomInt(20, 30); }
                else if (currentOre === 'iron_ore') { hp = maxHp = randomInt(30, 40); }
                else if (currentOre === 'gold_ore') { hp = maxHp = randomInt(40, 55); }
                else if (currentOre === 'diamond_ore') { hp = maxHp = randomInt(55, 75); }

                const oreData = getOreDetails(currentOre);

                const hitEmbed = new EmbedBuilder()
                    .setColor('#ffa601')
                    .setTitle('⛏️ Mining Session ⛏️')
                    .setDescription(`### 🪨 Ore Information\n> **Name Ore** : **${oreData.name}**\n> **Rarity** : **${oreData.rarity}**\n> **HP** : \`${hp}\` / \`${maxHp}\`\n---\n### ⚡ Miner Status\n> **User** : <@${userId}>\n> **Pickaxe Durability** : `)
                    .setFooter({ text: 'Keep mining to break the ore!' });

                const hitButton = new ButtonBuilder().setCustomId('hit_mine').setLabel('Mining...').setEmoji('⛏️').setStyle(ButtonStyle.Primary);
                await interaction.editReply({ embeds: [hitEmbed], components: [new ActionRowBuilder().addComponents(hitButton)] });
            }

            // ==========================================
            // TOMBOL: HIT ORE ($customID==minestart / mineend)
            // ==========================================
            else if (interaction.customId === 'hit_mine') {
                // Kalkulasi Damage
                const damage = pickType === 'gpick' ? randomInt(7, 15) : randomInt(3, 10);
                hp = Math.max(0, hp - damage); // HP tidak boleh minus

                const oreData = getOreDetails(currentOre);

                // JIKA BATU BELUM HANCUR
                if (hp > 0) {
                    const hitEmbed = new EmbedBuilder()
                        .setColor('#ffa601')
                        .setTitle('⛏️ Mining Session ⛏️')
                        .setDescription(`### 🪨 Ore Information\n> **Name Ore** : **${oreData.name}**\n> **Rarity** : **${oreData.rarity}**\n> **HP** : \`${hp}\` / \`${maxHp}\`\n---\n### ⚡ Miner Status\n> **User** : <@${userId}>\n> **Pickaxe Durability** : `);
                    
                    const hitButton = new ButtonBuilder().setCustomId('hit_mine').setLabel('Mining...').setEmoji('⛏️').setStyle(ButtonStyle.Primary);
                    await interaction.editReply({ embeds: [hitEmbed], components: [new ActionRowBuilder().addComponents(hitButton)] });
                } 
                
                // JIKA BATU HANCUR (MINE END)
                else {
                    collector.stop('broken'); // Hentikan collector
                    
                    // Kalkulasi Hadiah
                    const rewardAmt = currentOre === 'rock' || currentOre === 'coal' || currentOre === 'copper_ore' ? randomInt(1, 3) : randomInt(2, 5);
                    const isDouble = Math.random() < 0.5; // 50% Chance Double Drop
                    
                    let extraItem = '';
                    let extraAmt = 0;

                    if (isDouble) {
                        extraAmt = randomInt(1, 3);
                        extraItem = currentOre === 'rock' ? getRandomOre(['gold_ore', 'coal']) : getRandomOre(['rock', 'coal']);
                    }

                    // Masukkan ke Database
                    const trx = await db.startTransaction();
                    try {
                        await trx.query('INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, currentOre, rewardAmt, rewardAmt]);
                        
                        let extraText = '';
                        if (isDouble && extraItem) {
                            await trx.query('INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, extraItem, extraAmt, extraAmt]);
                            extraText = `\n- ${extraAmt}x ${getOreDetails(extraItem).name}`;
                        }
                        await trx.commit();

                        const rewardEmbed = new EmbedBuilder()
                            .setColor('#ffa601')
                            .setTitle('📥 Collect Item')
                            .setDescription(`You Got Item from **${oreData.name}**\n- ${rewardAmt}x ${oreData.name}${extraText}`);

                        // Matikan tombol
                        const disabledButton = new ButtonBuilder().setCustomId('done').setLabel('Finished').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true);
                        await interaction.editReply({ embeds: [rewardEmbed], components: [new ActionRowBuilder().addComponents(disabledButton)] });

                    } catch (err) {
                        await trx.rollback();
                        console.error('[MINING DB ERROR]', err);
                        await interaction.editReply({ content: '❌ Terjadi kesalahan saat menyimpan item.', embeds: [], components: [] });
                    }
                }
            }
        });

        // Jika waktu habis (60 detik) dan batu belum hancur
        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                const timeoutEmbed = new EmbedBuilder().setColor('#E74C3C').setDescription('⏱️ Waktu menambang telah habis! Batu tersebut terlalu keras untuk dihancurkan tepat waktu.');
                response.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
            }
        });

    } catch (error) {
        console.error('[MINE SYSTEM ERROR]', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan sistem.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}

// ==========================================
// FUNGSI UTILITAS
// ==========================================
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomOre(oreArray) {
    return oreArray[Math.floor(Math.random() * oreArray.length)];
}

function getOreDetails(oreId) {
    switch (oreId) {
        case 'rock': return { name: 'Rock', rarity: 'COMMON' };
        case 'coal': return { name: 'Coal Ore', rarity: 'COMMON' };
        case 'copper_ore': return { name: 'Copper Ore', rarity: 'UNCOMMON' };
        case 'iron_ore': return { name: 'Iron Ore', rarity: 'RARE' };
        case 'gold_ore': return { name: 'Gold Ore', rarity: 'EPIC' };
        case 'diamond_ore': return { name: 'Diamond Ore', rarity: 'LEGENDARY' };
        default: return { name: 'Unknown Ore', rarity: 'COMMON' };
    }
}