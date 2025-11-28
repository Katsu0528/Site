/**
 * OTONARI Web アプリのエントリーポイントと、ACS API 呼び出しの共通ユーティリティ。
 * API 認証はアクセスキーとシークレットキーをコロンで連結した値をヘッダーに設定するだけの
 * シンプルな方式とし、コードの見通しを良くしています。
 */

// -----------------------------
// Web エントリーポイント
// -----------------------------

/**
 * Web アプリの入り口となる doGet 関数です。
 * @param {Object} e - リクエストパラメータ
 * @return {HtmlOutput}
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  Logger.log('doGet params: %s', JSON.stringify(params));

  try {
    switch (params.view || '') {
      case 'media-register':
        return renderMediaRegisterPage();
      case 'promotion-apply':
        return renderPromotionApplyPage();
      default:
        return renderPortalPage(params);
    }
  } catch (err) {
    Logger.log('doGet error: %s', (err && err.stack) || err);
    return HtmlService.createHtmlOutput(
      '<h1>サーバー側エラー</h1><pre>' + (err && (err.stack || err.toString())) + '</pre>'
    ).setTitle('OTONARI API エラー');
  }
}

function renderPortalPage(params) {
  const template = HtmlService.createTemplateFromFile('MainSite');
  template.actionsJson = getWebActionDefinitions();
  template.logoUrl = getLogoUrlFromSheet();
  template.selectedActionId = params.action || '';
  template.selectedView = params.view || '';
  template.acsApiConfigured = isAcsApiConfigured();
  template.baseUrl = ScriptApp.getService().getUrl();
  return template
    .evaluate()
    .setTitle('OTONARI API ポータル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderMediaRegisterPage() {
  const template = HtmlService.createTemplateFromFile('MediaRegister');
  template.portalUrl = ScriptApp.getService().getUrl();
  template.acsApiConfigured = isAcsApiConfigured();
  return template
    .evaluate()
    .setTitle('メディア登録')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderPromotionApplyPage() {
  const template = HtmlService.createTemplateFromFile('PromotionApply');
  template.portalUrl = ScriptApp.getService().getUrl();
  template.acsApiConfigured = isAcsApiConfigured();
  return template
    .evaluate()
    .setTitle('提携申請登録')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// -----------------------------
// Web アクション実行
// -----------------------------

/**
 * Web アクションの最小限の情報を抽出して返します。
 * @return {Array<Object>}
 */
function getWebActionDefinitions() {
  const configList = getWebActionConfigList();
  if (!Array.isArray(configList)) {
    console.warn('Webアクション設定の取得結果が配列ではありません。安全のため空配列を返します。');
    return [];
  }

  return configList
    .filter(function(action) { return action && typeof action === 'object'; })
    .map(function(action) {
      return {
        id: action.id,
        group: action.group,
        name: action.name,
        description: action.description,
        handler: action.handler,
        fields: action.fields || [],
      };
    });
}

/**
 * クライアントからリクエストされたアクションを実際の処理にディスパッチします。
 * @param {string} actionId
 * @param {Object} formValues
 * @return {Object}
 */
function runWebAction(actionId, formValues) {
  if (!actionId) {
    throw new Error('アクションIDが指定されていません。');
  }

  const action = getWebActionConfigList().find(function(item) { return item.id === actionId; });
  if (!action) {
    throw new Error('指定されたアクションが見つかりません: ' + actionId);
  }

  const handlerName = action.handler;
  const handler = globalThis[handlerName];
  if (typeof handler !== 'function') {
    throw new Error('実行対象の関数が定義されていません: ' + handlerName);
  }

  const fields = action.fields || [];
  const values = formValues || {};
  const args = fields.map(function(field) {
    const value = values[field.id];
    if (!field.optional && (!value && value !== 0)) {
      throw new Error('必須項目が未入力です: ' + field.label);
    }
    return value === '' ? null : value;
  });

  const capturedLogs = [];
  const restoreLogging = captureExecutionLogs(capturedLogs);
  try {
    const result = args.length ? handler.apply(null, args) : handler();
    const embeddedLogs = result && Array.isArray(result.logs) ? result.logs : [];
    return { result: result, logs: capturedLogs.concat(embeddedLogs) };
  } finally {
    restoreLogging();
  }
}

// -----------------------------
// ロギングユーティリティ
// -----------------------------

/**
 * Logger.log / console.* に出力される内容を配列に蓄積します。
 * @param {Array<Object>} buffer
 * @return {function(): void}
 */
