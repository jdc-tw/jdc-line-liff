/**
 * line-emoji.js — LINE 官方 emoji 的資料（範本編輯器的 palette 用）。
 *
 * **是 `.js` 不是 `.json`**：`.json` 要 `fetch` ⇒ 多一條非同步路徑、多一種
 * 載入失敗要處理，而本站是無 build 的靜態頁，其他 asset 都是直接 `<script src>`。
 * 一個常數檔沒有失敗分支。
 *
 * ⚠️ **LINE 沒有公開 `(sparkle)` 這類名稱的對照表**，只有圖與 emojiId 數字。
 *    所以下面的 `label` 是人工看圖標的，**標錯不會報錯**，只是 title 提示不準。
 *    圖本身不會錯——`productId`／`emojiId` 決定了畫出來是哪一顆。
 *
 * 兩層設計（2026-08-25 拍板，待辦 T306）：
 *   ① `LINE_EMOJI`——常用一排 40 顆，預設就看得到
 *   ② `LINE_EMOJI_GROUPS`——45 組的完整清單，給「更多」展開用
 * 只有第 ① 層的話，承辦人想要第 41 顆就走進死路。
 */

/** 符號組（239 顆）。辦公室通知的圖案幾乎都在這一組。 */
var LE_SYM = '5ac21a18040ab15980c9b43e';
/** 手勢組（彩色，222 顆）。 */
var LE_HAND = '5ac21e6c040ab15980c9b444';

/**
 * 常用一排。**端午範本用到的那五顆一定要在裡面**
 * （SYM 028／006／029／026 與 HAND 021），否則承辦人想再插一次卻找不到。
 * ⚠️ 本 repo 為 PUBLIC，註解與程式碼都不要寫同仁真實姓名。
 * 有一條測試守著這件事。
 */
var LINE_EMOJI = [
  // ── 勾與叉：核可、完成、否決 ──
  { productId: LE_SYM,  emojiId: '006', label: '紅勾' },
  { productId: LE_SYM,  emojiId: '007', label: '藍勾' },
  { productId: LE_SYM,  emojiId: '065', label: '圈起來的勾' },
  { productId: LE_SYM,  emojiId: '068', label: '紅叉' },
  { productId: LE_SYM,  emojiId: '019', label: 'YES' },
  { productId: LE_SYM,  emojiId: '020', label: 'NO' },
  { productId: LE_SYM,  emojiId: '186', label: 'OK' },

  // ── 提醒與強調 ──
  { productId: LE_SYM,  emojiId: '048', label: '警告三角' },
  { productId: LE_SYM,  emojiId: '074', label: '紅驚嘆號' },
  { productId: LE_SYM,  emojiId: '025', label: '三個驚嘆號' },
  { productId: LE_SYM,  emojiId: '026', label: '紅問號' },
  { productId: LE_SYM,  emojiId: '028', label: '閃亮' },
  { productId: LE_SYM,  emojiId: '029', label: '火' },
  { productId: LE_SYM,  emojiId: '187', label: 'NEW' },
  { productId: LE_SYM,  emojiId: '101', label: 'SOON' },

  // ── 指路：連結、下一步 ──
  { productId: LE_SYM,  emojiId: '085', label: '紅箭頭向右' },
  { productId: LE_SYM,  emojiId: '083', label: '紅箭頭向上' },
  { productId: LE_HAND, emojiId: '021', label: '食指指向右' },
  { productId: LE_HAND, emojiId: '022', label: '食指指向左' },
  { productId: LE_HAND, emojiId: '019', label: '食指指向上' },

  // ── 文件與事務 ──
  { productId: LE_SYM,  emojiId: '124', label: '信封' },
  { productId: LE_SYM,  emojiId: '108', label: '電子郵件' },
  { productId: LE_SYM,  emojiId: '136', label: '文件' },
  { productId: LE_SYM,  emojiId: '151', label: '剪貼板' },
  { productId: LE_SYM,  emojiId: '149', label: '資料夾' },
  { productId: LE_SYM,  emojiId: '110', label: '放大鏡' },
  { productId: LE_SYM,  emojiId: '125', label: '對話框' },
  { productId: LE_SYM,  emojiId: '190', label: '時鐘' },
  { productId: LE_SYM,  emojiId: '042', label: '電話' },

  // ── 心意 ──
  { productId: LE_SYM,  emojiId: '071', label: '紅心' },
  { productId: LE_SYM,  emojiId: '040', label: '愛心信封' },
  { productId: LE_SYM,  emojiId: '043', label: '太陽' },

  // ── 手勢 ──
  { productId: LE_HAND, emojiId: '002', label: '讚' },
  { productId: LE_HAND, emojiId: '067', label: '雙手讚' },
  { productId: LE_HAND, emojiId: '001', label: 'OK 手勢' },
  { productId: LE_HAND, emojiId: '005', label: '揮手' },
  { productId: LE_HAND, emojiId: '006', label: '舉手' },
  { productId: LE_HAND, emojiId: '037', label: '拍手' },
  { productId: LE_HAND, emojiId: '039', label: '合掌（拜託／感謝）' },
  { productId: LE_HAND, emojiId: '041', label: '握手' },
];

