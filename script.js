// script.js - Frontend JavaScript for Stock Analysis Dashboard

// Define the Flask API URL. Using 127.0.0.1 explicitly for clarity.
const FLASK_API_URL = 'http://127.0.0.1:5002/api';

// Global variable to hold the chart instance
let historicalPriceChart;

// DOMContentLoaded ensures the HTML is fully loaded before running script
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded and parsed. Initializing dashboard components.");

    // Get references to key DOM elements
    const newTickerInput = document.getElementById('new-ticker-input');
    const addTickerBtn = document.getElementById('add-ticker-btn');
    const watchlistContainer = document.getElementById('watchlist-container');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Elements for overall analysis sections
    const analyzeAllStocksBtn = document.getElementById('analyze-all-stocks-btn');
    const overallAnalysisErrorDiv = document.getElementById('overall-analysis-error');

    // Modal elements
    const stockDetailModal = document.getElementById('stock-detail-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalTickerName = document.getElementById('modal-ticker-name');
    const modalCompanyName = document.getElementById('modal-company-name');
    const modalCurrentPrice = document.getElementById('modal-current-price');
    const modalPriceChange = document.getElementById('modal-price-change');
    const modalPercentChange = document.getElementById('modal-percent-change');
    const modalOpenPrice = document.getElementById('modal-open-price');
    const modalPreviousClose = document.getElementById('modal-previous-close');
    const modalDayHigh = document.getElementById('modal-day-high');
    const modalDayLow = document.getElementById('modal-day-low');
    const modalVolume = document.getElementById('modal-volume');
    const modalMarketCap = document.getElementById('modal-market-cap');
    const modalIndustry = document.getElementById('modal-industry');
    const modalSector = document.getElementById('modal-sector');
    const modalEmployees = document.getElementById('modal-employees');
    const modalWebsite = document.getElementById('modal-website');
    const modalIPO = document.getElementById('modal-ipo');
    const modalCurrency = document.getElementById('modal-currency');

    // Financial Ratios
    const modalPERatio = document.getElementById('modal-pe-ratio');
    const modalForwardPERatio = document.getElementById('modal-forward-pe-ratio');
    const modalDividendYield = document.getElementById('modal-dividend-yield');
    const modalExDividendDate = document.getElementById('modal-ex-dividend-date');
    const modal52WeekHigh = document.getElementById('modal-52-week-high');
    const modal52WeekLow = document.getElementById('modal-52-week-low');
    const modalBeta = document.getElementById('modal-beta');

    // Analyst Data
    const modalAnalystRecommendation = document.getElementById('modal-analyst-recommendation');
    const modalAnalystTargetPrice = document.getElementById('modal-analyst-target-price');
    const modalAnalystUpside = document.getElementById('modal-analyst-upside');

    // Business Summary
    const modalBusinessSummary = document.getElementById('modal-business-summary');

    // Metric Scores in Modal
    const metricAnalystRating = document.getElementById('metric-analyst-rating');
    const metricAnalystUpside = document.getElementById('metric-analyst-upside');
    const metricFinancialAnalysis = document.getElementById('metric-financial-analysis');
    const metricTechnicalAnalysis = document.getElementById('metric-technical-analysis');

    // Analysis Reasons List in Modal
    const modalReasonsList = document.getElementById('modal-long-term-list'); // Renamed for clarity in script

    // --- Helper Functions ---

    function showLoading() {
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
        }
    }

    function hideLoading() {
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
    }

    function showMessage(element, message, type = 'info', autoHide = true) {
        if (element) {
            element.innerHTML = message; // Use innerHTML to allow buttons
            element.className = 'message-box p-3 rounded mb-4 text-center'; // Reset classes
            if (type === 'error') {
                element.classList.add('bg-red-900', 'text-red-300', 'border', 'border-red-600');
            } else if (type === 'success') {
                element.classList.add('bg-green-900', 'text-green-300', 'border', 'border-green-600');
            } else { // info
                element.classList.add('bg-blue-900', 'text-blue-300', 'border', 'border-blue-600');
            }
            element.classList.remove('hidden'); // Ensure it's visible

            if (autoHide && type !== 'info') { // Auto-hide success/error messages after a delay
                setTimeout(() => {
                    hideMessage(element);
                }, 5000); // Hide after 5 seconds
            }
        }
    }

    function hideMessage(element) {
        if (element) {
            element.classList.add('hidden');
        }
    }

    /**
     * Formats a number to a currency string.
     * @param {number|null} num - The number to format.
     * @param {string} currencySymbol - The currency symbol (e.g., '$').
     * @param {number} decimals - Number of decimal places.
     * @returns {string} Formatted currency string.
     */
    function formatCurrency(num, currencySymbol = '$', decimals = 2) {
        if (typeof num !== 'number' || !isFinite(num)) {
            return 'N/A';
        }
        return `${currencySymbol}${num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
    }

    /**
     * Formats market cap into a human-readable string (e.g., $1.23T, $45.67B, $89.01M).
     * @param {number|null} marketCap - The market capitalization in numbers.
     * @returns {string} Formatted market cap string.
     */
    function formatMarketCap(marketCap) {
        if (typeof marketCap !== 'number' || !isFinite(marketCap) || marketCap === 0) {
            return 'N/A';
        }
        const absMarketCap = Math.abs(marketCap); // Work with absolute value for magnitude

        if (absMarketCap >= 1e12) { // Trillions
            return `$${(marketCap / 1e12).toFixed(2)}T`;
        }
        if (absMarketCap >= 1e9) { // Billions
            return `$${(marketCap / 1e9).toFixed(2)}B`;
        }
        if (absMarketCap >= 1e6) { // Millions
            return `$${(marketCap / 1e6).toFixed(2)}M`;
        }
        if (absMarketCap >= 1e3) { // Thousands
            return `$${(marketCap / 1e3).toFixed(2)}K`;
        }
        return `$${marketCap.toFixed(2)}`;
    }

    /**
     * Formats large numbers like employee counts with commas.
     * @param {number|null} num - The number to format.
     * @returns {string} Formatted number string.
     */
    function formatNumber(num) {
        if (typeof num !== 'number' || !isFinite(num)) {
            return 'N/A';
        }
        return num.toLocaleString();
    }

    /**
     * Gets Tailwind CSS class for score-based coloring.
     * @param {number|string} score - The score percentage.
     * @returns {string} Tailwind CSS classes.
     */
    function getScoreColorClass(score) {
        if (score === 'N/A' || typeof score !== 'number') return 'text-gray-400';
        if (score >= 85) return 'text-green-500 font-bold'; // Strong Buy
        if (score >= 70) return 'text-lime-400'; // Buy (a bit brighter green)
        if (score >= 50) return 'text-yellow-400'; // Hold
        if (score >= 30) return 'text-orange-400'; // Sell (distinct orange)
        return 'text-red-500 font-bold'; // Strong Sell
    }

    /**
     * Gets Tailwind CSS class for suggestion-based coloring.
     * @param {string} suggestion - The suggestion string.
     * @returns {string} Tailwind CSS classes.
     */
    function getSuggestionColorClass(suggestion) {
        switch (suggestion) {
            case 'Strong Buy': return 'text-green-400 font-bold';
            case 'Buy': return 'text-lime-300'; // Brighter green for Buy
            case 'Hold': return 'text-yellow-300';
            case 'Sell': return 'text-orange-400'; // Clear red-orange for Sell
            case 'Data Unavailable': return 'text-gray-500 italic';
            case 'Analysis Error': return 'text-red-500 italic';
            case 'Neutral': return 'text-gray-400';
            default: return 'text-gray-400';
        }
    }

    /**
     * Gets Tailwind CSS class for price change coloring.
     * @param {number|string} percentChange - The percentage change.
     * @returns {string} Tailwind CSS classes.
     */
    function getPriceChangeColorClass(percentChange) {
        if (typeof percentChange !== 'number' || !isFinite(percentChange)) return 'text-gray-400';
        if (percentChange > 0) return 'text-green-400';
        if (percentChange < 0) return 'text-red-400';
        return 'text-gray-400'; // No change
    }

    // --- Watchlist Management Functions ---

    /**
     * Fetches the current watchlist from the Flask backend and displays it.
     */
    async function fetchWatchlist() {
        try {
            const response = await fetch(`${FLASK_API_URL}/watchlist`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Failed to fetch watchlist: ${errorData.error || response.statusText}`);
            }
            const watchlist = await response.json();
            displayWatchlist(watchlist);
            return watchlist; // Return for subsequent processing
        } catch (error) {
            console.error('Error fetching watchlist:', error);
            showMessage(overallAnalysisErrorDiv, `Failed to load watchlist: ${error.message}`, 'error');
            return [];
        }
    }

    /**
     * Displays the watchlist in the UI.
     * @param {string[]} watchlist - An array of ticker symbols.
     */
    function displayWatchlist(watchlist) {
        watchlistContainer.innerHTML = ''; // Clear previous entries
        if (watchlist.length === 0) {
            watchlistContainer.innerHTML = '<p class="text-gray-400">Your watchlist is empty. Add some stocks!</p>';
            return;
        }
        watchlist.forEach(ticker => {
            const tickerItem = document.createElement('div');
            tickerItem.className = 'watchlist-item flex items-center justify-between bg-gray-700 p-2 rounded mb-2';
            tickerItem.innerHTML = `
                <span class="text-lg font-semibold text-gray-200">${ticker}</span>
                <button class="remove-ticker-btn bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 rounded" data-ticker="${ticker}">Remove</button>
            `;
            watchlistContainer.appendChild(tickerItem);
        });
        addRemoveEventListeners();
    }

    /**
     * Adds a stock to the watchlist via API.
     * @param {string} ticker - The ticker symbol to add.
     */
    async function addTicker(ticker) {
        showLoading();
        hideMessage(overallAnalysisErrorDiv);
        try {
            const response = await fetch(`${FLASK_API_URL}/watchlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: ticker })
            });

            const result = await response.json();
            if (response.ok) {
                showMessage(overallAnalysisErrorDiv, result.message, 'success');
                newTickerInput.value = ''; // Clear input field
                await fetchWatchlist(); // Refresh watchlist display
                await fetchAndDisplayAllAnalysis(); // Re-analyze all stocks including the new one
            } else {
                showMessage(overallAnalysisErrorDiv, result.error || 'Failed to add ticker.', 'error');
            }
        } catch (error) {
            console.error('Error adding ticker:', error);
            showMessage(overallAnalysisErrorDiv, `Error adding ticker: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Removes a stock from the watchlist via API.
     * @param {string} ticker - The ticker symbol to remove.
     */
    async function removeTicker(ticker) {
        showLoading();
        hideMessage(overallAnalysisErrorDiv);
        try {
            const response = await fetch(`${FLASK_API_URL}/watchlist`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: ticker })
            });

            const result = await response.json();
            if (response.ok) {
                showMessage(overallAnalysisErrorDiv, result.message, 'success');
                await fetchWatchlist(); // Refresh watchlist display
                await fetchAndDisplayAllAnalysis(); // Re-analyze all stocks after removal
            } else {
                showMessage(overallAnalysisErrorDiv, result.error || 'Failed to remove ticker.', 'error');
            }
        } catch (error) {
            console.error('Error removing ticker:', error);
            showMessage(overallAnalysisErrorDiv, `Error removing ticker: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // --- Analysis Functions ---

    /**
     * Fetches analysis for a single stock. This is the core call to the /api/stock_data endpoint.
     * @param {string} ticker - The stock ticker symbol.
     * @returns {Promise<object|null>} The stock data object or null if an error occurs.
     */
    async function fetchStockAnalysis(ticker) {
        try {
            const response = await fetch(`${FLASK_API_URL}/stock_data?ticker=${ticker}`);
            const result = await response.json();
            if (result.success) {
                return result.stockData;
            } else {
                console.error(`Error fetching data for ${ticker}:`, result.error);
                // Return a standardized error object for consistent display
                return { 
                    ticker: ticker, 
                    error: result.error, 
                    companyName: 'N/A', 
                    currentPrice: 'N/A', 
                    overallScore: 'N/A', 
                    suggestion: 'Analysis Error',
                    reasons: [`Error: ${result.error || 'Could not fetch data.'}`],
                    percentChange: 'N/A' // Ensure this is present for dashboard display
                };
            }
        } catch (error) {
            console.error(`Network error fetching data for ${ticker}:`, error);
            return { 
                ticker: ticker, 
                error: `Network error: ${error.message}`, 
                companyName: 'N/A', 
                currentPrice: 'N/A', 
                overallScore: 'N/A', 
                suggestion: 'Analysis Error',
                reasons: [`Network error: ${error.message}`],
                percentChange: 'N/A' // Ensure this is present for dashboard display
            };
        }
    }

    /**
     * Fetches all default stocks and watchlist stocks and performs analysis.
     */
    async function fetchAndDisplayAllAnalysis() {
        showLoading();
        hideMessage(overallAnalysisErrorDiv);

        try {
            const watchlist = await fetchWatchlist(); // This already displays the watchlist
            let defaultStocks = [];
            
            try {
                const defaultStocksResponse = await fetch(`${FLASK_API_URL}/default_stocks`);
                if (!defaultStocksResponse.ok) {
                    const errorData = await defaultStocksResponse.json();
                    throw new Error(`Failed to fetch default stocks: ${errorData.error || defaultStocksResponse.statusText}`);
                }
                const defaultStocksData = await defaultStocksResponse.json();
                defaultStocks = defaultStocksData.companies || [];
            } catch (e) {
                console.error('Error fetching default stocks:', e);
                showMessage(overallAnalysisErrorDiv, `Could not load default stocks: ${e.message}`, 'error');
            }

            const allTickersToAnalyze = Array.from(new Set([...watchlist, ...defaultStocks]));
            const analysisPromises = allTickersToAnalyze.map(ticker => fetchStockAnalysis(ticker));
            const allAnalyzedData = await Promise.all(analysisPromises);

            const longTermPicks = [];
            const shortTermPicks = [];
            const allAnalysisForDisplay = []; // For the overall table

            allAnalyzedData.forEach(stockData => {
                allAnalysisForDisplay.push(stockData); // Always add to display, even if it's an error object
                if (stockData && !stockData.error) { // Only categorize successful analyses
                    const overallScore = stockData.overallScore;
                    const technicalScore = stockData.scoreBreakdown ? stockData.scoreBreakdown.technicalAnalysis : 'N/A';

                    if (typeof overallScore === 'number' && overallScore >= 70) { // Adjusted threshold for long-term
                        longTermPicks.push(stockData);
                    }
                    if (typeof overallScore === 'number' && overallScore >= 60 && typeof technicalScore === 'number' && technicalScore >= 70) { // Adjusted threshold for short-term
                        shortTermPicks.push(stockData);
                    }
                }
            });

            // Sort picks by score (descending)
            longTermPicks.sort((a, b) => (typeof b.overallScore === 'number' ? b.overallScore : -Infinity) - (typeof a.overallScore === 'number' ? a.overallScore : -Infinity));
            shortTermPicks.sort((a, b) => (typeof b.overallScore === 'number' ? b.overallScore : -Infinity) - (typeof a.overallScore === 'number' ? a.overallScore : -Infinity));

            displayOverallAnalysis(allAnalysisForDisplay, longTermPicks, shortTermPicks);

        } catch (error) {
            console.error('Error in overall analysis:', error);
            showMessage(overallAnalysisErrorDiv, `Failed to fetch overall analysis: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Displays the overall analysis results in the dashboard tables.
     * @param {object[]} allStocks - All analyzed stock data.
     * @param {object[]} longTermPicks - Stocks categorized as long-term picks.
     * @param {object[]} shortTermPicks - Stocks categorized as short-term picks.
     */
    function displayOverallAnalysis(allStocks, longTermPicks, shortTermPicks) {
        const analysisTableBody = document.getElementById('analysis-table-body');
        const longTermTableBody = document.getElementById('long-term-table-body');
        const shortTermTableBody = document.getElementById('short-term-table-body');

        // Clear existing rows
        analysisTableBody.innerHTML = '';
        longTermTableBody.innerHTML = '';
        shortTermTableBody.innerHTML = '';

        // Helper function to create table rows
        const createTableRow = (stock, targetBody) => {
            const row = targetBody.insertRow();
            row.className = 'bg-gray-800 border-b border-gray-700 hover:bg-gray-700 cursor-pointer';
            row.dataset.ticker = stock.ticker; // Store ticker for click event
            row.onclick = () => showStockDetailsModal(stock.ticker); // Click to open modal

            const score = typeof stock.overallScore === 'number' ? stock.overallScore.toFixed(0) : 'N/A';
            const suggestion = stock.suggestion || 'N/A';
            const currentPrice = typeof stock.currentPrice === 'number' ? formatCurrency(stock.currentPrice, stock.currency || '$') : 'N/A';
            
            // Format Price Movement (only percentage)
            const percentChange = typeof stock.percentChange === 'number' ? `${stock.percentChange.toFixed(2)}%` : 'N/A';
            const priceMovementClass = getPriceChangeColorClass(stock.percentChange);

            row.innerHTML = `
                <td class="py-3 px-4 font-bold text-gray-200">${stock.ticker}</td>
                <td class="py-3 px-4 text-gray-300">${stock.companyName || 'N/A'}</td>
                <td class="py-3 px-4 text-gray-300">${currentPrice}</td>
                <td class="py-3 px-4 ${priceMovementClass}">${percentChange}</td>
                <td class="py-3 px-4 ${getScoreColorClass(score)}">${score !== 'N/A' ? `${score}%` : 'N/A'}</td>
                <td class="py-3 px-4 ${getSuggestionColorClass(suggestion)}">${suggestion}</td>
            `;
        };

        // Populate All Stocks table
        if (allStocks.length > 0) {
            allStocks.forEach(stock => createTableRow(stock, analysisTableBody));
        } else {
            analysisTableBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-gray-400">No stocks to display. Add some or check default list.</td></tr>';
        }

        // Populate Long-Term Picks table
        if (longTermPicks.length > 0) {
            longTermPicks.forEach(stock => createTableRow(stock, longTermTableBody));
        } else {
            longTermTableBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-gray-400">No long-term picks identified at this time.</td></tr>';
        }

        // Populate Short-Term Picks table
        if (shortTermPicks.length > 0) {
            shortTermPicks.forEach(stock => createTableRow(stock, shortTermTableBody));
        } else {
            shortTermTableBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-gray-400">No short-term opportunities identified at this time.</td></tr>';
        }
    }


    // --- Modal Functions ---

    /**
     * Displays the modal with detailed stock analysis.
     * @param {string} ticker - The ticker symbol to display.
     */
    async function showStockDetailsModal(ticker) {
        showLoading();
        hideMessage(overallAnalysisErrorDiv);
        try {
            const stockData = await fetchStockAnalysis(ticker);
            if (stockData && !stockData.error) {
                populateStockDetailsModal(stockData);
                renderHistoricalChart(stockData.historicalData, stockData.ticker); // Render chart
                // Explicitly show the modal and trigger transition
                stockDetailModal.classList.remove('hidden'); // Make it visible
                stockDetailModal.showModal(); // Show the dialog (this handles the backdrop)
                // Use requestAnimationFrame to ensure the browser has rendered the 'hidden' removal
                // before applying the transition classes. This ensures the transition plays.
                requestAnimationFrame(() => {
                    stockDetailModal.classList.remove('scale-0', 'opacity-0');
                    stockDetailModal.classList.add('scale-100', 'opacity-100');
                });

            } else {
                showMessage(overallAnalysisErrorDiv, `Could not load detailed analysis for ${ticker}: ${stockData.error || 'Data unavailable.'}`, 'error');
            }
        } catch (error) {
            console.error('Error showing stock details modal:', error);
            showMessage(overallAnalysisErrorDiv, `Failed to load details for ${ticker}: ${error.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    /**
     * Populates the stock details modal with data.
     * @param {object} stock - The stock data object.
     */
    function populateStockDetailsModal(stock) {
        // Basic Info
        modalTickerName.textContent = stock.ticker || 'N/A';
        modalCompanyName.textContent = stock.companyName || 'N/A';
        const currency = stock.currency || '$';
        modalCurrentPrice.textContent = formatCurrency(stock.currentPrice, currency);
        
        // Price Change and Percentage Change (separate for clarity in modal)
        modalPriceChange.textContent = typeof stock.priceChange === 'number' ? formatCurrency(stock.priceChange, currency) : 'N/A';
        modalPriceChange.className = `font-semibold ${typeof stock.priceChange === 'number' ? (stock.priceChange >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-400'}`;
        modalPercentChange.textContent = typeof stock.percentChange === 'number' ? `${stock.percentChange.toFixed(2)}%` : 'N/A';
        modalPercentChange.className = `font-semibold ${typeof stock.percentChange === 'number' ? (stock.percentChange >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-400'}`;
        
        modalOpenPrice.textContent = formatCurrency(stock.openPrice, currency);
        modalPreviousClose.textContent = formatCurrency(stock.previousClose, currency);
        modalDayHigh.textContent = formatCurrency(stock.dayHigh, currency);
        modalDayLow.textContent = formatCurrency(stock.dayLow, currency);
        modalVolume.textContent = formatNumber(stock.volume);
        modalMarketCap.textContent = formatMarketCap(stock.marketCap);
        modalIndustry.textContent = stock.industry || 'N/A';
        modalSector.textContent = stock.sector || 'N/A';
        modalEmployees.textContent = formatNumber(stock.fullTimeEmployees);
        modalWebsite.innerHTML = stock.weburl ? `<a href="${stock.weburl}" target="_blank" class="text-blue-400 hover:underline">${stock.weburl}</a>` : 'N/A';
        modalIPO.textContent = stock.ipo || 'N/A';
        modalCurrency.textContent = stock.currency || 'N/A';

        // Financial Ratios
        modalPERatio.textContent = typeof stock.peRatio === 'number' ? stock.peRatio.toFixed(2) : 'N/A';
        modalForwardPERatio.textContent = typeof stock.forwardPE === 'number' ? stock.forwardPE.toFixed(2) : 'N/A';
        modalDividendYield.textContent = typeof stock.dividendYield === 'number' ? `${(stock.dividendYield * 100).toFixed(2)}%` : 'N/A';
        modalExDividendDate.textContent = stock.exDividendDate || 'N/A';
        modal52WeekHigh.textContent = formatCurrency(stock['52WeekHigh'], currency);
        modal52WeekLow.textContent = formatCurrency(stock['52WeekLow'], currency);
        modalBeta.textContent = typeof stock.beta === 'number' ? stock.beta.toFixed(2) : 'N/A';

        // Analyst Data
        modalAnalystRecommendation.textContent = stock.analystRecommendation || 'N/A';
        modalAnalystTargetPrice.textContent = typeof stock.analystTargetPrice === 'number' ? formatCurrency(stock.analystTargetPrice, currency) : 'N/A';
        modalAnalystUpside.textContent = typeof stock.analystUpside === 'number' ? `${(stock.analystUpside * 100).toFixed(2)}%` : 'N/A';

        // Business Summary
        modalBusinessSummary.innerHTML = stock.businessSummary ? stock.businessSummary : 'No business summary available.';

        // Populate Metric Scores in Modal
        const scores = stock.scoreBreakdown || {};
        metricAnalystRating.textContent = typeof scores.analystRating === 'number' ? `${scores.analystRating.toFixed(0)}%` : 'N/A';
        metricAnalystUpside.textContent = typeof scores.analystUpside === 'number' ? `${scores.analystUpside.toFixed(0)}%` : 'N/A';
        metricFinancialAnalysis.textContent = typeof scores.financialAnalysis === 'number' ? `${scores.financialAnalysis.toFixed(0)}%` : 'N/A';
        metricTechnicalAnalysis.textContent = typeof scores.technicalAnalysis === 'number' ? `${scores.technicalAnalysis.toFixed(0)}%` : 'N/A';

        // Populate Modal's "Why This Recommendation" list with all reasons
        modalReasonsList.innerHTML = ''; // Clear previous content
        if (stock.reasons && stock.reasons.length > 0) {
            const reasonList = document.createElement('ul');
            reasonList.className = 'list-disc list-inside text-gray-400 text-sm space-y-1';
            stock.reasons.forEach(reason => {
                const listItem = document.createElement('li');
                listItem.textContent = reason;
                reasonList.appendChild(listItem);
            });
            modalReasonsList.appendChild(reasonList);
        } else {
            modalReasonsList.innerHTML = '<p class="text-gray-400">No specific reasons provided for this analysis.</p>';
        }
    }

    /**
     * Renders or updates the historical price chart using Chart.js.
     * @param {Array<Object>} historicalData - Array of historical price objects.
     * @param {string} ticker - The stock ticker symbol.
     */
    function renderHistoricalChart(historicalData, ticker) {
        const ctx = document.getElementById('historicalChart').getContext('2d');

        if (historicalPriceChart) {
            historicalPriceChart.destroy(); // Destroy previous chart instance
            historicalPriceChart = null; // IMPORTANT: Clear the reference after destroying
        }

        if (!historicalData || historicalData.length === 0) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            // Optionally, display a message directly on the canvas area
            ctx.font = '16px Arial';
            ctx.fillStyle = '#9CA3AF'; // Tailwind gray-400
            ctx.textAlign = 'center';
            ctx.fillText('No historical data available for chart.', ctx.canvas.width / 2, ctx.canvas.height / 2);
            return;
        }

        // Sort data by date just in case
        historicalData.sort((a, b) => new Date(a.Date) - new Date(b.Date));

        const dates = historicalData.map(data => data.Date);
        const closingPrices = historicalData.map(data => data.Close);

        historicalPriceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: `${ticker} Closing Price`,
                    data: closingPrices,
                    borderColor: 'rgb(59, 130, 246)', // Tailwind blue-500
                    backgroundColor: 'rgba(59, 130, 246, 0.2)', // Tailwind blue-500 with transparency
                    borderWidth: 2,
                    pointRadius: 0, // No points for cleaner line
                    fill: true,
                    tension: 0.1 // Smooth curves
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // Allow canvas to resize based on container
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#E5E7EB' // Tailwind gray-200
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${formatCurrency(context.raw)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            tooltipFormat: 'MMM DD, YYYY',
                            displayFormats: {
                                month: 'MMM YYYY'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Date',
                            color: '#9CA3AF' // Tailwind gray-400
                        },
                        ticks: {
                            color: '#9CA3AF' // Tailwind gray-400
                        },
                        grid: {
                            color: 'rgba(107, 114, 128, 0.2)' // Tailwind gray-500 with transparency
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Price ($)',
                            color: '#9CA3AF' // Tailwind gray-400
                        },
                        ticks: {
                            color: '#9CA3AF', // Tailwind gray-400
                            callback: function(value, index, ticks) {
                                return formatCurrency(value);
                            }
                        },
                        grid: {
                            color: 'rgba(107, 114, 128, 0.2)' // Tailwind gray-500 with transparency
                        }
                    }
                }
            }
        });
    }
    
    // --- Event Listeners ---

    addTickerBtn.addEventListener('click', () => {
        const ticker = newTickerInput.value.trim().toUpperCase();
        if (ticker) { addTicker(ticker); } else { showMessage(overallAnalysisErrorDiv, 'Please enter a ticker symbol to add.', 'error'); }
    });

    newTickerInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') { addTickerBtn.click(); }
    });

    analyzeAllStocksBtn.addEventListener('click', fetchAndDisplayAllAnalysis);

    function addRemoveEventListeners() {
        document.querySelectorAll('.remove-ticker-btn').forEach(button => {
            button.removeEventListener('click', handleRemoveClick); // Prevent duplicate listeners
            button.addEventListener('click', handleRemoveClick);
        });
    }

    function handleRemoveClick(event) {
        event.stopPropagation(); // Prevent the row click event from firing
        const ticker = event.target.dataset.ticker;
        
        // Custom confirmation message box
        showMessage(overallAnalysisErrorDiv, 
            `Are you sure you want to remove ${ticker} from your watchlist? <button id="confirm-remove" class="ml-2 bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded">Yes</button>`, 
            'info', 
            false // Do not auto-hide this message
        );
        
        // Attach event listener to the dynamically created 'Yes' button
        const confirmRemoveBtn = document.getElementById('confirm-remove');
        if (confirmRemoveBtn) {
            confirmRemoveBtn.onclick = async () => {
                await removeTicker(ticker);
                hideMessage(overallAnalysisErrorDiv); // Hide the confirmation message after action
            };
        }
    }

    closeModalBtn.addEventListener('click', () => {
        stockDetailModal.close();
        // Reset modal transform and opacity for next open animation
        stockDetailModal.classList.remove('scale-100', 'opacity-100');
        stockDetailModal.classList.add('scale-0', 'opacity-0', 'hidden'); // Add hidden back
        if (historicalPriceChart) {
            historicalPriceChart.destroy(); // Destroy chart when modal is closed
            historicalPriceChart = null;
        }
    });

    // --- Initial Load ---
    fetchAndDisplayAllAnalysis();
}); 