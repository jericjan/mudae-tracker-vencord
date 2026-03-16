/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, NavigationRouter, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("Mudae Tracker");

const settings = definePluginSettings({
    channelIds: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated list of Channel IDs to track (e.g. 12345678, 87654321)",
        name: "Tracked Channels",
    },
    reactTimeouts: {
        type: OptionType.STRING,
        default: "",
        description: "Per-server timeouts in seconds. Format: GuildID:Seconds (e.g. 12345678:30, 87654321:60). Default is 45s.",
        name: "React Timeouts",
    }
});

const headerTxt = "Mudae Tracker";

let trackedCharacters: {
    name: string;
    rank: number;
    messageId: string;
    channelId: string;
    guildId: string;
    emojiUrls: string[];
    claimed: boolean;
    expiresAt: number;
}[] = [];
let widget: HTMLDivElement | null = null;

let knownRanks: Record<string, number> = {};

let currentPower: number = -1;
let powerUsage: number = -1;

let uiInterval: NodeJS.Timeout | null = null;

function getTimeoutSecs(guildId: string, hasInteraction: boolean): number {
    let timeout = 45;
    const rawSettings = settings.store.reactTimeouts || "";
    
    if (rawSettings) {
        const pairs = rawSettings.split(",").map(s => s.trim());
        for (const pair of pairs) {
            const[id, val] = pair.split(":");
            if (id === guildId && val) {
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed)) timeout = parsed;
                break;
            }
        }
    }

    return hasInteraction ? timeout * 2 : timeout;
}

function createWidget() {
    if (widget) return;

    widget = document.createElement("div");
    widget.id = "mudae-tracker-widget";
    widget.style.position = "fixed";
    widget.style.top = "60px";
    widget.style.right = "60px";
    widget.style.width = "280px";
    widget.style.backgroundColor = "rgba(170, 217, 255, 0.75)";
    widget.style.borderRadius = "0px 0px 8px 8px";
    widget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.3)";
    widget.style.zIndex = "9999";
    widget.style.display = "none";

    const header = document.createElement("div");
    header.id = "mudae-tracker-header";
    header.innerText = headerTxt;
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
    resetBtn.innerText = "Clear All";
    resetBtn.style.width = "100%";
    resetBtn.style.padding = "6px";
    resetBtn.style.color = "white";
    resetBtn.style.backgroundColor = "rgba(113,12,20,0.75)";
    resetBtn.style.border = "none";
    resetBtn.style.borderRadius = "4px";
    resetBtn.style.cursor = "pointer";
    resetBtn.style.marginTop = "8px";
    resetBtn.onclick = () => {
        trackedCharacters = [];
        knownRanks = {};     
        currentPower = -1;
        powerUsage = -1;           
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
    const header =  widget.querySelector("#mudae-tracker-header") as HTMLDivElement;
    if (!header) return;

    if (powerUsage != -1 && currentPower != -1) {
        const reactCount = Math.floor(currentPower / powerUsage);
        header.textContent  = headerTxt + ` | ${reactCount} reacts`;
    } else {
        header.textContent  = headerTxt;
    }

    content.innerHTML = "";

    if (trackedCharacters.length === 0) {
        content.innerText = "No claims tracked yet. Roll some characters!";
        content.style.fontStyle = "italic";
        content.style.opacity = "0.7";
        return;
    }

    const knownRankChars = trackedCharacters.filter(c => c.rank > 0 && !c.claimed);
    const bestRank = knownRankChars.length > 0 ? knownRankChars[0].rank : 0;

    trackedCharacters.forEach(char => {
        let percentage = 0;
        if (char.rank > 0 && bestRank > 0 && !char.claimed) {
            percentage = (bestRank / char.rank) * 100;
        }

        const item = document.createElement("div");
        item.style.cursor = "pointer";
        item.title = "Click to jump to message";
        item.onclick = () => {
            jumpToMessage(char.guildId, char.channelId, char.messageId);
        };

        item.style.display = "flex";
        item.style.justifyContent = "space-between";
        item.style.alignItems = "center";
        
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
        bg.style.backgroundColor = "rgb(182 224 255)";
        bg.style.zIndex = "-1";
        bg.style.transition = "width 0.4s ease";

        const text = document.createElement("span");
        
        text.id = `mudae-text-${char.messageId}`;
        text.style.fontWeight = "bold";
        text.style.fontSize = "14px";
        text.style.textShadow = "1px 1px 2px rgba(0,0,0,0.8)";
        
        if (char.rank === 0) {
            text.style.opacity = "0.7";
            text.style.fontStyle = "italic";
        }
        
        const emojiContainer = document.createElement("div");
        emojiContainer.style.display = "flex";
        emojiContainer.style.gap = "4px";
        emojiContainer.style.zIndex = "1";

        char.emojiUrls.forEach(url => {
            const img = document.createElement("img");
            img.src = url;
            img.style.width = "18px";
            img.style.height = "18px";
            img.style.objectFit = "contain";
            emojiContainer.appendChild(img);
        });

        item.appendChild(bg);
        item.appendChild(text);
        item.appendChild(emojiContainer);
        content.appendChild(item);
    });

    updateTimers();
}

