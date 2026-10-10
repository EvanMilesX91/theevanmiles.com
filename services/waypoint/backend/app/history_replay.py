"""Repeatable price-only replay from saved Alpaca bars. Never performs network I/O."""
import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from .backtest import Candle, run_backtest
from .providers import Bar


def cached_backtest(cache: dict[str, Any], symbol: str) -> dict[str, Any]:
    row = cache.get(f'bars:{symbol}:sip:split:1Day')
    if not row:
        old = cache.get(f'live:history:{symbol}', {})
        row = {'data': old.get('data', {}).get('bars', []), 'feed': 'sip', 'adjustment': 'split',
               'retrieved_at': old.get('checked_at'), 'timeframe': '1Day'}
    bars = [Bar.model_validate(item) for item in row.get('data', [])]
    # V1 historical loader saves completed daily periods. Exclude today's
    # period conservatively from research replay regardless of market clock.
    bars = [bar for bar in bars if bar.timestamp.date() < datetime.now(UTC).date()]
    if len(bars) < 15:
        raise ValueError('At least 15 locally cached completed daily bars are needed. Run the slow refresh first.')
    bars.sort(key=lambda bar: bar.timestamp)
    candles = [Candle(bar.timestamp, Decimal(bar.open), Decimal(bar.high), Decimal(bar.low), Decimal(bar.close)) for bar in bars]
    result = run_backtest(candles)
    for trade in result['trades']:
        trade['symbol'] = symbol
    result['description'] = (
        f'ALPACA HISTORICAL DATA — {symbol}, cached completed daily bars. Educational price-only walk-forward replay; '
        'not a test of the dashboard company thesis or evidence of predictive performance.'
    )
    result['limitations'][0] = 'One selected symbol; survivorship/selection bias is not controlled. This is not an archived point-in-time universe.'
    result['limitations'].append('Current split-adjusted history may contain subsequent corporate-action revisions; no point-in-time fundamental inputs are used.')
    result['assumptions']['benchmark'] = 'Buy-and-hold of the same cached symbol, with identical simulated costs; different exposure from the rule.'
    result['dataset'] = {'provider': 'Alpaca', 'symbol': symbol, 'feed': row.get('feed'),
                         'adjustment': row.get('adjustment'), 'downloaded_at': row.get('retrieved_at'),
                         'timeframe': '1Day', 'bars': len(bars),
                         'sha256': hashlib.sha256(json.dumps([bar.model_dump(mode='json') for bar in bars], sort_keys=True).encode()).hexdigest()}
    return result
