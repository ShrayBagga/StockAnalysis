from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_cors import CORS
import os
import json
import requests
from datetime import datetime
import pytz
import pandas as pd
import numpy as np
import yfinance as yf
import logging
from datetime import datetime, timedelta
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type, RetryError # Import RetryError
import time # Import the time module

# Load environment variables from .env file (even if no specific keys are used now, it's good practice)
# from dotenv import load_dotenv # Uncomment if you decide to use .env for API keys
# load_dotenv() # Uncomment if you decide to use .env for API keys

app = Flask(__name__,
            template_folder='templates',
            static_folder='static')
CORS(app)

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s') # MODIFIED LINE: Changed to DEBUG

WATCHLIST_FILE = 'watchlist.json'
DEFAULT_STOCKS_FILE = 'default_stocks.json'

# Reduced default company tickers to 3 as requested
DEFAULT_COMPANY_TICKERS = ["AAPL", "MSFT", "GOOGL"]
DEFAULT_INDEX_FUNDS = ["SPY", "QQQ", "DIA"] # Not directly used in analysis but kept for default list

# Caching for yfinance data to reduce API calls for frequent requests
STOCK_DATA_CACHE = {}
CACHE_EXPIRATION_SECONDS = 3600 * 4 # Cache data for 4 hours

def load_watchlist():
    """Loads the watchlist from a JSON file. Initializes an empty list if file not found or corrupted."""
    if os.path.exists(WATCHLIST_FILE):
        with open(WATCHLIST_FILE, 'r') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                logging.warning(f"{WATCHLIST_FILE} is empty or malformed. Initializing empty watchlist.")
                return []
    return []

def save_watchlist(watchlist):
    """Saves the current watchlist to a JSON file."""
    with open(WATCHLIST_FILE, 'w') as f:
        json.dump(watchlist, f, indent=4)

def load_default_stocks():
    """Loads default stocks from a JSON file. Initializes with defaults if file not found."""
    if os.path.exists(DEFAULT_STOCKS_FILE):
        with open(DEFAULT_STOCKS_FILE, 'r') as f:
            try:
                data = json.load(f)
                return data.get("companies", []), data.get("index_funds", [])
            except json.JSONDecodeError:
                logging.warning(f"{DEFAULT_STOCKS_FILE} is empty or malformed. Initializing default stocks.")
                return DEFAULT_COMPANY_TICKERS, DEFAULT_INDEX_FUNDS
    # If file doesn't exist, create it with defaults
    with open(DEFAULT_STOCKS_FILE, 'w') as f:
        json.dump({
            "companies": DEFAULT_COMPANY_TICKERS,
            "index_funds": DEFAULT_INDEX_FUNDS
        }, f, indent=4)
    return DEFAULT_COMPANY_TICKERS, DEFAULT_INDEX_FUNDS

def get_current_est_time():
    """Get current time in EST/EDT."""
    est = pytz.timezone('America/New_York')
    return datetime.now(est)

# Helper function to fetch yfinance info with retry logic
@retry(wait=wait_exponential(multiplier=1, min=4, max=10), # Start with 4s, max 10s delay
       stop=stop_after_attempt(5), # Try up to 5 times
       retry=retry_if_exception_type((requests.exceptions.HTTPError, json.JSONDecodeError, ValueError))) # Retry on HTTP errors (like 429), JSON errors, and custom ValueError for empty info
def _fetch_yfinance_info_with_retry(ticker_obj):
    """
    Helper function to fetch yfinance info with retry logic for specific errors.
    Raises ValueError if info is empty after fetching.
    """
    info = ticker_obj.info
    logging.debug(f"Raw yfinance info for {ticker_obj.ticker}: {info}") # ADDED LINE
    if not info:
        # If info is empty but no explicit exception, still treat as a failure for retry purposes
        raise ValueError("Yfinance returned empty info data.")
    return info