function updateTimers() {
    if (!widget) return;
    
    trackedCharacters.forEach(char => {
        const span = widget!.querySelector(`#mudae-text-${char.messageId}`) as HTMLSpanElement;
        if (span) {
            const timeLeft = Math.max(0, Math.ceil((char.expiresAt - Date.now()) / 1000));
            const timerText = ` | ${timeLeft}s`;
            
            const displayRank = char.rank > 0 ? `#${char.rank}` : `?`;
            
            span.innerText = (char.claimed ? "❌" : "") + `${displayRank} - ${char.name}${timerText}`;
        }
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
        const currentChannelId = SelectedChannelStore.getChannelId();
        if (!message || !allowedIds.includes(message.channel_id) || message.channel_id != currentChannelId) return;

        const content = message.content;
        const pwrMatch = content?.match(/Power: \*\*(\d+)%\*\*/);
        const pwrUsage = content?.match(/Each kakera button consumes (\d+)% of your reaction power\./);
        if (pwrMatch && pwrUsage) {
            currentPower = parseInt(pwrMatch[1]);
            powerUsage = parseInt(pwrUsage[1]);
            updateUI();
            return;
        }

        const embed = message.embeds?.[0];
        if (!embed || !embed.description) return;
        // logger.info("Embed:", embed);
        const rankMatch = embed.description.match(/(?:Claim Rank:|Claims:)\s*#([0-9,]+)/i);
        const footer = embed.footer?.text;

        if (rankMatch || embed.description.includes("React with any emoji")) {
            // 0 = unknown claim rank
            const rankValue = rankMatch ? parseInt(rankMatch[1].replace(/,/g, ""), 10): 0;            

            const charName = embed.author?.name || "Unknown Character";

            if (rankValue > 0) {
                knownRanks[charName] = rankValue;
            }

            const finalRank = rankValue > 0 ? rankValue : (knownRanks[charName] || 0);

            const existingChar = trackedCharacters.find(c => c.name === charName);

            if (existingChar) {
                if (existingChar.rank === 0 && finalRank > 0) {
                    existingChar.rank = finalRank;
                    logger.info(`Updated unknown rank for ${charName} to #${finalRank}`);
                }
            } else {
                const emojiUrls: string[] =[];
                if (message.components?.length > 0) {
                    for (const row of message.components) {
                        if (row.components?.length > 0) {
                            for (const component of row.components) {
                                if (component.emoji?.id) {
                                    emojiUrls.push(`https://cdn.discordapp.com/emojis/${component.emoji.id}.webp?size=44`);
                                }
                            }
                        }
                    }
                }

                const hasInteraction = !!message.interaction;
                const timeoutSecs = getTimeoutSecs(message.guild_id, hasInteraction);

                trackedCharacters.push({
                    name: charName,
                    rank: finalRank,
                    messageId: message.id,
                    channelId: message.channel_id,
                    guildId: message.guild_id,
                    emojiUrls,
                    claimed: !!footer?.includes("Belongs to"),
                    expiresAt: Date.now() + (timeoutSecs * 1000)
                });
                
                logger.info(`Tracked ${charName} at Rank ${finalRank > 0 ? '#' + finalRank : 'Unknown'} with ${timeoutSecs}s timeout`);
            }

            trackedCharacters.sort((a, b) => {
                if (a.rank === 0 && b.rank !== 0) return 1;
                if (b.rank === 0 && a.rank !== 0) return -1;
                if (a.claimed === true && b.claimed === false) return 1;
                if (a.claimed === false && b.claimed === true) return -1;
                return a.rank - b.rank;
            });

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

        uiInterval = setInterval(updateTimers, 1000);
    },
    stop() {
        logger.info("Stopping Mudae Tracker.");

        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", checkVisibility);

        if (uiInterval) {
            clearInterval(uiInterval);
            uiInterval = null;
        }

        if (widget) {
            widget.remove();
            widget = null;
        }
        trackedCharacters = [];
        knownRanks = {};
        currentPower = -1;
        powerUsage = -1;
    }
});
