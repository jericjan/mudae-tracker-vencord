/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const logger = new Logger("Mudae Tracker");

const settings = definePluginSettings({
    channelIds: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated list of Channel IDs to track (e.g. 12345678, 87654321)",
        name: "Tracked Channels",
    }
});

function onMessageCreate(action: any) {
    try {
        if (action.type !== "MESSAGE_CREATE") return;

        const trackedChannelsStr = settings.store.channelIds;
        if (!trackedChannelsStr) return;

        const allowedIds = trackedChannelsStr.split(",").map(id => id.trim());

        const { message } = action;
        if (!message) return;

        if (allowedIds.includes(message.channel_id)) {
            const content = message.content || "[No text content]";
            const author = message.author?.username || "Unknown Author";

            logger.info(`Roll/Message in ${message.channel_id} from ${author}: ${content}`);

            if (message.embeds && message.embeds.length > 0) {
                logger.info("Extracted Mudae Embed:", message.embeds[0]);
            }

        }
    } catch (error) {
        logger.error("Error processing message:", error);
    }
}

export default definePlugin({
    name: "Mudae Tracker",
    description: "Adds a little thing for tracking mudae claim ranks during rolls",
    authors: [{ name: "Kur0", id: 0n }],
    settings,
    start() {
        logger.info("Plugin started! Listening for Mudae rolls...");
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    },
    stop() {
        logger.info("Plugin stopped.");
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    }
});