def fetch_stock_data_from_yfinance(ticker):
    """
    Fetches comprehensive stock data for a given ticker using yfinance.
    Includes caching mechanism and retry logic.
    """
    current_time = datetime.now()
    if ticker in STOCK_DATA_CACHE and \
       (current_time - STOCK_DATA_CACHE[ticker]['timestamp']).total_seconds() < CACHE_EXPIRATION_SECONDS:
        logging.info(f"Serving {ticker} data from cache.")
        return STOCK_DATA_CACHE[ticker]['data'], []

    logging.info(f"Fetching fresh data for {ticker} from yfinance.")
    
    # Introduce a small delay before fetching to mitigate rate limiting
    # This acts as a client-side throttle for individual requests.
    time.sleep(30) # Increased wait to 30 seconds as requested

    stock_data = {}
    errors = []

    try:
        ticker_obj = yf.Ticker(ticker)
        
        # Fetch info using the retry helper
        try:
            info = _fetch_yfinance_info_with_retry(ticker_obj)
        except RetryError as re: # Catch the specific RetryError from tenacity if all retries fail
            last_exception = re.last_attempt.exception()
            if isinstance(last_exception, requests.exceptions.HTTPError) and last_exception.response.status_code == 429:
                errors.append(f"Rate limit hit for {ticker} (429 Too Many Requests) after multiple retries. Please try again later.")
            elif isinstance(last_exception, json.JSONDecodeError):
                errors.append(f"JSON decode error for {ticker}. Invalid response from yfinance after multiple retries. Error: {last_exception}")
            elif isinstance(last_exception, ValueError):
                 errors.append(f"No info data found for {ticker} after multiple retries. Error: {last_exception}")
            else:
                errors.append(f"Failed to retrieve info for {ticker} after multiple retries. Last error: {last_exception}")
            logging.error(f"Failed to retrieve info for {ticker} after retries: {last_exception}")
            return {}, errors
        except Exception as e: # Catch any other unexpected errors not handled by retry
            errors.append(f"An unexpected error occurred while fetching info for {ticker}: {e}")
            logging.error(f"Unexpected error during yfinance info fetch for {ticker}: {e}")
            return {}, errors

        # Basic Info
        stock_data['ticker'] = ticker
        stock_data['companyName'] = info.get('longName') or info.get('shortName', 'N/A')
        stock_data['currentPrice'] = info.get('currentPrice')
        stock_data['openPrice'] = info.get('open')
        stock_data['previousClose'] = info.get('previousClose')
        stock_data['dayHigh'] = info.get('dayHigh')
        stock_data['dayLow'] = info.get('dayLow')
        stock_data['volume'] = info.get('volume')
        stock_data['marketCap'] = info.get('marketCap')
        stock_data['currency'] = info.get('currency')
        stock_data['industry'] = info.get('industry')
        stock_data['sector'] = info.get('sector')
        stock_data['fullTimeEmployees'] = info.get('fullTimeEmployees')
        stock_data['businessSummary'] = info.get('longBusinessSummary', 'No business summary available.')
        stock_data['weburl'] = info.get('website')

        # Price Change Calculation (using current price vs previous close)
        if stock_data['currentPrice'] is not None and stock_data['previousClose'] is not None:
            stock_data['priceChange'] = stock_data['currentPrice'] - stock_data['previousClose']
            if stock_data['previousClose'] != 0:
                stock_data['percentChange'] = (stock_data['priceChange'] / stock_data['previousClose']) * 100
            else:
                stock_data['percentChange'] = 0
        else:
            stock_data['priceChange'] = None
            stock_data['percentChange'] = None

        # Financial Ratios
        stock_data['peRatio'] = info.get('trailingPE')
        stock_data['forwardPE'] = info.get('forwardPE')
        stock_data['dividendYield'] = info.get('dividendYield')
        stock_data['beta'] = info.get('beta')
        stock_data['52WeekHigh'] = info.get('fiftyTwoWeekHigh')
        stock_data['52WeekLow'] = info.get('fiftyTwoWeekLow')
        stock_data['exDividendDate'] = info.get('exDividendDate') # This is a timestamp, will need conversion

        # Convert exDividendDate from timestamp to readable date if available
        if isinstance(stock_data['exDividendDate'], (int, float)):
            try:
                stock_data['exDividendDate'] = datetime.fromtimestamp(stock_data['exDividendDate'], tz=pytz.utc).strftime('%Y-%m-%d')
            except (TypeError, ValueError):
                stock_data['exDividendDate'] = None # Invalid timestamp

        # IPO Date (using start_date from YF history if available, or firstTradeDate from info)
        ipo_date = info.get('firstTradeDateEpochUtc')
        if ipo_date:
            try:
                stock_data['ipo'] = datetime.fromtimestamp(ipo_date, tz=pytz.utc).strftime('%Y-%m-%d')
            except (TypeError, ValueError):
                stock_data['ipo'] = 'N/A'
        else:
            stock_data['ipo'] = 'N/A' # Fallback

        # Analyst Recommendations (from info directly, or mock if not available)
        stock_data['analystRecommendation'] = info.get('recommendationKey', 'Data Unavailable').replace('_', ' ').title()
        stock_data['analystTargetPrice'] = info.get('targetMeanPrice')

        # Calculate analyst upside using target price and current price
        if stock_data['analystTargetPrice'] and stock_data['currentPrice'] and stock_data['currentPrice'] != 0:
            stock_data['analystUpside'] = (stock_data['analystTargetPrice'] - stock_data['currentPrice']) / stock_data['currentPrice']
        else:
            stock_data['analystUpside'] = None

        # Fetch historical data for charting (last 1 year) - this will still be fetched by backend
        # even if frontend doesn't chart it. It's used for technical analysis score.
        history_df = ticker_obj.history(period="1y")
        stock_data['historicalData'] = []
        if not history_df.empty:
            history_df.reset_index(inplace=True)
            history_df['Date'] = history_df['Date'].dt.strftime('%Y-%m-%d')
            stock_data['historicalData'] = history_df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']].to_dict(orient='records')
        else:
            errors.append(f"No historical data found for {ticker}.")

    except Exception as e:
        logging.error(f"Error fetching data for {ticker} from yfinance: {e}")
        errors.append(f"yfinance data fetch error: {e}")
        stock_data = {} # Clear partial data if a major error occurs

    if not stock_data and not errors: # If stock_data is empty and no explicit errors logged, means general failure
         errors.append(f"Could not retrieve any data for {ticker}. It might be an invalid ticker or temporarily unavailable.")

    # Cache the result if successful
    if stock_data:
        STOCK_DATA_CACHE[ticker] = {
            'data': stock_data,
            'timestamp': current_time
        }
    logging.debug(f"Final processed stock_data for {ticker}: {stock_data}") # ADDED LINE
    return stock_data, errors

