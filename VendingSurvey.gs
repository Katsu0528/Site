/**
 * 自動販売機アンケート専用のデータ取得と回答保存処理をまとめたモジュール。
 * 商品マスタはカテゴリごとに同一スプレッドシート内の別シートで管理し、
 * 回答内容は同一ブック内の「アンケート回答」シートへ追記します。
 */

const VENDING_PRODUCT_SPREADSHEET_ID = '1xkg8vNscpcWTA6GA0VPxGTJCAH6LyvsYhq7VhOlDcXg';
const VENDING_MANUFACTURER_FOLDER_ID = '1nuVlneWO0PbmOapb_dTYoMNIWQFP45Gg';
const VENDING_SURVEY_RESPONSE_SHEET_NAME = 'アンケート回答';
const VENDING_MAX_SELECTIONS = 3;

const VENDING_PRODUCT_CATEGORIES = [
  { key: 'coffee', label: 'コーヒー', sheetName: 'コーヒー' },
  { key: 'energy', label: 'エナドリ', sheetName: 'エナドリ' },
  { key: 'water', label: '水', sheetName: '水' },
  { key: 'tea', label: 'お茶', sheetName: 'お茶' },
  { key: 'soda', label: '炭酸', sheetName: '炭酸' },
  { key: 'sports', label: 'スポドリ', sheetName: 'スポドリ' },
  { key: 'juice', label: 'その他(果汁等)', sheetName: 'その他(果汁等)' },
];

/**
 * クライアント側の初期表示に必要なデータをまとめて返します。
 * @return {{categories: Array<Object>, manufacturerImages: Array<Object>, maxSelections: number}}
 */
function getVendingSurveyData() {
  const ss = SpreadsheetApp.openById(VENDING_PRODUCT_SPREADSHEET_ID);
  const categories = VENDING_PRODUCT_CATEGORIES.map(function(category) {
    return {
      key: category.key,
      label: category.label,
      items: readVendingProducts(ss, category),
    };
  });

  return {
    categories: categories,
    manufacturerImages: getVendingManufacturerImages(),
    maxSelections: VENDING_MAX_SELECTIONS,
  };
}

/**
 * 質問2で使用する自販機メーカー画像の一覧を Drive から取得します。
 * @return {Array<{id: string, name: string, imageUrl: string}>}
 */
function getVendingManufacturerImages() {
  try {
    const folder = DriveApp.getFolderById(VENDING_MANUFACTURER_FOLDER_ID);
    const files = folder.getFiles();
    const list = [];
    while (files.hasNext()) {
      const file = files.next();
      list.push(file);
    }

    return list
      .sort(function(a, b) { return a.getName().localeCompare(b.getName(), 'ja'); })
      .map(function(file) {
        return {
          id: file.getId(),
          name: file.getName(),
          imageUrl: buildDriveViewUrl(file.getId()),
        };
      });
  } catch (err) {
    Logger.log('自販機メーカー画像の取得に失敗しました: %s', err);
    return [];
  }
}

/**
 * スプレッドシート上のカテゴリシートを読み込み、商品一覧を返します。
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {{key: string, label: string, sheetName: string}} category
 * @return {Array<Object>}
 */
function readVendingProducts(ss, category) {
  const sheet = ss.getSheetByName(category.sheetName);
  if (!sheet) {
    Logger.log('カテゴリシートが見つかりません: %s', category.sheetName);
    return [];
  }

  const values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) return [];

  return values
    .slice(1)
    .filter(function(row) { return row.some(function(cell) { return cell !== '' && cell !== null; }); })
    .map(function(row, index) {
      const name = (row[0] || '').toString().trim();
      const maker = (row[1] || '').toString().trim();
      const price = row[2];
      const imageUrl = normalizeDriveUrl(row[3]);
      return {
        id: [category.key, name || 'item', index].join(':'),
        name: name,
        maker: maker,
        price: formatVendingPrice(price),
        imageUrl: imageUrl,
        categoryKey: category.key,
      };
    });
}

/**
 * 回答内容をスプレッドシートへ保存します。
 * @param {Object} submission
 * @param {Array<Object>} submission.products
 * @param {{id: string, name: string}=} submission.manufacturerImage
 * @param {string=} submission.feedback
 * @return {{success: boolean}}
 */
function submitVendingSurvey(submission) {
  if (!submission || !Array.isArray(submission.products)) {
    throw new Error('回答データの形式が正しくありません。');
  }

  const products = submission.products
    .slice(0, VENDING_MAX_SELECTIONS)
    .map(function(item) {
      return {
        name: (item && item.name) ? item.name.toString().trim() : '',
        maker: (item && item.maker) ? item.maker.toString().trim() : '',
        price: item && item.price ? item.price.toString().trim() : '',
        categoryKey: item && item.categoryKey ? item.categoryKey.toString().trim() : '',
      };
    })
    .filter(function(item) { return item.name; });

  const manufacturerImage = submission.manufacturerImage || {};
  const feedback = submission.feedback ? submission.feedback.toString() : '';
  const email = (Session.getActiveUser() && Session.getActiveUser().getEmail()) || '';

  const ss = SpreadsheetApp.openById(VENDING_PRODUCT_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(VENDING_SURVEY_RESPONSE_SHEET_NAME) || ss.insertSheet(VENDING_SURVEY_RESPONSE_SHEET_NAME);
  ensureVendingSurveyHeader(sheet);

  sheet.appendRow([
    new Date(),
    email,
    products.map(function(item) {
      const pricePart = item.price ? ' / ' + item.price : '';
      return [item.name, item.maker].filter(Boolean).join(' - ') + pricePart;
    }).join('\n'),
    manufacturerImage.name || '',
    manufacturerImage.id || '',
    feedback,
  ]);

  return { success: true };
}

/**
 * 回答シートのヘッダーを初期化または補正します。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureVendingSurveyHeader(sheet) {
  const header = ['回答日時', 'メールアドレス', '選択した商品', '選択した自販機メーカー画像', '自販機メーカー画像ID', '自由記入'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    return;
  }

  const current = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  const matches = header.every(function(title, index) {
    return (current[index] || '').toString().trim() === title;
  });
  if (!matches) {
    sheet.insertRows(1);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

/**
 * スプレッドシートや Drive の URL からファイル ID を抽出し、閲覧可能な URL に変換します。
 * @param {string} value
 * @return {string}
 */
function normalizeDriveUrl(value) {
  if (!value) return '';
  const match = value.toString().match(/[-\w]{25,}/);
  if (!match) return value.toString();
  return buildDriveViewUrl(match[0]);
}

/**
 * Drive ファイルをインライン表示するための URL を生成します。
 * @param {string} fileId
 * @return {string}
 */
function buildDriveViewUrl(fileId) {
  return 'https://drive.google.com/uc?export=view&id=' + fileId;
}

/**
 * 価格セルから表示用の金額文字列を返します。
 * @param {*} priceCell
 * @return {string}
 */
function formatVendingPrice(priceCell) {
  if (priceCell === null || priceCell === undefined || priceCell === '') return '';
  const numeric = Number(priceCell);
  if (!isNaN(numeric)) {
    return '¥' + Math.round(numeric).toLocaleString('ja-JP');
  }
  return priceCell.toString();
}
