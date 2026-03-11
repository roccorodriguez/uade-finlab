import yfinance as yf
import asyncio

def fetch_ticker_data(t):
    try:
        fi = yf.Ticker(t).fast_info
        price      = fi.last_price or 0
        prev_close = fi.previous_close or 0

        if price and prev_close:
            change_abs = price - prev_close
            change_pct = (change_abs / prev_close) * 100
        else:
            change_abs = 0.0
            change_pct = 0.0

        return {
            "symbol": t.replace("^", ""),
            "price": f"{price:.2f}",
            "change": f"{change_pct:+.2f}",
            "change_abs": f"{change_abs:+.2f}"
        }
    except Exception as e:
        print(f"Exception for {t}: {e}")
        return {"symbol": t.replace("^", ""), "price": "0.00", "change": "0.00", "change_abs": "0.00"}

name_map = {
    "CL=F": "WTI CRUDE", "GC=F": "GOLD", "SI=F": "SILVER", "HG=F": "COPPER", "ZS=F": "SOYBEANS",
    "^GSPC": "S&P 500", "^DJI": "DOW JONES", "^IXIC": "NASDAQ", "^VIX": "VIX", "^MERV": "MERVAL"
}

def fetch_group(tickers):
    results = []
    for t in tickers:
        data = fetch_ticker_data(t)
        data['name'] = name_map.get(t, data['symbol'])
        results.append(data)
    return results

commodities = ["CL=F", "GC=F", "SI=F", "HG=F", "ZS=F"] 
indices = ["^GSPC", "^DJI", "^IXIC", "^VIX", "^MERV"] 

async def main():
    comm_task = asyncio.to_thread(fetch_group, commodities)
    idx_task = asyncio.to_thread(fetch_group, indices)
    
    comp_results, idx_results = await asyncio.gather(comm_task, idx_task)
    print("FINISHED")
    print(comp_results)

if __name__ == "__main__":
    asyncio.run(main())
