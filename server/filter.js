/* Chat and name filter (English, Arabic, Kurdish).
   Bad words are replaced with ***. Short words are matched as whole words
   only, so normal words that contain them are left alone.
   Add words to the lists below if players find ways around it. */
const WORDS = [
  // English
  'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'motherfucker', 'wanker', 'twat', 'porn', 'rape',
  // Arabic
  'كس', 'زب', 'طيز', 'نيك', 'منيوك', 'شرموط', 'شرموطة', 'قحبة', 'قحبه', 'عرص', 'خول', 'متناك', 'كسمك', 'كس امك', 'ابن الكلب', 'ابن الحرام', 'لوطي',
  // Kurdish (Sorani)
  'قەحپە', 'قحپە', 'کیر', 'کوز', 'حیز', 'گوو', 'بێشەرەف', 'دایکت', 'کەر',
];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
function norm(s) {
  return s.toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c])
    .replace(/[ً-ٰٟـ]/g, '')      // Arabic diacritics + tatweel
    .replace(/[يى]/g, 'ی').replace(/[كک]/g, 'ک').replace(/[هە]/g, 'ە').replace(/[ةۃ]/g, 'ە');
}
const LIST = WORDS.map(w => ({ w: norm(w), short: [...norm(w)].length <= 3, latin4: /^[a-z]{4}$/.test(w) }));
const ALLOW = new Set(['cocktail', 'cockpit', 'cockroach', 'peacock', 'hancock', 'dickens', 'shiitake', 'scunthorpe', 'therapist', 'grape', 'drape', 'rapeseed']);

export function cleanText(text, max = 200) {
  let s = String(text || '').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!s) return '';
  // Work token by token so removed diacritics can't shift positions.
  return s.split(' ').map(tok => {
    const n = norm(tok).replace(/[^\p{L}\p{N}]/gu, '');
    if (!n || ALLOW.has(n)) return tok;
    for (const { w, short, latin4 } of LIST) {
      if (w.includes(' ')) continue;
      const hit = (x) => (short ? x === w : latin4 ? x.startsWith(w) : x.includes(w));
      if (hit(n) || hit(n.replace(/(.)\1+/gu, '$1'))) return '*'.repeat(Math.min(6, [...tok].length));
    }
    return tok;
  }).join(' ').replace(new RegExp(LIST.filter(x => x.w.includes(' ')).map(x => x.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '(?!)', 'g'), '***');
}
export function badName(name) { return cleanText(name, 40) !== String(name).replace(/\s+/g, ' ').trim(); }
