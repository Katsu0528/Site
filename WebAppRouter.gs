/**
 * Webアプリの入り口となる doGet 関数です。
 * HTML テンプレートにアクション定義を渡して描画します。
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  Logger.log('doGet params: %s', JSON.stringify(params));

  try {
    if ((params.view || '') === 'media-register') {
      return renderMediaRegisterPage();
    }
    if ((params.view || '') === 'promotion-apply') {
      return renderPromotionApplyPage();
    }
    return renderPortalPage(params);
  } catch (err) {
    Logger.log('doGet error: %s', (err && err.stack) || err);
    return HtmlService.createHtmlOutput(
        '<h1>サーバー側エラー</h1><pre>' +
        (err && (err.stack || err.toString())) +
        '</pre>'
      )
      .setTitle('OTONARI API エラー');
  }
}

function renderPortalPage(params) {
  params = params || {};
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

/**
 * Web アクションの最小限の情報を抽出して返します。
 * 直接 HTML で扱いやすい構造にすることで保守性を高めています。
 */
function getWebActionDefinitions() {
  const configList = getWebActionConfigList();
  if (!Array.isArray(configList)) {
    console.warn('Webアクション設定の取得結果が配列ではありません。安全のため空配列を返します。');
    return [];
  }

  return configList
    .filter(function(action) {
      return action && typeof action === 'object';
    })
    .map(function(action) {
      return {
        id: action.id,
        group: action.group,
        name: action.name,
        description: action.description,
        handler: action.handler,
        fields: action.fields || []
      };
    });
}

/**
 * クライアントからリクエストされたアクションを実際の処理にディスパッチします。
 * actionId に紐づく handler を安全に呼び出し、結果をそのまま返却します。
 */
function runWebAction(actionId, formValues) {
  if (!actionId) {
    throw new Error('アクションIDが指定されていません。');
  }

  const action = getWebActionConfigList().find(function(item) {
    return item.id === actionId;
  });
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
    // 未入力の場合は null を渡すことで、既存処理の分岐を書き換えなくても良いようにしています。
    return value === '' ? null : value;
  });

  const capturedLogs = [];
  const restoreLogging = captureExecutionLogs(capturedLogs);

  try {
    // 引数が無い場合は apply を通さず直接実行し、エラーハンドリングを簡潔に保ちます。
    const result = args.length ? handler.apply(null, args) : handler();
    const embeddedLogs = result && Array.isArray(result.logs) ? result.logs : [];
    return { result: result, logs: capturedLogs.concat(embeddedLogs) };
  } finally {
    restoreLogging();
  }
}

/**
 * Logger.log / console.* に出力される内容を配列に蓄積し、呼び出し元へ返却できるようにします。
 * 実行後は必ず restore 関数で元の状態に戻してください。
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

  const append = function(level, args) {
    try {
      const message = Array.prototype.slice.call(args).map(function(part) {
        if (part === null || part === undefined) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        try {
          return JSON.stringify(part);
        } catch (e) {
          return String(part);
        }
      }).join(' ');
      if (message) {
        target.push({ level: level || 'info', message: message });
      }
    } catch (ignored) {
      // ログ出力の失敗は処理継続を優先し、握りつぶします。
    }
  };

  Logger.log = function() {
    append('info', arguments);
    return originalLoggerLog.apply(Logger, arguments);
  };

  console.log = function() {
    append('info', arguments);
    return originalConsole.log.apply(console, arguments);
  };
  console.info = function() {
    append('info', arguments);
    return originalConsole.info.apply(console, arguments);
  };
  console.warn = function() {
    append('warning', arguments);
    return originalConsole.warn.apply(console, arguments);
  };
  console.error = function() {
    append('error', arguments);
    return originalConsole.error.apply(console, arguments);
  };

  return function restoreLogging() {
    Logger.log = originalLoggerLog;
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  };
}

/**
 * HTML ファイルをインクルードするためのヘルパーです。
 * 必要に応じてテンプレート内から呼び出してください。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * シートに格納されたロゴ画像を取得して data URL もしくは公開 URL として返します。
 * 取得に失敗した場合は空文字を返し、フロント側でフォールバック表示を行います。
 *
 * @return {string}
 */