function captureExecutionLogs(buffer) {
  const target = Array.isArray(buffer) ? buffer : [];
  const originalLoggerLog = Logger.log;
  const originalConsole = {
    log: console.log || function() {},
    info: console.info || console.log || function() {},
    warn: console.warn || console.log || function() {},
    error: console.error || console.log || function() {},
  };

  function append(level, args) {
    try {
      const message = Array.prototype.slice.call(args).map(function(part) {
        if (part === null || part === undefined) return '';
        if (typeof part === 'string') return part;
        try {
          return JSON.stringify(part);
        } catch (e) {
          return String(part);
        }
      }).join(' ');
      if (message) target.push({ level: level || 'info', message: message });
    } catch (ignored) {}
  }

  Logger.log = function() { append('info', arguments); return originalLoggerLog.apply(Logger, arguments); };
  console.log = function() { append('info', arguments); return originalConsole.log.apply(console, arguments); };
  console.info = function() { append('info', arguments); return originalConsole.info.apply(console, arguments); };
  console.warn = function() { append('warning', arguments); return originalConsole.warn.apply(console, arguments); };
  console.error = function() { append('error', arguments); return originalConsole.error.apply(console, arguments); };

  return function restoreLogging() {
    Logger.log = originalLoggerLog;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  };
}

// -----------------------------
// テンプレート・静的資産
// -----------------------------

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// -----------------------------
// ロゴ取得ヘルパー
// -----------------------------

function getLogoUrlFromSheet() {
  const SPREADSHEET_ID = '1f22F3tSeK3PNndceAVmEeQPlDx48O4BCAid1HroJsuw';
  const SHEET_NAME = 'シート1';
  const TARGET_RANGE = 'A1';

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('シートが見つかりません: ' + SHEET_NAME);

    const range = sheet.getRange(TARGET_RANGE);
    const value = range.getValue();

    if (value && typeof value === 'object') {
      const blobDataUrl = convertBlobToDataUrl(value);
      if (blobDataUrl) return blobDataUrl;

      if (typeof value.getSourceUrl === 'function') {
        const sourceUrl = value.getSourceUrl();
        if (sourceUrl) return sourceUrl;
      }
    }

    const images = sheet.getImages && sheet.getImages();
    if (images && typeof images.forEach === 'function') {
      for (var i = 0; i < images.length; i++) {
        var image = images[i];
        if (!image) continue;

        var anchorCell = typeof image.getAnchorCell === 'function' ? image.getAnchorCell() : null;
        if (!anchorCell) {
          var anchorRow = typeof image.getAnchorRow === 'function' ? image.getAnchorRow() : null;
          var anchorColumn = typeof image.getAnchorColumn === 'function' ? image.getAnchorColumn() : null;
          if (anchorRow && anchorColumn) anchorCell = sheet.getRange(anchorRow, anchorColumn);
        }

        if (anchorCell && anchorCell.getA1Notation && anchorCell.getA1Notation() === TARGET_RANGE) {
          var overImageDataUrl = convertBlobToDataUrl(image);
          if (overImageDataUrl) return overImageDataUrl;
        }
      }
    }

    const formulaUrl = extractImageUrlFromFormula(range.getFormula());
    if (formulaUrl) return formulaUrl;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed;
    }
  } catch (error) {
    console.error('ロゴ画像の取得に失敗しました: ' + error);
  }

  return '';
}

function extractImageUrlFromFormula(formula) {
  if (!formula) return '';
  const doubleQuoteMatch = formula.match(/=IMAGE\(\s*"([^"]+)"/i);
  if (doubleQuoteMatch && doubleQuoteMatch[1]) return doubleQuoteMatch[1];
  const singleQuoteMatch = formula.match(/=IMAGE\(\s*'([^']+)'/i);
  if (singleQuoteMatch && singleQuoteMatch[1]) return singleQuoteMatch[1];
  return '';
}

function convertBlobToDataUrl(blobHolder) {
  if (!blobHolder || typeof blobHolder.getBlob !== 'function') return '';
  var blob = blobHolder.getBlob();
  if (!blob) return '';
  var contentType = blob.getContentType() || 'image/png';
  var base64 = Utilities.base64Encode(blob.getBytes());
  return 'data:' + contentType + ';base64,' + base64;
}

// -----------------------------
// 設定・プロパティ
// -----------------------------

function isAcsApiConfigured() {
  try {
    getApiConfig();
    return true;
  } catch (error) {
    console.warn('ACS API 設定の確認に失敗しました: %s', error);
    return false;
  }
}