def calculate_analyst_rating_score(recommendation):
    """Calculates a score (0-100) based on analyst recommendation."""
    if recommendation == "Strong Buy":
        return 100, "Analysts strongly recommend buying based on consensus ratings."
    elif recommendation == "Buy":
        return 80, "Analysts generally recommend buying."
    elif recommendation == "Hold":
        return 50, "Analysts suggest holding, expecting modest performance."
    elif recommendation == "Sell":
        return 20, "Analysts recommend selling due to anticipated underperformance."
    elif recommendation == "Strong Sell":
        return 0, "Analysts strongly recommend selling due to significant concerns."
    return 50, "Analyst recommendation data unavailable or neutral." # Neutral if unknown/unavailable

def calculate_analyst_upside_score(upside_percent):
    """Calculates a score (0-100) based on analyst upside percentage with tiered logic."""
    if upside_percent is None or not isinstance(upside_percent, (int, float)):
        return 50, "Analyst target price or upside data not available." # Neutral if no data
    
    # Tiered scoring for upside
    if upside_percent >= 0.25: # 25% or more
        return 100, f"Significant upside potential of {(upside_percent * 100):.2f}% according to target prices."
    elif upside_percent >= 0.15: # 15% to 24.99%
        return 90, f"High upside potential of {(upside_percent * 100):.2f}% based on target prices."
    elif upside_percent >= 0.08: # 8% to 14.99%
        return 75, f"Moderate upside potential of {(upside_percent * 100):.2f}% based on target prices."
    elif upside_percent >= 0.02: # 2% to 7.99%
        return 60, f"Modest upside potential of {(upside_percent * 100):.2f}% based on target prices."
    elif upside_percent >= -0.05: # -5% to 1.99% (slight downside or flat)
        return 40, f"Limited upside or slight downside of {(upside_percent * 100):.2f}% based on target prices."
    else: # More than 5% downside
        return 10, f"Significant downside risk of {(upside_percent * 100):.2f}% based on target prices."