function getLogoUrlFromSheet() {
  const SPREADSHEET_ID = '1f22F3tSeK3PNndceAVmEeQPlDx48O4BCAid1HroJsuw';
  const SHEET_NAME = 'シート1';
  const TARGET_RANGE = 'A1';

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error('シートが見つかりません: ' + SHEET_NAME);
    }

    const range = sheet.getRange(TARGET_RANGE);
    const value = range.getValue();

    // 新しい CellImage API で画像が格納されている場合
    if (value && typeof value === 'object') {
      const blobDataUrl = convertBlobToDataUrl(value);
      if (blobDataUrl) {
        return blobDataUrl;
      }

      if (typeof value.getSourceUrl === 'function') {
        const sourceUrl = value.getSourceUrl();
        if (sourceUrl) {
          return sourceUrl;
        }
      }
    }

    // セル上に配置された画像（オーバーセル画像）を探索
    const images = sheet.getImages && sheet.getImages();
    if (images && typeof images.forEach === 'function') {
      for (var i = 0; i < images.length; i++) {
        var image = images[i];
        if (!image) {
          continue;
        }

        var anchorCell = typeof image.getAnchorCell === 'function'
          ? image.getAnchorCell()
          : null;

        if (!anchorCell) {
          var anchorRow = typeof image.getAnchorRow === 'function' ? image.getAnchorRow() : null;
          var anchorColumn = typeof image.getAnchorColumn === 'function' ? image.getAnchorColumn() : null;
          if (anchorRow && anchorColumn) {
            anchorCell = sheet.getRange(anchorRow, anchorColumn);
          }
        }

        if (anchorCell && anchorCell.getA1Notation && anchorCell.getA1Notation() === TARGET_RANGE) {
          var overImageDataUrl = convertBlobToDataUrl(image);
          if (overImageDataUrl) {
            return overImageDataUrl;
          }
        }
      }
    }

    // =IMAGE("URL") 形式のセルから URL を抽出
    const formulaUrl = extractImageUrlFromFormula(range.getFormula());
    if (formulaUrl) {
      return formulaUrl;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }
    }
  } catch (error) {
    console.error('ロゴ画像の取得に失敗しました: ' + error);
  }

  return '';
}

/**
 * =IMAGE 関数の数式から画像 URL を取り出します。
 *
 * @param {string} formula
 * @return {string}
 */
function extractImageUrlFromFormula(formula) {
  if (!formula) {
    return '';
  }

  const doubleQuoteMatch = formula.match(/=IMAGE\(\s*"([^"]+)"/i);
  if (doubleQuoteMatch && doubleQuoteMatch[1]) {
    return doubleQuoteMatch[1];
  }

  const singleQuoteMatch = formula.match(/=IMAGE\(\s*'([^']+)'/i);
  if (singleQuoteMatch && singleQuoteMatch[1]) {
    return singleQuoteMatch[1];
  }

  return '';
}

/**
 * Blob を持つ可能性があるオブジェクトから data URL を生成します。
 *
 * @param {Object} blobHolder
 * @return {string}
 */
function convertBlobToDataUrl(blobHolder) {
  if (!blobHolder || typeof blobHolder.getBlob !== 'function') {
    return '';
  }

  var blob = blobHolder.getBlob();
  if (!blob) {
    return '';
  }

  var contentType = blob.getContentType() || 'image/png';
  var base64 = Utilities.base64Encode(blob.getBytes());
  return 'data:' + contentType + ';base64,' + base64;
}

/**
 * ACS API に接続するための設定が存在するかを判定します。
 * 秘密情報をフロントへ渡さないよう、Boolean のみ返却します。
 */
function isAcsApiConfigured() {
  try {
    getApiConfig();
    return true;
  } catch (error) {
    console.warn('ACS API 設定の確認に失敗しました: %s', error);
    return false;
  }
}

/**
 * スクリプト プロパティを安全に取得し、未設定時はデフォルト値を返します。
 *
 * @param {PropertiesService} props
 * @param {string|string[]} keys 優先順位順のプロパティ名
 * @param {string=} defaultValue keys いずれも未設定の場合のフォールバック
 * @return {string}
 */
