const { errorEmbed } = require('./ui');

function isSlashContext(context) {
    return typeof context?.isRepliable === 'function';
}

async function send(context, payload, options = {}) {
    const finalPayload = typeof payload === 'string' ? { content: payload } : payload;

    if (isSlashContext(context)) {
        const replyPayload = { ...finalPayload, ephemeral: options.ephemeral ?? finalPayload.ephemeral };

        if (context.replied || context.deferred) {
            return context.followUp(replyPayload);
        }

        return context.reply(replyPayload);
    }

    const { fetchReply, ephemeral, ...messagePayload } = finalPayload;
    return context.channel.send(messagePayload);
}

async function edit(context, message, payload) {
    if (isSlashContext(context)) {
        return context.editReply(payload);
    }

    return message.edit(payload);
}

async function sendError(context, user, message, options = {}) {
    const embed = errorEmbed('Action blocked', message, user);
    return send(context, { embeds: [embed] }, { ephemeral: options.ephemeral ?? true });
}

module.exports = {
    send,
    edit,
    sendError,
    isSlashContext
};