def calculate_financial_analysis_score(info):
    """
    Calculates a score (0-100) based on key financial metrics.
    Includes more metrics for a robust score.
    """
    score = 0
    reasons = []

    pe_ratio = info.get('trailingPE')
    forward_pe = info.get('forwardPE')
    dividend_yield = info.get('dividendYield')
    market_cap = info.get('marketCap')
    beta = info.get('beta')
    
    # PE Ratio (lower is generally better, but penalize negative or extremely high)
    if isinstance(pe_ratio, (int, float)) and pe_ratio > 0:
        if pe_ratio < 15:
            score += 25
            reasons.append(f"Healthy Trailing P/E Ratio ({pe_ratio:.2f}) indicates good valuation.")
        elif pe_ratio < 25:
            score += 15
            reasons.append(f"Moderate Trailing P/E Ratio ({pe_ratio:.2f}).")
        else:
            score += 5
            reasons.append(f"High Trailing P/E Ratio ({pe_ratio:.2f}) suggests potential overvaluation or high growth expectations.")
    else:
        reasons.append("Trailing P/E Ratio N/A or not positive, limiting valuation insight.")

    # Forward PE Ratio
    if isinstance(forward_pe, (int, float)) and forward_pe > 0:
        if forward_pe < 15:
            score += 20
            reasons.append(f"Strong Forward P/E Ratio ({forward_pe:.2f}) suggests future earnings growth.")
        elif forward_pe < 25:
            score += 10
            reasons.append(f"Moderate Forward P/E Ratio ({forward_pe:.2f}).")
        else:
            score += 2
            reasons.append(f"High Forward P/E Ratio ({forward_pe:.2f}).")
    else:
        reasons.append("Forward P/E Ratio N/A or not positive.")

    # Dividend Yield (higher is better for income, 0 for non-dividend or negative for high risk)
    if isinstance(dividend_yield, (int, float)) and dividend_yield > 0:
        if dividend_yield >= 0.03: # 3% or more
            score += 20
            reasons.append(f"Attractive Dividend Yield of {(dividend_yield * 100):.2f}% provides income.")
        elif dividend_yield >= 0.01: # 1% to <3%
            score += 10
            reasons.append(f"Modest Dividend Yield of {(dividend_yield * 100):.2f}%.")
        else:
            score += 5
            reasons.append(f"Low Dividend Yield of {(dividend_yield * 100):.2f}%.")
    else:
        reasons.append("No significant dividend yield, common for growth stocks or those reinvesting earnings.")

    # Market Cap (larger implies stability, but also slower growth) - Score based on being a substantial company
    if isinstance(market_cap, (int, float)) and market_cap > 0:
        if market_cap >= 200e9: # Mega-cap
            score += 15
            reasons.append("Large market capitalization suggests stability and market leadership.")
        elif market_cap >= 10e9: # Large-cap
            score += 10
            reasons.append("Solid large-cap market capitalization.")
        elif market_cap >= 2e9: # Mid-cap
            score += 5
            reasons.append("Mid-cap company with potential for growth.")
        else:
            reasons.append("Smaller market capitalization, potentially higher risk/reward.")
    else:
        reasons.append("Market capitalization data unavailable.")

    # Beta (lower beta implies less volatility, which can be good for stability)
    if isinstance(beta, (int, float)):
        if beta < 0.8:
            score += 20
            reasons.append(f"Low Beta ({beta:.2f}) indicates lower volatility relative to the market.")
        elif beta < 1.2:
            score += 10
            reasons.append(f"Moderate Beta ({beta:.2f}) suggests volatility in line with the market.")
        else:
            score += 5
            reasons.append(f"High Beta ({beta:.2f}) implies higher volatility and potentially higher risk.")
    else:
        reasons.append("Beta (market volatility) data unavailable.")

    # Max possible score with current weights: 25+20+20+15+20 = 100
    final_score = int(min(100, score)) # Cap at 100
    if not reasons: reasons.append("Limited financial data available for comprehensive analysis.")
    return final_score, reasons

