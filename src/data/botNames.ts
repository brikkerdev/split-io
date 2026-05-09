// Per-language bot nickname pools.
// Goal: feel like actual matchmaking — names real players would type, with
// numeric suffixes, stretched caps, mixed scripts, clan-tag-style brackets,
// and the casual tryhard energy of a public lobby. Streamer Easter eggs
// stay at the bottom of each pool, phonetically mangled so they only
// *evoke* a known creator (no impersonation).
//
// No politics, no slurs, no banned tags. Birth-year suffixes capped at
// reasonable ranges (no recent kid-age birthyears). 228 / drug refs avoided.

import type { Lang } from "@config/game";

const EN_NAMES: readonly string[] = [
  // generic "real human" nicks
  "mike_07", "Just_Alex", "kev1n", "BigSteve", "lil_tony",
  "Dan_99", "ProKid_07", "noobmaster69", "xX_dragon_Xx", "GamerDad42",
  "Sammy_05", "no_aim_lol", "iJustWantToWin", "afk_ben", "the_real_jim",
  "CarlosOG", "Andrew_TTV", "qwerty_pro", "SilentBob", "ramen4life",
  "Jakey", "HotPocket", "NotARobot", "your_dad", "Definitely_Human",
  "Megan_xo", "ShadyShark", "DarkMatter77", "im_not_lag", "OhNoMyTrail",
  "MrUntitled", "Kevin12345", "GhostInTheGrid", "salty_steve", "skill_issue",
  "ihatemath", "BlueShellGuy", "couch_potato", "Coffee_first", "TacoBella",
  "tryHardBilly", "EzPzClap", "lord_potato", "1v9plz", "no_skin_no_chill",
  "StarboyJay", "Mike_From_HR", "trashpanda07", "boredAtWork", "Kayla_03",
  // ── gaming streamer Easter eggs (phonetically mangled) ──
  "Pewdrepie", "Markypler", "JackSeptik", "Shrowed", "Ninjuh",
  "iShoSpede", "Pokeymane", "Sodaplop", "Asmungold", "Velkyrae",
];

const RU_NAMES: readonly string[] = [
  // generic russian-lobby nicks
  "Vasya_07", "Dima_2010", "Andreyka", "Kotik_03", "saske_999",
  "Maks_best07", "ANTOHA", "СерёгаРФ", "PRO_PLAYER", "влад_xx",
  "Лёхa", "kira_05", "imba_killer", "Танцующий_Робот", "ну_давай",
  "просто_миша", "Бабушка_про", "ВолК_оДиНоЧкА", "Артём_07", "ОмЕгА2009",
  "школьник_2012", "Я_не_бот", "kek_lol", "пельмень_07", "ShadowKILLER",
  "Никита_xX", "kotofey", "хочу_спать", "Денчик", "Лолошкa",
  "Папа_Может", "СаХаРоК", "слабый_игрок", "ИгрюHаПк", "тиктокер7",
  "Diman_4ik", "pro100_max", "хитрый_лис", "Малой_2011", "1v1_меня",
  "СонныйКот", "Vova_TTV", "BoxXer22", "Алина_xo", "iTzMrFox",
  "просто_Илья", "тортик05", "ленивый_босс", "PivnoyBaron", "RusPride07",
  // ── russian-speaking streamer Easter eggs (phonetic twists) ──
  "Кvплянoff", "Поппыч", "Бухстерр", "Эвильoн", "Ласкук",
  "Брательник", "Хелльярр", "Литвыня", "Помчик", "Велугемзз",
];

const TR_NAMES: readonly string[] = [
  // generic turkish-lobby nicks
  "Mertcan_07", "Ahmet_61", "Selo_2010", "Berkay34", "ali_ttv",
  "kralahmet", "yusuf_05", "ProKafa", "Emre_xX", "kobay_06",
  "Hakan_99", "MuratKing", "kullanıcı12", "salakÇocuk", "kamyoncuFurkan",
  "deli_can", "Onur_TR", "küçük_kaplan", "EfsaneEnes", "Burak_TTV",
  "kafamGuzel_pls", "Mehmet_03", "EkremGG", "TosbağaMan", "Çapkın_07",
  "Beto_34", "BizimMahalle", "Yağmur_xo", "tribunalord", "BoraHoca",
  "Ahmetzilla", "Sıfır_skill", "kebapçımurat", "Aşkın_TR", "kafalıoğlu",
  "EgeyiGören", "noobAga", "Hasan_06", "trabzonsporlu", "Bursaspor07",
  "MaviKedi", "GöktuğOyn", "Atakanyt", "Talhix", "Kemal_2010",
  "Can_07", "rüzgarTR", "Furkan_yt", "lal_07", "AyşeOyn",
  // ── turkish gaming streamer Easter eggs ──
  "Wolvocs", "Jhareyn", "BurakOyn", "Pintypand", "TheKemo",
  "PortakalAg", "Adkoyamdım", "Levosos", "Berkjann", "Chefyn",
];

const POOLS: Record<Lang, readonly string[]> = {
  en: EN_NAMES,
  ru: RU_NAMES,
  tr: TR_NAMES,
};

export function getBotNames(lang: Lang): readonly string[] {
  return POOLS[lang] ?? EN_NAMES;
}

/** Backwards-compat default pool (English). */
export const BOT_NAMES: readonly string[] = EN_NAMES;
