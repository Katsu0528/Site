/**
 * 提携申請フォーム（Web）の送信を処理します。
 * クライアントから渡された広告名／広告IDを解決して結果を返却します。
 */
function registerPromotionApplicationsFromWeb(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const results = normalizedRows.map((row, index) => {
    const resolution = resolvePromotionIdentifier(row && row.promotionIdentifier);
    return {
      rowNumber: index + 1,
      status: resolution.ok ? 'success' : 'error',
      promotionId: resolution.id || '',
      mediaId: (row && row.mediaIdentifier) || '',
      message: resolution.message,
    };
  });

  return {
    results,
    logs: buildResolutionLogs(results),
  };
}

/**
 * 広告名または広告IDを受け取り、API検索を使って広告IDを返します。
 * @param {string} identifier - 広告名または広告ID
 * @returns {{ ok: boolean, id: string, message: string }}
 */
function resolvePromotionIdentifier(identifier) {
  const normalized = (identifier || '').trim();
  if (!normalized) {
    return { ok: false, id: '', message: '広告名・広告IDが入力されていません。' };
  }

  if (looksLikePromotionId(normalized)) {
    return { ok: true, id: normalized, message: '入力値を広告IDとして使用しました。' };
  }

  const foundId = fetchPromotionIdByName(normalized);
  if (!foundId) {
    return { ok: false, id: '', message: 'API から広告IDを取得できませんでした。' };
  }

  return { ok: true, id: foundId, message: '広告名から広告IDを取得しました。' };
}

function looksLikePromotionId(value) {
  // UUID 形式や数字のみを広告IDとして受け付ける。
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const numericPattern = /^\d+$/;
  return uuidPattern.test(value) || numericPattern.test(value);
}

function fetchPromotionIdByName(name) {
  const response = callAcsApi('/promotion/search', { name });
  const records = (response && response.records) || [];
  const match = records.find(function (record) {
    return record && typeof record === 'object' && record.name === name && record.id;
  });
  return match ? String(match.id) : '';
}

function callAcsApi(path, query) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty('ACS_API_BASE_URL');
  const accessKey = props.getProperty('ACS_API_ACCESS_KEY');
  const secretKey = props.getProperty('ACS_API_SECRET_KEY');

  if (!baseUrl || !accessKey || !secretKey) {
    throw new Error('ACS API の接続設定が見つかりません。');
  }

  const url = buildApiUrl(baseUrl, path, query);
  const headers = { 'X-Auth-Token': accessKey + ':' + secretKey };
  const response = UrlFetchApp.fetch(url, { headers, method: 'get', muteHttpExceptions: true });
  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('ACS API 呼び出しに失敗しました: ' + status + ' ' + body);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('ACS API の応答を JSON として解析できませんでした。');
  }
}

function buildApiUrl(baseUrl, path, query) {
  const trimmedBase = String(baseUrl).replace(/\/$/, '');
  const sanitizedPath = String(path || '').replace(/^(?!\/)/, '/');
  const url = trimmedBase + sanitizedPath;

  const params = query && typeof query === 'object'
    ? Object.keys(query)
        .filter(function (key) { return query[key]; })
        .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]); })
    : [];

  if (!params.length) {
    return url;
  }

  return url + '?' + params.join('&');
}

function buildResolutionLogs(results) {
  const logs = [];
  (results || []).forEach(function (result) {
    if (!result) {
      return;
    }
    logs.push({
      level: result.status === 'success' ? 'success' : 'error',
      message: `行${result.rowNumber}: ${result.message}`,
    });
  });
  return logs;
}
