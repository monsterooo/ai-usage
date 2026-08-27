const React = require('react');

// 这里优先读云端 JSON；如果你还在本机调试，也可以直接读本地文件。

export const refreshFrequency = 15000;
export const className = `
  top: 24px;
  right: 24px;
  width: 360px;
  padding: 14px 14px 12px;
  box-sizing: border-box;
  color: #e8eef9;
  background: rgba(15, 19, 26, 0.92);
  border: 1px solid rgba(120, 140, 170, 0.22);
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  line-height: 1.45;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
`;

export const command = String.raw`
  set -e
  if [ -n "$GROK_USAGE_URL" ]; then
    curl -fsSL "$GROK_USAGE_URL"
  elif [ -f /tmp/grok-hook.log ]; then
    cat /tmp/grok-hook.log
  else
    curl -fsSL "http://127.0.0.1:8787/data"
  fi
`;

function safeParse(output) {
  if (!output) return { ok: false, error: 'No data yet' };
  try {
    return JSON.parse(output);
  } catch (error) {
    return { ok: false, error: error.message, raw: output };
  }
}

function formatValue(value) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function pickSummary(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }

  const preferredKeys = [
    'status',
    'state',
    'updated_at',
    'updatedAt',
    'last_updated',
    'lastUpdated',
    'credits',
    'usage',
    'balance',
    'remaining',
    'total',
    'limit',
  ];

  const summary = [];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      summary.push([key, data[key]]);
    }
  }

  if (summary.length > 0) return summary;

  return Object.entries(data).slice(0, 6);
}

function RawObject({ data }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return React.createElement('pre', {
      style: {
        margin: '10px 0 0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: '#c6d3e6',
      },
    }, formatValue(data));
  }

  const rows = pickSummary(data);
  return React.createElement(
    'div',
    { style: { marginTop: '10px' } },
    rows.map(([key, value]) =>
      React.createElement(
        'div',
        {
          key,
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '6px',
          },
        },
        React.createElement('span', { style: { color: '#9fb0c7', minWidth: '110px' } }, key),
        React.createElement(
          'span',
          {
            style: {
              color: '#f1f5fb',
              textAlign: 'right',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
            title: formatValue(value),
          },
          formatValue(value),
        ),
      ),
    ),
    React.createElement(
      'pre',
      {
        style: {
          margin: '10px 0 0',
          paddingTop: '10px',
          borderTop: '1px solid rgba(120, 140, 170, 0.16)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#c6d3e6',
          maxHeight: '220px',
          overflow: 'hidden',
        },
      },
      JSON.stringify(data, null, 2),
    ),
  );
}

export const render = ({ output, error }) => {
  if (error) {
    return React.createElement(
      'div',
      null,
      React.createElement('div', { style: { fontWeight: 600, marginBottom: '8px' } }, 'Grok Usage'),
      React.createElement('div', { style: { color: '#ffb3b3' } }, String(error)),
    );
  }

  const data = safeParse(output);

  return React.createElement(
    'div',
    null,
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '8px',
      },
    },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '13px' } }, 'Grok Usage'),
      React.createElement('div', { style: { color: '#9fb0c7', fontSize: '11px' } }, 'auto refresh'),
    ),
    React.createElement(
      'div',
      { style: { color: data.ok === false ? '#ffb3b3' : '#8fd19e' } },
      data.ok === false ? 'No data' : 'Latest JSON loaded',
    ),
    React.createElement(RawObject, { data }),
  );
};