function getCleanProperty(props, keys, defaultValue) {
  const targetKeys = Array.isArray(keys) ? keys : [keys];
  const store = props && typeof props.getProperty === 'function' ? props : null;

  for (var i = 0; i < targetKeys.length; i++) {
    var key = targetKeys[i];
    var value = store ? store.getProperty(key) : null;
    if (value !== null && value !== undefined) {
      var trimmed = String(value).trim();
      if (trimmed) return trimmed;
    }
  }

  return typeof defaultValue === 'undefined' ? '' : String(defaultValue);
}

/**
 * ACS API に接続するための設定を取得します。
 * @return {{ baseUrl: string, accessKey: string, secretKey: string, authHeader: Object }}
 */
function getApiConfig() {
  const props = PropertiesService.getScriptProperties();
  let baseUrl = getCleanProperty(props, ['OTONARI_BASE_URL']);
  baseUrl = (baseUrl || 'https://otonari-asp.com/api/v1/m').replace(/\/+$/, '');

  const accessKey = getCleanProperty(props, ['OTONARI_ACCESS_KEY']);
  const secretKey = getCleanProperty(props, ['OTONARI_SECRET_KEY']);

  if (!baseUrl || !accessKey || !secretKey) {
    throw new Error('ACS API の接続設定が不足しています。アクセスキーとシークレットキーを設定してください。');
  }

  return {
    baseUrl: baseUrl,
    accessKey: accessKey,
    secretKey: secretKey,
    authHeader: buildAcsAuthHeader(accessKey, secretKey),
  };
}

/**
 * API 仕様に沿ってアクセスキーとシークレットキーをコロンで結合したヘッダーを返します。
 * @param {string} accessKey
 * @param {string} secretKey
 * @return {Object}
 */
function buildAcsAuthHeader(accessKey, secretKey) {
  var token = String(accessKey || '').trim() + ':' + String(secretKey || '').trim();
  if (!token || token === ':') {
    throw new Error('ACS API 認証情報が設定されていません。');
  }
  return { 'X-Auth-Token': token };
}

// -----------------------------
// ACS API クライアント
// -----------------------------

function createAcsApiClient() {
  const config = getApiConfig();
  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, '');

  function buildUrl(path, query) {
    const normalizedPath = path.charAt(0) === '/' ? path : '/' + path;
    let url = normalizedBaseUrl + normalizedPath;

    const params = [];
    if (query && typeof query === 'object') {
      Object.keys(query).forEach(function(key) {
        const value = query[key];
        if (value === null || value === undefined || value === '') return;
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      });
    }

    if (params.length) url += '?' + params.join('&');
    return url;
  }

  function request(path, options) {
    const opts = options || {};
    const url = buildUrl(path, opts.query);
    const fetchOptions = {
      method: (opts.method || 'get').toLowerCase(),
      headers: Object.assign({}, config.authHeader, opts.headers || {}),
      muteHttpExceptions: true,
    };

    if (opts.body) {
      fetchOptions.payload = JSON.stringify(opts.body);
      fetchOptions.contentType = 'application/json';
    }

    const response = UrlFetchApp.fetch(url, fetchOptions);
    const status = response.getResponseCode();
    const text = response.getContentText() || '';
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (parseError) {}

    if (status < 200 || status >= 300) {
      const message = (data && (data.message || data.error)) || 'ACS API 呼び出しに失敗しました (HTTP ' + status + ')';
      throw new Error(message);
    }

    return data || {};
  }

  function normalizeRecords(records) {
    if (Array.isArray(records)) return records;
    if (records && typeof records === 'object') return Object.keys(records).length ? [records] : [];
    return [];
  }

  function fetchAll(path, query) {
    const collected = [];
    let offset = 0;
    const baseQuery = query || {};
    const defaultLimit = 100;

    while (true) {
      const page = request(path, { query: Object.assign({ offset: offset, limit: baseQuery.limit || defaultLimit }, baseQuery) });
      const records = normalizeRecords(page && page.records);
      if (records.length) collected.push.apply(collected, records);

      const header = page && page.header;
      const total = header && header.total ? Number(header.total) : null;
      offset += baseQuery.limit || defaultLimit;
      if (!total || offset >= total || !records.length) break;
    }

    return collected;
  }

  function findPromotionId(identifier) {
    if (!identifier) return null;
    if (/^p\d+$/i.test(identifier)) return identifier;

    const promotions = fetchAll('/promotion/search', { keyword: identifier, limit: 50 });
    const exact = promotions.find(function(promotion) { return promotion && promotion.id && promotion.id.toString() === identifier; });
    if (exact && exact.id) return String(exact.id);

    const partial = promotions.find(function(promotion) {
      const name = promotion && promotion.name ? String(promotion.name) : '';
      return name.indexOf(identifier) !== -1;
    });
    return partial && partial.id ? String(partial.id) : null;
  }

  function findAffiliateId(identifier) {
    if (!identifier) return null;
    if (/^u[a-z0-9]+$/i.test(identifier)) return identifier;

    const affiliates = fetchAll('/user/search', { keyword: identifier, limit: 50 });
    const exact = affiliates.find(function(user) { return user && user.id && user.id.toString() === identifier; });
    if (exact && exact.id) return String(exact.id);

    const partial = affiliates.find(function(user) {
      const company = user && user.company ? String(user.company) : '';
      const name = user && user.name ? String(user.name) : '';
      return company.indexOf(identifier) !== -1 || name.indexOf(identifier) !== -1;
    });
    return partial && partial.id ? String(partial.id) : null;
  }

  function listMediaIdsByAffiliate(affiliateId) {
    if (!affiliateId) return [];
    const mediaList = fetchAll('/media/search', { user: affiliateId });
    return mediaList
      .map(function(media) { return media && media.id ? String(media.id) : ''; })
      .filter(function(id) { return !!id; });
  }

  function registerPromotionApplication(promotionId, mediaId) {
    if (!promotionId || !mediaId) {
      throw new Error('広告IDまたはメディアIDが不正です。');
    }
    request('/promotion_apply/regist', {
      method: 'post',
      body: { media: mediaId, promotion: promotionId, state: 0 },
    });
  }

  return {
    request: request,
    findPromotionId: findPromotionId,
    findAffiliateId: findAffiliateId,
    listMediaIdsByAffiliate: listMediaIdsByAffiliate,
    registerPromotionApplication: registerPromotionApplication,
  };
}

