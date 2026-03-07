/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, NavigationRouter,SelectedChannelStore } from "@webpack/common";

const logger = new Logger("Mudae Tracker");

const settings = definePluginSettings({
    channelIds: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated list of Channel IDs to track (e.g. 12345678, 87654321)",
        name: "Tracked Channels",
    }
});

let trackedCharacters: {
    name: string;
    rank: number;
    messageId: string;
    channelId: string;
    guildId: string;
}[] = [];
let widget: HTMLDivElement | null = null;

function createWidget() {
    if (widget) return;

    widget = document.createElement("div");
    widget.id = "mudae-tracker-widget";
    widget.style.position = "fixed";
    widget.style.top = "60px";
    widget.style.right = "60px";
    widget.style.width = "280px";
    widget.style.backgroundColor = "#7d75fd47";
    widget.style.border = "1px solid var(--border-subtle)";
    widget.style.borderRadius = "8px";
    widget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
    widget.style.zIndex = "9999";
    widget.style.display = "none";

    const header = document.createElement("div");
    header.innerText = "Mudae Tracker";
    header.style.padding = "10px";
    header.style.cursor = "grab";
    header.style.fontWeight = "bold";
    header.style.borderTopLeftRadius = "8px";
    header.style.borderTopRightRadius = "8px";
    header.style.userSelect = "none";

    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    header.onmousedown = e => {
        isDragging = true;
        offsetX = e.clientX - widget!.offsetLeft;
        offsetY = e.clientY - widget!.offsetTop;
        header.style.cursor = "grabbing";
    };

    document.addEventListener("mousemove", e => {
        if (!isDragging || !widget) return;
        widget.style.left = `${e.clientX - offsetX}px`;
        widget.style.top = `${e.clientY - offsetY}px`;
        widget.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = "grab";
        }
    });

    const content = document.createElement("div");
    content.id = "mudae-tracker-content";
    content.style.padding = "10px";
    content.style.maxHeight = "350px";
    content.style.overflowY = "auto";

    const resetBtn = document.createElement("button");
    resetBtn.innerText = "Reset Rankings";
    resetBtn.style.width = "100%";
    resetBtn.style.padding = "6px";
    resetBtn.style.color = "white";
    resetBtn.style.backgroundColor = "#bf27276b";
    resetBtn.style.border = "none";
    resetBtn.style.borderRadius = "4px";
    resetBtn.style.cursor = "pointer";
    resetBtn.style.marginTop = "8px";
    resetBtn.onclick = () => {
        trackedCharacters = [];
        updateUI();
    };

    widget.appendChild(header);
    widget.appendChild(content);
    widget.appendChild(resetBtn);
    document.body.appendChild(widget);

    updateUI();
}

function updateUI() {
    if (!widget) return;
    const content = widget.querySelector("#mudae-tracker-content") as HTMLDivElement;
    if (!content) return;

    content.innerHTML = "";

    if (trackedCharacters.length === 0) {
        content.innerText = "No claims tracked yet. Roll some characters!";
        content.style.fontStyle = "italic";
        content.style.opacity = "0.7";
        return;
    }

    const bestRank = trackedCharacters[0].rank;

    trackedCharacters.forEach(char => {
        const percentage = (bestRank / char.rank) * 100;

        const item = document.createElement("div");
        item.style.cursor = "pointer";
        item.title = "Click to jump to message";
        item.onclick = () => {
            jumpToMessage(char.guildId, char.channelId, char.messageId);
        };

        item.style.position = "relative";
        item.style.marginBottom = "6px";
        item.style.padding = "6px 8px";
        item.style.borderRadius = "6px";
        item.style.overflow = "hidden";
        item.style.zIndex = "1";
        item.style.border = "1px solid var(--border-subtle)";

        const bg = document.createElement("div");
        bg.style.position = "absolute";
        bg.style.top = "0";
        bg.style.left = "0";
        bg.style.height = "100%";
        bg.style.width = `${percentage}%`;
        bg.style.backgroundColor = "rgba(88, 101, 242, 0.4)";
        bg.style.zIndex = "-1";
        bg.style.transition = "width 0.4s ease";

        const text = document.createElement("span");
        text.innerText = `#${char.rank} - ${char.name}`;
        text.style.fontWeight = "bold";
        text.style.fontSize = "14px";
        text.style.textShadow = "1px 1px 2px rgba(0,0,0,0.8)";

        item.appendChild(bg);
        item.appendChild(text);
        content.appendChild(item);
    });
}

function checkVisibility() {
    if (!widget) return;
    const currentChannelId = SelectedChannelStore.getChannelId();
    const allowedIds = settings.store.channelIds.split(",").map(id => id.trim());

    if (currentChannelId && allowedIds.includes(currentChannelId)) {
        widget.style.display = "block";
    } else {
        widget.style.display = "none";
    }
}

function jumpToMessage(guildId: string, channelId: string, messageId: string) {
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}/${messageId}`);
}

function onMessageCreate(action: any) {
    try {
        if (action.type !== "MESSAGE_CREATE") return;

        const allowedIds = settings.store.channelIds.split(",").map(id => id.trim());
        const { message } = action;
        if (!message || !allowedIds.includes(message.channel_id)) return;

        const embed = message.embeds?.[0];
        if (!embed || !embed.description) return;
        // logger.info("Embed:", embed);
        const rankMatch = embed.description.match(/(?:Claim Rank:|Claims:)\s*#([0-9,]+)/i);
        const footer = embed.footer?.text;
        if (footer?.includes("Belongs to")) return;

        if (rankMatch) {
            const rankValue = parseInt(rankMatch[1].replace(/,/g, ""), 10);

            const charName = embed.author?.name || "Unknown Character";
            const guildId = message.guild_id;
            const channelId = message.channel_id;
            const messageId = message.id;
            trackedCharacters.push({
                name: charName,
                rank: rankValue,
                messageId,
                channelId,
                guildId
            });

            trackedCharacters.sort((a, b) => a.rank - b.rank);

            logger.info(`Tracked ${charName} at Rank #${rankValue}`);
            updateUI();
        }
    } catch (error) {
        logger.error("Error processing message:", error);
    }
}

export default definePlugin({
    name: "Mudae Tracker",
    description: "Adds a draggable pop-up for tracking Mudae claim ranks during rolls",
    authors: [{ name: "Kur0", id: 0n }],
    settings,
    start() {
        logger.info("Starting Mudae Tracker...");
        createWidget();

        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("CHANNEL_SELECT", checkVisibility);

        checkVisibility();
    },
    stop() {
        logger.info("Stopping Mudae Tracker.");

        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", checkVisibility);

        if (widget) {
            widget.remove();
            widget = null;
        }
        trackedCharacters = [];
    }
});
