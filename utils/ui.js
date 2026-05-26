const { EmbedBuilder } = require('discord.js');

const colors = {
    primary: 0x2F80ED,
    success: 0x27AE60,
    warning: 0xF2C94C,
    danger: 0xEB5757,
    muted: 0x2B2D31,
    money: 0x00B894,
    farm: 0x6FCF97,
    craft: 0xF2994A,
    market: 0xF2C94C,
    inventory: 0x9B51E0
};

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function formatMoney(value) {
    return `Lp ${formatNumber(value)}`;
}

function formatPercent(value) {
    return `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
}

function progressBar(current, max, size = 10) {
    const safeMax = Math.max(1, Number(max || 1));
    const ratio = Math.max(0, Math.min(1, Number(current || 0) / safeMax));
    const filled = Math.round(ratio * size);
    return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${formatNumber(current)} / ${formatNumber(max)}`;
}

function baseEmbed({ title, description, color = colors.primary, user } = {}) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (user) {
        embed.setFooter({
            text: `Requested by ${user.username}`,
            iconURL: user.displayAvatarURL({ dynamic: true })
        });
    }

    return embed;
}

function successEmbed(title, description, user) {
    return baseEmbed({ title, description, user, color: colors.success });
}

function errorEmbed(title, description, user) {
    return baseEmbed({ title, description, user, color: colors.danger });
}

function infoEmbed(title, description, user) {
    return baseEmbed({ title, description, user, color: colors.primary });
}

module.exports = {
    colors,
    formatNumber,
    formatMoney,
    formatPercent,
    progressBar,
    baseEmbed,
    successEmbed,
    errorEmbed,
    infoEmbed
};
