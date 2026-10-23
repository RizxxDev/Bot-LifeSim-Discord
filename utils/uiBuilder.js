const {
    ContainerBuilder,
    SectionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');
const { BRANDING, USERNAME_BLACKLIST } = require('../data/constants');

const COLORS = {
    PRIMARY: 0x2F80ED,
    SUCCESS: 0x27AE60,
    WARNING: 0xF2994A,
    DANGER:  0xEB5757,
    LIFE:    0x2D9CDB,
    CAREER:  0x9B51E0,
    ACT:     0x219653,
    ECONOMY: 0xF2C94C,
    ADMIN:   0x333333
};

function formatLp(amount) {
    const num = Math.round(Number(amount || 0));
    return `${BRANDING.CURRENCY_SYMBOL} ${num.toLocaleString('id-ID')}`;
}

function renderBar(current, max = 100, length = 8) {
    const clamped = Math.max(0, Math.min(max, Number(current || 0)));
    const filled = Math.round((clamped / max) * length);
    const empty = Math.max(0, length - filled);
    return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${Math.round(clamped)}/${max}`;
}

function formatDuration(ms) {
    const totalSec = Math.max(1, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}j`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 && hours === 0) parts.push(`${secs}d`);
    return parts.join(' ') || '0d';
}

function formatVitalsCompact(player) {
    return [
        `⚡ **${Math.round(player.energy)}**`,
        `🍔 **${Math.round(player.hunger)}**`,
        `💧 **${Math.round(player.thirst)}**`,
        `❤️ **${Math.round(player.health)}**`
    ].join(' · ');
}

/**
 * Membangun payload pesan berbasis Discord Components V2 (ContainerBuilder).
 * @param {object} options
 * @param {number} [options.accentColor]
 * @param {string} [options.title]
 * @param {Array<string|{text: string, button?: ButtonBuilder}>} [options.blocks]
 * @param {Array<ActionRowBuilder>} [options.actionRows]
 * @param {string} [options.footer]
 * @param {boolean} [options.ephemeral]
 */
function buildV2Card({
    accentColor = COLORS.PRIMARY,
    title = null,
    blocks = [],
    actionRows = [],
    footer = null,
    ephemeral = false
}) {
    const container = new ContainerBuilder().setAccentColor(accentColor);

    if (title) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}`)
        );
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
    }

    blocks.forEach((block, idx) => {
        if (!block) return;
        if (typeof block === 'string') {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
        } else if (block.divider) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
        } else if (block.text && block.button) {
            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text))
                .setButtonAccessory(block.button);
            container.addSectionComponents(section);
        } else if (block.text) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.text));
        }

        if (idx < blocks.length - 1 && block.separatorAfter) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
        }
    });

    if (actionRows && actionRows.length > 0) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        for (const row of actionRows) {
            container.addActionRowComponents(row);
        }
    }

    if (footer) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${footer}`)
        );
    }

    let flags = MessageFlags.IsComponentsV2;
    if (ephemeral) {
        flags |= MessageFlags.Ephemeral;
    }

    return {
        components: [container],
        flags
    };
}

function normalizeForBlacklist(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/_/g, '');
}

function validateUsername(rawName) {
    const trimmed = String(rawName || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
        return {
            valid: false,
            reason: 'Username harus terdiri dari **3–16 karakter** dan hanya boleh menggunakan **huruf, angka, atau underscore (`_`)** tanpa spasi.'
        };
    }

    const normalized = normalizeForBlacklist(trimmed);
    for (const word of USERNAME_BLACKLIST) {
        if (normalized.includes(word)) {
            return {
                valid: false,
                reason: `Username mengandung kata terlarang atau nama sistem yang tidak diizinkan.`
            };
        }
    }

    return {
        valid: true,
        username: trimmed,
        usernameLower: trimmed.toLowerCase()
    };
}

module.exports = {
    COLORS,
    formatLp,
    renderBar,
    formatDuration,
    formatVitalsCompact,
    buildV2Card,
    validateUsername
};