def calculate_technical_analysis_score(historical_data, current_price, fifty_two_week_high, fifty_two_week_low):
    """
    Calculates a score (0-100) based on technical indicators including MAs and 52-week range.
    """
    score = 0
    reasons = []

    if not historical_data or len(historical_data) < 200: # Need enough data for 200-day MA
        return 50, ["Insufficient historical data for comprehensive technical analysis (less than 200 days)."]

    # Convert to pandas DataFrame for easier calculations
    df = pd.DataFrame(historical_data)
    # Ensure 'Date' is datetime and 'Close' is numeric
    df['Date'] = pd.to_datetime(df['Date'])
    df['Close'] = pd.to_numeric(df['Close'])
    df = df.set_index('Date').sort_index()

    if current_price is None or not isinstance(current_price, (int, float)):
        # Fallback to last close if current_price is not explicitly provided
        current_price = df['Close'].iloc[-1]
        reasons.append("Using last available closing price for current price in technical analysis.")

    # Calculate Moving Averages
    df['MA50'] = df['Close'].rolling(window=50).mean()
    df['MA200'] = df['Close'].rolling(window=200).mean()

    last_ma50 = df['MA50'].iloc[-1] if not df['MA50'].isnull().all() else None
    last_ma200 = df['MA200'].iloc[-1] if not df['MA200'].isnull().all() else None

    # MA Crossover Analysis (weight: 40 points)
    if last_ma50 is not None and last_ma200 is not None:
        if current_price > last_ma50 and current_price > last_ma200:
            score += 40
            reasons.append(f"Price ({current_price:.2f}) is above 50-day ({last_ma50:.2f}) and 200-day ({last_ma200:.2f}) moving averages (Bullish trend).")
        elif current_price > last_ma50:
            score += 25
            reasons.append(f"Price ({current_price:.2f}) is above 50-day moving average ({last_ma50:.2f}) (Positive short-term momentum).")
        elif current_price > last_ma200:
            score += 15
            reasons.append(f"Price ({current_price:.2f}) is above 200-day moving average ({last_ma200:.2f}) (Long-term trend support).")
        else:
            score += 5
            reasons.append(f"Price ({current_price:.2f}) is below key moving averages, indicating bearish pressure.")
    else:
        reasons.append("Not enough data to calculate 50-day or 200-day moving averages.")

    # 52-Week High/Low (weight: 30 points)
    if fifty_two_week_high and fifty_two_week_low and current_price:
        price_range = fifty_two_week_high - fifty_two_week_low
        if price_range > 0:
            position_in_range = (current_price - fifty_two_week_low) / price_range
            if position_in_range >= 0.9:
                score += 30
                reasons.append(f"Price is near 52-week high ({fifty_two_week_high:.2f}), showing strong upward momentum.")
            elif position_in_range >= 0.7:
                score += 20
                reasons.append(f"Price is in the upper range of 52-week performance ({current_price:.2f}).")
            elif position_in_range <= 0.1:
                score += 0
                reasons.append(f"Price is near 52-week low ({fifty_two_week_low:.2f}), indicating weakness.")
            elif position_in_range <= 0.3:
                score += 5
                reasons.append(f"Price is in the lower range of 52-week performance ({current_price:.2f}).")
            else:
                score += 10
                reasons.append(f"Price is in the mid-range of its 52-week performance ({current_price:.2f}).")
        else:
            reasons.append("52-week high and low are too close or invalid for range analysis.")
    else:
        reasons.append("52-Week High/Low data not available for range analysis.")

    # Recent Price Performance (e.g., last month, weight: 30 points)
    if len(df) >= 20: # Approx one month of trading days
        start_price = df['Close'].iloc[-20] # Price 20 trading days ago
        end_price = df['Close'].iloc[-1] # Current last close in historical data
        if start_price != 0:
            recent_change = (end_price - start_price) / start_price
            if recent_change >= 0.05: # Gained 5% or more
                score += 30
                reasons.append(f"Strong recent performance: Price up {(recent_change * 100):.2f}% over the last month.")
            elif recent_change >= 0.01: # Gained 1-5%
                score += 20
                reasons.append(f"Positive recent performance: Price up {(recent_change * 100):.2f}% over the last month.")
            elif recent_change <= -0.05: # Lost 5% or more
                score += 0
                reasons.append(f"Weak recent performance: Price down {(abs(recent_change) * 100):.2f}% over the last month.")
            elif recent_change < 0: # Lost up to 5%
                score += 10
                reasons.append(f"Slightly negative recent performance: Price down {(abs(recent_change) * 100):.2f}% over the last month.")
            else:
                score += 15
                reasons.append("Stable recent performance over the last month.")
        else:
            reasons.append("Cannot calculate recent performance due to zero starting price.")
    else:
        reasons.append("Insufficient data for recent price performance analysis (less than 1 month).")
    
    final_score = int(min(100, score))
    if not reasons: reasons.append("Limited technical data available for comprehensive analysis.")
    return final_score, reasons


