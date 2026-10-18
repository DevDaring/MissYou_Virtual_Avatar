// Minimal UI strings for EN / BN / HI (the call itself follows the person's call language).
export type Lang = 'en' | 'bn' | 'hi'
const S = {
  en: { home: 'Home', memories: 'Memory box', letters: 'Letters', history: 'Calls', settings: 'Settings', call: 'Call', aiBadge: 'AI recreation', end: 'End call', mute: 'Mute', unmute: 'Unmute', captions: 'Captions', type: 'Type', hold: 'Hold to talk', listening: 'Listening…', thinking: 'Thinking…', connecting: 'Connecting…', ringing: 'Calling', report: 'Something felt wrong' },
  bn: { home: 'হোম', memories: 'স্মৃতির বাক্স', letters: 'চিঠি', history: 'কল', settings: 'সেটিংস', call: 'কল', aiBadge: 'AI পুনর্নির্মাণ', end: 'কল শেষ', mute: 'মিউট', unmute: 'আনমিউট', captions: 'ক্যাপশন', type: 'লিখুন', hold: 'চেপে ধরে বলুন', listening: 'শুনছি…', thinking: 'ভাবছে…', connecting: 'সংযোগ হচ্ছে…', ringing: 'কল হচ্ছে', report: 'কিছু ঠিক লাগেনি' },
  hi: { home: 'होम', memories: 'यादों का डिब्बा', letters: 'चिट्ठियाँ', history: 'कॉल', settings: 'सेटिंग्स', call: 'कॉल', aiBadge: 'AI पुनर्रचना', end: 'कॉल खत्म', mute: 'म्यूट', unmute: 'अनम्यूट', captions: 'कैप्शन', type: 'लिखें', hold: 'दबाकर बोलें', listening: 'सुन रहे हैं…', thinking: 'सोच रहे हैं…', connecting: 'जुड़ रहा है…', ringing: 'कॉल हो रही है', report: 'कुछ ठीक नहीं लगा' },
} as const
export type Key = keyof typeof S.en
export function t(lang: string | undefined, key: Key): string {
  return (S[(lang as Lang) || 'en'] || S.en)[key]
}
