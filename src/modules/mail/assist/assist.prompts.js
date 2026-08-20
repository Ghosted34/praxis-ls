"use strict";

const PRESETS = {
  formal: { en: "Write a formal corporate email.", fr: "Rédigez un courriel formel d'entreprise." },
  friendly: { en: "Write a friendly professional email.", fr: "Rédigez un courriel professionnel et amical." },
  concise: { en: "Write a concise executive email, bulleted, decision-ready.", fr: "Rédigez un courriel exécutif concis, à puces, prêt à décider." },
  persuasive: { en: "Write a persuasive commercial email.", fr: "Rédigez un courriel commercial persuasif." },
  apologetic: { en: "Write an apologetic service-recovery email. Own the mistake.", fr: "Rédigez un courriel d'excuse. Assumez l'erreur." },
  payment: { en: "Write a firm payment-chase email. Stay in the relationship.", fr: "Rédigez une relance de paiement ferme, sans rompre la relation." },
  escalation: { en: "Write a firm escalation. Name consequences.", fr: "Rédigez une escalade ferme. Nommez les conséquences." },
  technical: { en: "Write a technical operational email. Facts, no warmth.", fr: "Rédigez un courriel opérationnel technique. Des faits, pas de chaleur." },
  followup: { en: "Write a warm follow-up without pressure.", fr: "Rédigez une relance chaleureuse, sans pression." },
  notice: { en: "Write a formal notice / mise en demeure. Measured, dated, quotable.", fr: "Rédigez une mise en demeure. Mesurée, datée, citable." },
};

const ACTIONS = {
  grammar: { en: "Fix grammar only.", fr: "Corrigez uniquement la grammaire." },
  shorten: { en: "Shorten without losing facts.", fr: "Raccourcissez sans perdre les faits." },
  expand: { en: "Expand slightly, still professional.", fr: "Développez légèrement, toujours professionnel." },
  to_fr: { en: "Translate to French. Preserve protected terms byte-for-byte.", fr: "Traduisez en français. Conservez les termes protégés." },
  to_en: { en: "Translate to English. Preserve protected terms byte-for-byte.", fr: "Traduisez en anglais. Conservez les termes protégés." },
};

function resolvePrompt(preset, lang) {
  const p = PRESETS[preset] || PRESETS.formal;
  return p[lang === "fr" ? "fr" : "en"];
}

function resolveAction(action, lang) {
  const a = ACTIONS[action];
  if (!a) return null;
  return a[lang === "fr" ? "fr" : "en"];
}

module.exports = { PRESETS, ACTIONS, resolvePrompt, resolveAction };
