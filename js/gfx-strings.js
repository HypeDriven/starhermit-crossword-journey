// Localized strings for the Graphics settings section. The rest of the game is
// English-only (see spec §10); these follow navigator.languages.

const en = {
  quality: 'Quality', auto: 'Auto (detected: {tier})', low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  effects: 'Effects', postUnavailable: 'Post-processing is unavailable on this device; effects that need it are off.',
  noWebgl: '3D scenery is unavailable in this browser.', unknownGpu: 'unknown GPU', qualityToast: 'Quality: {tier}',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Lantern glow (bloom)', grade: 'Colour grade', antialias: 'Anti-aliasing', reflections: 'Reflections', water: 'Water', particles: 'Fireflies', detail: 'Scenery detail' },
  tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', static: 'Still', animated: 'Animated', plain: 'Plain', detailed: 'Detailed', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing' },
};

const enUS = { ...en, cat: { ...en.cat, grade: 'Color grade' } };

const es = {
  quality: 'Calidad', auto: 'Automática (detectada: {tier})', low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})', adaptive: 'Resolución adaptable', showFps: 'Mostrar fotogramas por segundo',
  effects: 'Efectos', postUnavailable: 'El posprocesado no está disponible en este dispositivo; los efectos que lo necesitan están desactivados.',
  noWebgl: 'El paisaje 3D no está disponible en este navegador.', unknownGpu: 'GPU desconocida', qualityToast: 'Calidad: {tier}',
  cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Brillo del farol (bloom)', grade: 'Corrección de color', antialias: 'Suavizado de bordes', reflections: 'Reflejos', water: 'Agua', particles: 'Luciérnagas', detail: 'Detalle del paisaje' },
  tier: { off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto', static: 'Quieta', animated: 'Animada', plain: 'Sencillo', detailed: 'Detallado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'bloom', noAa: 'sin suavizado' },
};

const esES = { ...es, renderScale: 'Escala de renderizado', cat: { ...es.cat, antialias: 'Antialiasing' }, sum: { ...es.sum, noAa: 'sin antialiasing' } };

const de = {
  quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
  renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  effects: 'Effekte', postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte, die sie benötigen, sind aus.',
  noWebgl: '3D-Landschaft ist in diesem Browser nicht verfügbar.', unknownGpu: 'unbekannte GPU', qualityToast: 'Qualität: {tier}',
  cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Laternenschein (Bloom)', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Spiegelungen', water: 'Wasser', particles: 'Glühwürmchen', detail: 'Landschaftsdetails' },
  tier: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', static: 'Ruhig', animated: 'Bewegt', plain: 'Einfach', detailed: 'Detailliert', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Bloom', noAa: 'keine Kantenglättung' },
};

const fr = {
  quality: 'Qualité', auto: 'Automatique (détectée : {tier})', low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})', adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
  effects: 'Effets', postUnavailable: 'Le post-traitement n’est pas disponible sur cet appareil ; les effets qui en dépendent sont désactivés.',
  noWebgl: 'Le décor 3D n’est pas disponible dans ce navigateur.', unknownGpu: 'GPU inconnu', qualityToast: 'Qualité : {tier}',
  cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo de la lanterne (bloom)', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', water: 'Eau', particles: 'Lucioles', detail: 'Détail du décor' },
  tier: { off: 'Non', on: 'Oui', low: 'Faible', medium: 'Moyen', high: 'Élevé', static: 'Immobile', animated: 'Animée', plain: 'Simple', detailed: 'Détaillé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'bloom', noAa: 'sans anticrénelage' },
};

const frCA = { ...fr, showFps: 'Afficher le nombre d’images par seconde', cat: { ...fr.cat, particles: 'Mouches à feu' } };

const pt = {
  quality: 'Qualidade', auto: 'Automática (detectada: {tier})', low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderização', fromPreset: 'Do predefinido ({tier})', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
  effects: 'Efeitos', postUnavailable: 'O pós-processamento não está disponível neste dispositivo; os efeitos que dependem dele estão desligados.',
  noWebgl: 'O cenário 3D não está disponível neste navegador.', unknownGpu: 'GPU desconhecida', qualityToast: 'Qualidade: {tier}',
  cat: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho da lanterna (bloom)', grade: 'Correção de cor', antialias: 'Suavização de bordas', reflections: 'Reflexos', water: 'Água', particles: 'Vaga-lumes', detail: 'Detalhe do cenário' },
  tier: { off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto', static: 'Parada', animated: 'Animada', plain: 'Simples', detailed: 'Detalhado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa', bloom: 'bloom', noAa: 'sem suavização' },
};

const it = {
  quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
  effects: 'Effetti', postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti che la richiedono sono disattivati.',
  noWebgl: 'Lo scenario 3D non è disponibile in questo browser.', unknownGpu: 'GPU sconosciuta', qualityToast: 'Qualità: {tier}',
  cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore della lanterna (bloom)', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', water: 'Acqua', particles: 'Lucciole', detail: 'Dettaglio dello scenario' },
  tier: { off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto', static: 'Ferma', animated: 'Animata', plain: 'Semplice', detailed: 'Dettagliato', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
  sum: { noShadows: 'nessuna ombra', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bloom', noAa: 'nessun antialiasing' },
};

export const GFX_STRINGS = {
  'en-US': enUS, 'en-GB': en, 'es-419': es, 'es-ES': esES, 'de-DE': de,
  'fr-FR': fr, 'fr-CA': frCA, 'pt-BR': pt, 'it-IT': it,
};

const FALLBACK = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the best supported locale for a list of BCP-47 tags (e.g. navigator.languages). */
export function pickLocale(langs) {
  const list = (Array.isArray(langs) ? langs : [langs]).filter(Boolean).map(String);
  for (const l of list) {
    const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === l.toLowerCase());
    if (exact) return exact;
    const [lang, region = ''] = l.toLowerCase().split('-');
    if (lang === 'en' && ['gb', 'uk', 'ie', 'au', 'nz'].includes(region)) return 'en-GB';
    if (lang === 'es' && region === 'es') return 'es-ES';
    if (lang === 'fr' && region === 'ca') return 'fr-CA';
    if (FALLBACK[lang]) return FALLBACK[lang];
  }
  return 'en-US';
}

export function gfxStrings(locale) {
  return GFX_STRINGS[locale] || GFX_STRINGS['en-US'];
}

export function fmt(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : ''));
}