// -----------------------------
// ビジネスロジック
// -----------------------------

function registerPromotionApplicationsFromWeb(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('入力データが不正です。');
  }

  const api = createAcsApiClient();
  const summary = { total: rows.length, success: 0, skipped: 0, errors: 0 };
  const results = [];

  rows.forEach(function(row, index) {
    const rowNumber = row && row.rowNumber ? Number(row.rowNumber) : index + 1;
    const promotionIdentifier = row && row.promotionIdentifier ? String(row.promotionIdentifier).trim() : '';
    const affiliateIdentifier = row && row.mediaIdentifier ? String(row.mediaIdentifier).trim() : '';

    if (!promotionIdentifier || !affiliateIdentifier) {
      summary.skipped++;
      results.push({
        rowNumber: rowNumber,
        status: 'skipped',
        promotionId: '',
        mediaId: '',
        message: '広告とアフィリエイターの両方を入力してください。',
      });
      return;
    }

    try {
      const promotionId = api.findPromotionId(promotionIdentifier);
      if (!promotionId) throw new Error('広告が見つかりませんでした。');

      const affiliateId = api.findAffiliateId(affiliateIdentifier);
      if (!affiliateId) throw new Error('アフィリエイターが見つかりませんでした。');

      const mediaIds = api.listMediaIdsByAffiliate(affiliateId);
      if (!mediaIds.length) throw new Error('対象アフィリエイターのメディアが見つかりませんでした。');

      const appliedMedia = [];
      const failedMedia = [];

      mediaIds.forEach(function(mediaId) {
        try {
          api.registerPromotionApplication(promotionId, mediaId);
          appliedMedia.push(mediaId);
        } catch (applyError) {
          const reason = applyError && applyError.message ? applyError.message : String(applyError);
          failedMedia.push(mediaId + ': ' + reason);
        }
      });

      const hasOnlyFailures = appliedMedia.length === 0 && failedMedia.length > 0;
      const status = hasOnlyFailures ? 'error' : 'success';
      summary[status === 'success' ? 'success' : 'errors']++;

      const messages = [];
      messages.push(mediaIds.length + '件のメディアを対象に申請しました。');
      if (appliedMedia.length) messages.push('申請済み: ' + appliedMedia.join(', '));
      if (failedMedia.length) messages.push('失敗: ' + failedMedia.join(' / '));

      results.push({
        rowNumber: rowNumber,
        status: status,
        promotionId: promotionId,
        mediaId: appliedMedia.join(', ') || mediaIds.join(', '),
        message: messages.join(' '),
      });
    } catch (error) {
      summary.errors++;
      results.push({
        rowNumber: rowNumber,
        status: 'error',
        promotionId: '',
        mediaId: '',
        message: error && error.message ? error.message : String(error),
      });
    }
  });

  return { summary: summary, results: results };
}
