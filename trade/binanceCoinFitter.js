/**
 * 币安代币涨幅分析工具
 * 
 * 这个脚本用于分析币安交易所上架代币的涨幅情况，主要功能包括：
 * 1. 获取币安所有USDT交易对
 * 2. 批量获取代币的K线数据
 * 3. 计算近11天的价格涨幅
 * 4. 筛选出涨幅超过50%的代币
 * 5. 按涨幅降序排序并输出结果
 * 
 * 使用说明：
 * 1. 需要安装 axios 和 moment 依赖
 * 2. 直接运行脚本即可获取分析结果
 * 3. 默认只分析USDT交易对
 * 4. 支持批量处理和自动重试机制
 */

const axios = require('axios');
const moment = require('moment');

// 设置币安API的基本URL
const BASE_URL = 'https://api.binance.com/api/v3/klines';
const SYMBOL_LIST_URL = 'https://api.binance.com/api/v3/exchangeInfo';

// 分批处理数组
const chunkArray = (array, size) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, (i + 1) * size)
  );

// 获取币安的所有交易对
async function getAllSymbols(filterUSDT = true) {
  try {
    const response = await axios.get(SYMBOL_LIST_URL);
    const symbols = response.data.symbols;
    let tradingPairs = symbols.filter(symbol => symbol.status === 'TRADING');
    if (filterUSDT) {
      tradingPairs = tradingPairs.filter(symbol => symbol.symbol.endsWith('USDT'));
    }
    return tradingPairs.map(symbol => symbol.symbol);
  } catch (error) {
    console.error('Error fetching symbol list:', error.message);
    return [];
  }
}

// 获取历史K线数据（带重试）
async function getKlines(symbol, interval, startTime, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(BASE_URL, {
        params: {
          symbol,
          interval,
          startTime,
          limit: 15, // 覆盖 11 天 + 冗余
        },
      });
      return response.data;
    } catch (error) {
      if (i === retries - 1) {
        console.error(`Failed to fetch data for ${symbol} after ${retries} attempts`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待 1 秒后重试
    }
  }
}

// 计算涨幅
function calculatePercentageChange(openPrice, closePrice) {
  return ((closePrice - openPrice) / openPrice) * 100;
}

// 获取近11天涨幅>=50%的代币
async function findTopPerformingTokens() {
  const elevenDaysAgo = moment().subtract(11, 'days').valueOf();
  const symbols = await getAllSymbols(true); // 默认只处理 USDT 交易对
  console.log(`\n📊 币安上架代币总数: ${symbols.length} 个\n`);

  const results = [];
  const batchSize = 50; // 每批处理 50 个交易对
  const batches = chunkArray(symbols, batchSize);

  for (let i = 0; i < batches.length; i++) {
    console.log(
      `处理进度: ${Math.min((i + 1) * batchSize, symbols.length)}/${symbols.length} (${(
        ((i + 1) / batches.length * 100)
      ).toFixed(1)}%)`
    );
    const batch = batches[i];
    const promises = batch.map(symbol =>
      getKlines(symbol, '1d', elevenDaysAgo).then(klines => {
        if (klines && klines.length > 0) {
          const firstKline = klines[0];
          const lastKline = klines[klines.length - 1];
          const openPrice = parseFloat(firstKline[1]);
          const closePrice = parseFloat(lastKline[4]);
          const priceChange = calculatePercentageChange(openPrice, closePrice);
          if (priceChange >= 50) {
            return { symbol, priceChange };
          }
        }
        return null;
      })
    );
    const batchResults = (await Promise.all(promises)).filter(result => result);
    results.push(...batchResults);
  }

  // 按涨幅降序排序
  results.sort((a, b) => b.priceChange - a.priceChange);

  // 输出结果
  if (results.length > 0) {
    console.log('\n🎯 符合条件的代币：');
    results.forEach(result => {
      console.log(`${result.symbol}: ${result.priceChange.toFixed(2)}%`);
    });
  } else {
    console.log('\n没有找到符合条件的代币');
  }
}

// 调用函数
findTopPerformingTokens();