def calculate_overall_score_and_reasons(stock_data):
    """
    Calculates overall score, individual metric scores, and reasons for recommendation.
    Applies weights: 25% for Analyst Rating, 25% for Analyst Upside, 25% for Financial, 25% for Technical.
    """
    overall_score = 0
    detailed_reasons = [] # List of reasons with scores
    score_breakdown = {}

    # 1. Analyst Rating Score
    analyst_recommendation = stock_data.get('analystRecommendation')
    analyst_rating_score, reason_ar = calculate_analyst_rating_score(analyst_recommendation)
    score_breakdown['analystRating'] = analyst_rating_score
    detailed_reasons.append(f"Analyst Rating: {analyst_recommendation} - {reason_ar} (Score: {analyst_rating_score}%)")

    # 2. Analyst Upside Score
    analyst_upside = stock_data.get('analystUpside')
    analyst_upside_score, reason_au = calculate_analyst_upside_score(analyst_upside)
    score_breakdown['analystUpside'] = analyst_upside_score
    detailed_reasons.append(f"Analyst Upside: {(analyst_upside * 100):.2f}% - {reason_au} (Score: {analyst_upside_score}%)")

    # 3. Financial Analysis Score
    financial_analysis_score, reason_fa = calculate_financial_analysis_score(stock_data)
    score_breakdown['financialAnalysis'] = financial_analysis_score
    detailed_reasons.append(f"Financial Analysis: {'; '.join(reason_fa)} (Score: {financial_analysis_score}%)")

    # 4. Technical Analysis Score
    historical_data = stock_data.get('historicalData', [])
    current_price = stock_data.get('currentPrice')
    fifty_two_week_high = stock_data.get('52WeekHigh')
    fifty_two_week_low = stock_data.get('52WeekLow')
    technical_analysis_score, reason_ta = calculate_technical_analysis_score(historical_data, current_price, fifty_two_week_high, fifty_two_week_low)
    score_breakdown['technicalAnalysis'] = technical_analysis_score
    detailed_reasons.append(f"Technical Analysis: {'; '.join(reason_ta)} (Score: {technical_analysis_score}%)")

    # Calculate Overall Score with 25% weighting for each category
    overall_score = (
        analyst_rating_score * 0.25 +
        analyst_upside_score * 0.25 +
        financial_analysis_score * 0.25 +
        technical_analysis_score * 0.25
    )

    stock_data['overallScore'] = int(round(overall_score, 0)) # Round to nearest integer
    stock_data['scoreBreakdown'] = score_breakdown

    # Determine overall suggestion based on overall_score
    if stock_data['overallScore'] >= 85:
        stock_data['suggestion'] = 'Strong Buy'
        detailed_reasons.insert(0, f"**Overall Recommendation: Strong Buy** - The stock exhibits excellent performance across all key indicators, suggesting a high-conviction buying opportunity.")
    elif stock_data['overallScore'] >= 70:
        stock_data['suggestion'] = 'Buy'
        detailed_reasons.insert(0, f"**Overall Recommendation: Buy** - The stock shows strong potential with favorable analyst sentiment, solid financials, and positive technical trends.")
    elif stock_data['overallScore'] >= 50:
        stock_data['suggestion'] = 'Hold'
        detailed_reasons.insert(0, f"**Overall Recommendation: Hold** - The stock presents a balanced profile. Consider holding if already invested, or wait for clearer signals if not.")
    elif stock_data['overallScore'] >= 30:
        stock_data['suggestion'] = 'Sell'
        detailed_reasons.insert(0, f"**Overall Recommendation: Sell** - The stock shows some concerning indicators across analyst, financial, or technical fronts. Consider exiting your position.")
    else:
        stock_data['suggestion'] = 'Strong Sell'
        detailed_reasons.insert(0, f"**Overall Recommendation: Strong Sell** - The stock demonstrates significant weaknesses, indicating a high risk and strong recommendation to sell.")

    stock_data['reasons'] = detailed_reasons

    return stock_data