/**
 * 全部 45 組與各組顆數（二分探測實測，合計 9,175 顆）。
 * 「更多」展開時用它畫組別選單；圖是 lazy-load 的，不會一次拉九千張。
 *
 * ⚠️ 只有符號組與手勢組確認過是什麼內容（上面那兩個常數）。其餘 43 組
 *    **沒有名字**——LINE 不公開，所以選單上顯示序號與顆數，讓人自己翻。
 */
var LINE_EMOJI_GROUPS = [
  { productId: '5ac1bfd5040ab15980c9b435', count: 250 },
  { productId: '5ac1de17040ab15980c9b438', count: 194 },
  { productId: '5ac21184040ab15980c9b43a', count: 234 },
  { productId: '5ac21542031a6752fb806d55', count: 248 },
  { productId: '5ac2173d031a6752fb806d56', count: 240 },
  { productId: '5ac21869040ab15980c9b43b', count: 199 },
  { productId: '5ac218e3040ab15980c9b43c', count: 221 },
  { productId: '5ac2197b040ab15980c9b43d', count: 201 },
  { productId: '5ac21a13031a6752fb806d57', count: 149 },
  { productId: '5ac21a18040ab15980c9b43e', count: 239, label: '符號' },
  { productId: '5ac21a8c040ab15980c9b43f', count: 149 },
  { productId: '5ac21ae3040ab15980c9b440', count: 149 },
  { productId: '5ac21b4f031a6752fb806d59', count: 149 },
  { productId: '5ac21ba5040ab15980c9b441', count: 161 },
  { productId: '5ac21bf9031a6752fb806d5a', count: 161 },
  { productId: '5ac21c46040ab15980c9b442', count: 221 },
  { productId: '5ac21c4e031a6752fb806d5b', count: 161 },
  { productId: '5ac21cc5031a6752fb806d5c', count: 170 },
  { productId: '5ac21cce040ab15980c9b443', count: 161 },
  { productId: '5ac21d59031a6752fb806d5d', count: 212 },
  { productId: '5ac21e6c040ab15980c9b444', count: 222, label: '手勢' },
  { productId: '5ac21ef5031a6752fb806d5e', count: 150 },
  { productId: '5ac21f52040ab15980c9b445', count: 183 },
  { productId: '5ac21fda040ab15980c9b446', count: 140 },
  { productId: '5ac2206d031a6752fb806d5f', count: 252 },
  { productId: '5ac220c2031a6752fb806d60', count: 246 },
  { productId: '5ac2211e031a6752fb806d61', count: 250 },
  { productId: '5ac2213e040ab15980c9b447', count: 182 },
  { productId: '5ac2216f040ab15980c9b448', count: 188 },
  { productId: '5ac221ca040ab15980c9b449', count: 167 },
  { productId: '5ac22224031a6752fb806d62', count: 251 },
  { productId: '5ac22293031a6752fb806d63', count: 184 },
  { productId: '5ac222bf031a6752fb806d64', count: 250 },
  { productId: '5ac223c6040ab15980c9b44a', count: 157 },
  { productId: '5ac2264e040ab15980c9b44b', count: 252 },
  { productId: '5ac22775040ab15980c9b44c', count: 247 },
  { productId: '5ac2280f031a6752fb806d65', count: 250 },
  { productId: '5ac22a8c031a6752fb806d66', count: 210 },
  { productId: '5ac22b23040ab15980c9b44d', count: 247 },
  { productId: '5ac22bad031a6752fb806d67', count: 214 },
  { productId: '5ac22c9e031a6752fb806d68', count: 198 },
  { productId: '5ac22d62031a6752fb806d69', count: 196 },
  { productId: '5ac22def040ab15980c9b44e', count: 250 },
  { productId: '5ac22e85040ab15980c9b44f', count: 209 },
  { productId: '670e0cce840a8236ddd4ee4c', count: 211 },
];

/** 本檔宣告的全域名稱。有一條測試比對它與實際新增的全域。 */
var LINE_EMOJI_GLOBALS = ['LINE_EMOJI_GLOBALS', 'LE_SYM', 'LE_HAND',
  'LINE_EMOJI', 'LINE_EMOJI_GROUPS'];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LE_SYM: LE_SYM, LE_HAND: LE_HAND, LINE_EMOJI: LINE_EMOJI,
    LINE_EMOJI_GROUPS: LINE_EMOJI_GROUPS, LINE_EMOJI_GLOBALS: LINE_EMOJI_GLOBALS,
  };
}