function getCleanProperty(props, keys, defaultValue) {
  const targetKeys = Array.isArray(keys) ? keys : [keys];
  const store = props && typeof props.getProperty === 'function' ? props : null;

  for (var i = 0; i < targetKeys.length; i++) {
    var key = targetKeys[i];
    var value = store ? store.getProperty(key) : null;
    if (value !== null && value !== undefined) {
      var trimmed = String(value).trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return typeof defaultValue === 'undefined' ? '' : String(defaultValue);
}

/**
 * ACS API に接続するための設定をまとめて取得します。
 *
 * @return {{ baseUrl: string, token: string, headers: Object }}
 */
function getApiConfig() {
  const props = PropertiesService.getScriptProperties();
  let baseUrl = getCleanProperty(
    props,
    ['OTONARI_BASE_URL'],
    'https://otonari-asp.com/api/v1/m'
  );
  baseUrl = baseUrl.replace(/\/+$/, '');

  const accessKey = getCleanProperty(props, ['OTONARI_ACCESS_KEY'], 'agqnoournapf');
  const secretKey = getCleanProperty(
    props,
    ['OTONARI_SECRET_KEY'],
    '5j39q2hzsmsccck0ccgo4w0o'
  );

  if (!baseUrl || !accessKey || !secretKey) {
    throw new Error(
      'ACS API の接続設定が不足しています。' +
      '\nスクリプトプロパティに OTONARI_BASE_URL / OTONARI_ACCESS_KEY / OTONARI_SECRET_KEY を設定してください。'
    );
  }

  const token = accessKey + ':' + secretKey;

  return {
    baseUrl,
    token: token,
    headers: { 'X-Auth-Token': token }
  };
}

/**
 * ACS API を呼び出すための簡易クライアントを生成します。
 *
 * @return {{
 *   request: function(string, Object=): Object,
 *   findPromotionId: function(string): (string|null),
 *   findAffiliateId: function(string): (string|null),
 *   listMediaIdsByAffiliate: function(string): string[],
 *   registerPromotionApplication: function(string, string): void
 * }}
 */
function createAcsApiClient() {
  const config = getApiConfig();
  const token = config && config.token;
  const baseUrl = config && config.baseUrl;

  if (!baseUrl || !token) {
    throw new Error('ACS API の接続設定が見つかりません。');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  function buildUrl(path, query) {
    const normalizedPath = path.charAt(0) === '/' ? path : '/' + path;
    let url = normalizedBaseUrl + normalizedPath;

    const params = [];
    if (query && typeof query === 'object') {
      Object.keys(query).forEach(function(key) {
        const value = query[key];
        if (value === null || value === undefined || value === '') {
          return;
        }
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      });
    }

    if (params.length) {
      url += '?' + params.join('&');
    }

    return url;
  }

  function request(path, options) {
    const opts = options || {};
    const url = buildUrl(path, opts.query);
    const fetchOptions = {
      method: (opts.method || 'get').toLowerCase(),
      headers: Object.assign({}, config.headers, opts.headers || {}),
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
    try {
      data = text ? JSON.parse(text) : null;
    } catch (parseError) {
      // レスポンスが JSON でない場合でも処理を続ける
    }

    if (status < 200 || status >= 300) {
      const message =
        (data && (data.message || data.error)) ||
        'ACS API 呼び出しに失敗しました (HTTP ' + status + ')';
      throw new Error(message);
    }

    return data || {};
  }

  function normalizeRecords(records) {
    if (Array.isArray(records)) {
      return records;
    }
    if (records && typeof records === 'object') {
      return Object.keys(records).length ? [records] : [];
    }
    return [];
  }

  function fetchAll(path, query) {
    const collected = [];
    let offset = 0;
    const baseQuery = query || {};
    const defaultLimit = 100;

    while (true) {
      const page = request(path, {
        query: Object.assign({ offset: offset, limit: baseQuery.limit || defaultLimit }, baseQuery),
      });

      const records = normalizeRecords(page && page.records);
      if (records.length) {
        collected.push.apply(collected, records);
      }

      const header = page && page.header;
      const totalCount = header && Number(header.count);
      const pageLimit = header && Number(header.limit) ? Number(header.limit) : (records.length || defaultLimit);

      offset += pageLimit;
      if (!totalCount || offset >= totalCount || records.length === 0) {
        break;
      }
    }

    return collected;
  }

  function findFirstMatch(records, identifier) {
    if (!identifier) {
      return null;
    }
    const lowered = String(identifier).toLowerCase();
    return records.find(function(record) {
      if (!record) {
        return false;
      }
      if (record.id && String(record.id) === identifier) {
        return true;
      }
      if (record.name && String(record.name).toLowerCase() === lowered) {
        return true;
      }
      return false;
    });
  }

  function findPromotionId(identifier) {
    const promotions = fetchAll('/promotion/search', { id: identifier, name: identifier });
    const match = findFirstMatch(promotions, identifier);
    return match && match.id ? String(match.id) : null;
  }

  function findAffiliateId(identifier) {
    const affiliates = fetchAll('/user/search', { id: identifier, name: identifier });
    const match = findFirstMatch(affiliates, identifier);
    return match && match.id ? String(match.id) : null;
  }

  function listMediaIdsByAffiliate(affiliateId) {
    if (!affiliateId) {
      return [];
    }
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

/**
 * 提携申請シートから渡された行データを元に、広告とアフィリエイターを検索して提携申請をまとめて登録します。
 *
 * @param {Array<Object>} rows
 * @return {{ summary: Object, results: Object[] }}
 */
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
      if (!promotionId) {
        throw new Error('広告が見つかりませんでした。');
      }

      const affiliateId = api.findAffiliateId(affiliateIdentifier);
      if (!affiliateId) {
        throw new Error('アフィリエイターが見つかりませんでした。');
      }

      const mediaIds = api.listMediaIdsByAffiliate(affiliateId);
      if (!mediaIds.length) {
        throw new Error('対象アフィリエイターのメディアが見つかりませんでした。');
      }

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
      if (appliedMedia.length) {
        messages.push('申請済み: ' + appliedMedia.join(', '));
      }
      if (failedMedia.length) {
        messages.push('失敗: ' + failedMedia.join(' / '));
      }

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