# --- API Routes ---

@app.route('/')
def index():
    """Serve the main HTML page from the templates directory."""
    return render_template('index.html')

@app.route('/api/watchlist', methods=['GET'])
def get_watchlist_api():
    watchlist = load_watchlist()
    return jsonify(watchlist)

@app.route('/api/watchlist', methods=['POST'])
def add_to_watchlist_api():
    data = request.get_json()
    ticker = data.get('ticker')
    if not ticker:
        return jsonify({"error": "Ticker not provided"}), 400

    ticker = ticker.upper()
    watchlist = load_watchlist()
    if ticker not in watchlist:
        watchlist.append(ticker)
        save_watchlist(watchlist)
        return jsonify({"message": f"{ticker} added to watchlist successfully."}), 200
    return jsonify({"error": f"{ticker} is already in the watchlist."}), 409

@app.route('/api/watchlist', methods=['DELETE'])
def remove_from_watchlist_api():
    data = request.get_json()
    ticker = data.get('ticker')
    if not ticker:
        return jsonify({"error": "Ticker not provided"}), 400

    ticker = ticker.upper()
    watchlist = load_watchlist()
    if ticker in watchlist:
        watchlist.remove(ticker)
        save_watchlist(watchlist)
        return jsonify({"message": f"{ticker} removed from watchlist successfully."}), 200
    return jsonify({"error": f"{ticker} not found in watchlist."}), 404

@app.route('/api/default_stocks', methods=['GET'])
def get_default_stocks_api():
    company_tickers, index_funds = load_default_stocks()
    return jsonify({
        "companies": company_tickers,
        "index_funds": index_funds
    })

@app.route('/api/stock_data', methods=['GET'])
def get_stock_data_api():
    ticker_symbol = request.args.get('ticker')
    if not ticker_symbol:
        return jsonify({"success": False, "error": "Ticker symbol is required."}), 400

    stock_data, errors = fetch_stock_data_from_yfinance(ticker_symbol)

    if stock_data:
        # Calculate overall score, individual metric scores, and reasons
        analyzed_stock_data = calculate_overall_score_and_reasons(stock_data)
        return jsonify({"success": True, "stockData": analyzed_stock_data, "errors": errors if errors else None})
    else:
        return jsonify({"success": False, "error": f"Failed to retrieve data for {ticker_symbol}. It might be an invalid ticker or data is temporarily unavailable. Detailed errors: {'; '.join(errors)}", "detailedErrors": errors}), 404

if __name__ == '__main__':
    # Ensure watchlist.json and default_stocks.json exist on startup
    if not os.path.exists(WATCHLIST_FILE):
        save_watchlist([])
    if not os.path.exists(DEFAULT_STOCKS_FILE):
        with open(DEFAULT_STOCKS_FILE, 'w') as f:
            json.dump({
                "companies": DEFAULT_COMPANY_TICKERS,
                "index_funds": DEFAULT_INDEX_FUNDS
            }, f, indent=4)

    est_time = get_current_est_time()
    logging.info(f"Flask server starting. Current EST time: {est_time.strftime('%Y-%m-%d %H:%M:%S %Z%z')}")
    app.run(port=5002, debug=True, use_reloader=False) # use_reloader=False recommended for some environments